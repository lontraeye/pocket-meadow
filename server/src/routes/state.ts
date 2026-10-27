import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { battleConfig } from '../config/battle.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { trainerConfig } from '../config/trainer.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import {
  activeEffects,
  berryPlots,
  candies,
  daycareSlots,
  encounters,
  inventory,
  pokemon,
  species,
  trainers,
} from '../db/schema.js'
import { power } from '../game/battle.js'
import { nextEnergyAt } from '../game/catchUp.js'
import { toEncounterView } from './encounterView.js'

export const stateRoutes = new Hono<AuthEnv>()

stateRoutes.get('/', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  return c.json(immediate(() => readState(userId, now)))
})

function readState(userId: number, now: number) {
  persistCatchUp(userId, now)
  const db = getDb()
  const trainer = db.select().from(trainers).where(eq(trainers.userId, userId)).get()
  if (!trainer) throw new Error(`trainer missing for user ${userId}`)

  const owned = db
    .select({
      id: pokemon.id,
      speciesId: pokemon.speciesId,
      name: species.name,
      displayName: species.displayName,
      evolutionChainId: species.evolutionChainId,
      baseStatTotal: species.baseStatTotal,
      level: pokemon.level,
      xp: pokemon.xp,
      isShiny: pokemon.isShiny,
      nickname: pokemon.nickname,
      isFavorite: pokemon.isFavorite,
      location: pokemon.location,
    })
    .from(pokemon)
    .innerJoin(species, eq(pokemon.speciesId, species.id))
    .where(eq(pokemon.userId, userId))
    .all()

  const daycare = db
    .select({
      slotIndex: daycareSlots.slotIndex,
      pokemonId: daycareSlots.pokemonId,
      enteredAt: daycareSlots.enteredAt,
      lastSettledAt: daycareSlots.lastSettledAt,
    })
    .from(daycareSlots)
    .where(eq(daycareSlots.userId, userId))
    .all()

  const effects = db.select().from(activeEffects).where(eq(activeEffects.userId, userId)).all()
  const pending = db
    .select({
      id: encounters.id,
      regionSlug: encounters.regionSlug,
      speciesId: encounters.speciesId,
      name: species.name,
      displayName: species.displayName,
      level: encounters.level,
      isShiny: encounters.isShiny,
      expiresAt: encounters.expiresAt,
      baseStatTotal: species.baseStatTotal,
    })
    .from(encounters)
    .innerJoin(species, eq(encounters.speciesId, species.id))
    .where(and(eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()

  return {
    now,
    gardenMaxVisible: progressConfig.gardenMaxVisible,
    plotSlots: progressConfig.basePlotSlots,
    battle: {
      k: battleConfig.k,
      minChance: battleConfig.minChance,
      maxChance: battleConfig.maxChance,
      teamWeights: battleConfig.teamWeights,
    },
    trainer: {
      level: trainer.level,
      xp: trainer.xp,
      energy: trainer.energy,
      energyMax: trainerConfig.energyMax,
      energyNextAt: nextEnergyAt(trainer.energy, trainer.energyUpdatedAt),
      genericCandies: trainer.genericCandies,
    },
    pokemon: owned.map((mon) => ({
      id: mon.id,
      speciesId: mon.speciesId,
      name: mon.name,
      displayName: mon.displayName,
      evolutionChainId: mon.evolutionChainId,
      level: mon.level,
      xp: mon.xp,
      xpToNext: mon.level >= progressConfig.levelCap ? null : xpToNext(mon.level),
      isShiny: mon.isShiny,
      nickname: mon.nickname,
      isFavorite: mon.isFavorite,
      location: mon.location,
      power: power(mon.baseStatTotal, mon.level),
    })),
    candies: db.select().from(candies).where(eq(candies.userId, userId)).all(),
    daycare,
    plots: db.select().from(berryPlots).where(eq(berryPlots.userId, userId)).all(),
    inventory: db.select().from(inventory).where(eq(inventory.userId, userId)).all(),
    effects: effects.map((effect) => ({
      id: effect.id,
      effectKey: effect.effectKey,
      multiplier: effect.multiplier,
      charges: effect.charges,
      expiresAt: effect.expiresAt,
    })),
    encounter: pending ? toEncounterView(pending) : null,
  }
}
