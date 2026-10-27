import { and, eq } from 'drizzle-orm'
import { applyCatchUp } from '../game/catchUp.js'
import { getDb } from './client.js'
import { activeEffects, daycareSlots, encounters, pokemon, trainers } from './schema.js'

export type PlayerClock = {
  level: number
  xp: number
  energy: number
  energyUpdatedAt: number
}

// Chamar dentro de immediate(): o catch-up e a ação compartilham a transação.
export function persistCatchUp(userId: number, now: number): PlayerClock {
  const db = getDb()
  const trainer = db.select().from(trainers).where(eq(trainers.userId, userId)).get()
  if (!trainer) throw new Error(`trainer missing for user ${userId}`)

  const daycare = db
    .select({
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
  const pending = db
    .select({ id: encounters.id, status: encounters.status, expiresAt: encounters.expiresAt })
    .from(encounters)
    .where(and(eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .all()

  const caughtUp = applyCatchUp(
    {
      trainer: { energy: trainer.energy, energyUpdatedAt: trainer.energyUpdatedAt },
      daycare,
      effects,
      encounters: pending,
    },
    now,
  )

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
    const current = db
      .select({ xpGained: daycareSlots.xpGained })
      .from(daycareSlots)
      .where(and(eq(daycareSlots.pokemonId, slot.pokemonId), eq(daycareSlots.userId, userId)))
      .get()
    db.update(daycareSlots)
      .set({
        lastSettledAt: slot.lastSettledAt,
        xpGained: (current?.xpGained ?? 0) + slot.xpGained,
      })
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
      .where(and(eq(encounters.id, id), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
      .run()
  }

  return {
    level: trainer.level,
    xp: trainer.xp,
    energy: caughtUp.trainer.energy,
    energyUpdatedAt: caughtUp.trainer.energyUpdatedAt,
  }
}
