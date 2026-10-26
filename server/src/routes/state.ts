import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { trainerConfig } from '../config/trainer.js'
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
import { applyCatchUp } from '../game/catchUp.js'

export const stateRoutes = new Hono<AuthEnv>()

stateRoutes.get('/', requireUser, (c) => {
  const userId = c.get('userId')
  const db = getDb()
  const now = Date.now()

  const trainer = db.select().from(trainers).where(eq(trainers.userId, userId)).get()
  if (!trainer) throw new Error(`trainer missing for user ${userId}`)

  const owned = db
    .select({
      id: pokemon.id,
      speciesId: pokemon.speciesId,
      name: species.name,
      displayName: species.displayName,
      evolutionChainId: species.evolutionChainId,
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
      level: pokemon.level,
      xp: pokemon.xp,
    })
    .from(daycareSlots)
    .innerJoin(pokemon, eq(daycareSlots.pokemonId, pokemon.id))
    .where(eq(daycareSlots.userId, userId))
    .all()

  const effects = db.select().from(activeEffects).where(eq(activeEffects.userId, userId)).all()
  const encounterRows = db.select().from(encounters).where(eq(encounters.userId, userId)).all()
  const caughtUp = applyCatchUp(
    {
      trainer: { energy: trainer.energy, energyUpdatedAt: trainer.energyUpdatedAt },
      daycare,
      effects,
      encounters: encounterRows,
    },
    now,
  )

  immediate(() => {
    db.update(trainers)
      .set({
        energy: caughtUp.trainer.energy,
        energyUpdatedAt: caughtUp.trainer.energyUpdatedAt,
        updatedAt: now,
      })
      .where(eq(trainers.userId, userId))
      .run()

    for (const slot of caughtUp.daycare) {
      db.update(pokemon)
        .set({ level: slot.level, xp: slot.xp })
        .where(and(eq(pokemon.id, slot.pokemonId), eq(pokemon.userId, userId)))
        .run()
      db.update(daycareSlots)
        .set({ lastSettledAt: slot.lastSettledAt })
        .where(and(eq(daycareSlots.pokemonId, slot.pokemonId), eq(daycareSlots.userId, userId)))
        .run()
    }

    for (const id of caughtUp.deleteEffectIds) {
      db.delete(activeEffects)
        .where(and(eq(activeEffects.id, id), eq(activeEffects.userId, userId)))
        .run()
    }

    for (const id of caughtUp.fleeEncounterIds) {
      db.update(encounters)
        .set({ status: 'fled', resolvedAt: now })
        .where(and(eq(encounters.id, id), eq(encounters.userId, userId)))
        .run()
    }
  })

  const progressed = new Map(caughtUp.daycare.map((slot) => [slot.pokemonId, slot]))
  const visiblePokemon = owned.map((mon) => {
    const update = progressed.get(mon.id)
    const level = update?.level ?? mon.level
    return {
      id: mon.id,
      speciesId: mon.speciesId,
      name: mon.name,
      displayName: mon.displayName,
      evolutionChainId: mon.evolutionChainId,
      level,
      xp: update?.xp ?? mon.xp,
      xpToNext: level >= progressConfig.levelCap ? null : xpToNext(level),
      isShiny: mon.isShiny,
      nickname: mon.nickname,
      isFavorite: mon.isFavorite,
      location: mon.location,
    }
  })

  const pending = encounterRows.find(
    (encounter) => encounter.status === 'pending' && !caughtUp.fleeEncounterIds.includes(encounter.id),
  )

  return c.json({
    now,
    gardenMaxVisible: progressConfig.gardenMaxVisible,
    plotSlots: progressConfig.basePlotSlots,
    trainer: {
      level: trainer.level,
      xp: trainer.xp,
      energy: caughtUp.trainer.energy,
      energyMax: trainerConfig.energyMax,
      energyNextAt: caughtUp.energyNextAt,
      genericCandies: trainer.genericCandies,
    },
    pokemon: visiblePokemon,
    candies: db.select().from(candies).where(eq(candies.userId, userId)).all(),
    daycare: daycare.map((slot) => ({
      slotIndex: slot.slotIndex,
      pokemonId: slot.pokemonId,
      enteredAt: slot.enteredAt,
      lastSettledAt: progressed.get(slot.pokemonId)?.lastSettledAt ?? slot.lastSettledAt,
    })),
    plots: db.select().from(berryPlots).where(eq(berryPlots.userId, userId)).all(),
    inventory: db.select().from(inventory).where(eq(inventory.userId, userId)).all(),
    effects: effects
      .filter((effect) => !caughtUp.deleteEffectIds.includes(effect.id))
      .map((effect) => ({
        id: effect.id,
        effectKey: effect.effectKey,
        multiplier: effect.multiplier,
        charges: effect.charges,
        expiresAt: effect.expiresAt,
      })),
    encounter: pending
      ? {
          id: pending.id,
          regionSlug: pending.regionSlug,
          speciesId: pending.speciesId,
          level: pending.level,
          isShiny: pending.isShiny,
          expiresAt: pending.expiresAt,
        }
      : null,
  })
})
