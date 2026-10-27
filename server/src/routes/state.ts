import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { battleConfig } from '../config/battle.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { progressionConfig } from '../config/progression.js'
import { trainerConfig } from '../config/trainer.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import {
  activeEffects,
  berryPlots,
  candies,
  daycareSlots,
  encounters,
  evolutions,
  inventory,
  pokemon,
  species,
  trainers,
} from '../db/schema.js'
import { power } from '../game/battle.js'
import { nextEnergyAt } from '../game/catchUp.js'
import { devToolsEnabled } from './dev.js'
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
      caughtAt: pokemon.caughtAt,
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

  const options = db
    .select({
      fromSpeciesId: evolutions.fromSpeciesId,
      toSpeciesId: evolutions.toSpeciesId,
      minLevel: evolutions.minLevel,
      displayName: species.displayName,
    })
    .from(evolutions)
    .innerJoin(species, eq(evolutions.toSpeciesId, species.id))
    .all()
  const evolutionsBySpecies = new Map<number, { toSpeciesId: number; displayName: string; minLevel: number }[]>()
  for (const option of options) {
    const list = evolutionsBySpecies.get(option.fromSpeciesId) ?? []
    list.push({ toSpeciesId: option.toSpeciesId, displayName: option.displayName, minLevel: option.minLevel })
    evolutionsBySpecies.set(option.fromSpeciesId, list)
  }
  for (const list of evolutionsBySpecies.values()) list.sort((a, b) => a.toSpeciesId - b.toSpeciesId)

  return {
    now,
    devTools: devToolsEnabled(),
    gardenMaxVisible: progressConfig.gardenMaxVisible,
    plotSlots: progressConfig.basePlotSlots,
    battle: {
      k: battleConfig.k,
      minChance: battleConfig.minChance,
      maxChance: battleConfig.maxChance,
      teamWeights: battleConfig.teamWeights,
    },
    progression: {
      levelCap: progressConfig.levelCap,
      candyXp: progressionConfig.candyXp,
      genericPerCandy: progressionConfig.genericPerCandy,
      releaseBase: progressionConfig.releaseBase,
      releaseLevelDiv: progressionConfig.releaseLevelDiv,
      releaseShinyMult: progressionConfig.releaseShinyMult,
      releaseGeneric: progressionConfig.releaseGeneric,
      feedMax: progressionConfig.feedMaxPerRequest,
      releaseMax: progressionConfig.releaseMaxPerRequest,
      xpBase: progressConfig.xpBase,
      xpExponent: progressConfig.xpExponent,
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
      caughtAt: mon.caughtAt,
      power: power(mon.baseStatTotal, mon.level),
      evolutions: evolutionsBySpecies.get(mon.speciesId) ?? [],
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
