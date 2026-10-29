import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { daycareConfig, daycareSlotsUnlocked } from '../config/daycare.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { daycareSlots, pokemon } from '../db/schema.js'
import { leaveTeam } from '../db/team.js'
import { levelsGainedFromStay } from '../game/daycare.js'
import { type Failure, fail, parseSlot, readObject } from './http.js'

type Ok<T> = { ok: true } & T

const hourMs = 60 * 60 * 1000

export const daycareRoutes = new Hono<AuthEnv>()

daycareRoutes.post('/:slot', requireUser, async (c) => {
  const slotIndex = parseSlot(c.req.param('slot'))
  if (slotIndex === null) return c.json({ error: 'invalid_body' }, 400)
  const body = await readObject(c)
  if (!body) return c.json({ error: 'invalid_body' }, 400)
  const pokemonId = body.pokemonId
  if (typeof pokemonId !== 'number' || !Number.isInteger(pokemonId) || pokemonId <= 0) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const result = immediate(() => place(c.get('userId'), slotIndex, pokemonId, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.placed)
})

daycareRoutes.delete('/:slot', requireUser, (c) => {
  const slotIndex = parseSlot(c.req.param('slot'))
  if (slotIndex === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => withdraw(c.get('userId'), slotIndex, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.withdrawn)
})

daycareRoutes.post('/:slot/renew', requireUser, (c) => {
  const slotIndex = parseSlot(c.req.param('slot'))
  if (slotIndex === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => renew(c.get('userId'), slotIndex, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.renewed)
})

function errorBody(result: Failure): { error: string; pokemonId?: number; min?: number } {
  return {
    error: result.error,
    ...(result.pokemonId !== undefined ? { pokemonId: result.pokemonId } : {}),
    ...(result.min !== undefined ? { min: result.min } : {}),
  }
}

function place(
  userId: number,
  slotIndex: number,
  pokemonId: number,
  now: number,
): Ok<{ placed: { slotIndex: number; pokemonId: number; enteredAt: number; fullAt: number } }> | Failure {
  const clock = persistCatchUp(userId, now)
  const unlocked = daycareSlotsUnlocked(clock.level)
  if (slotIndex < 0 || slotIndex >= unlocked) return fail('slot_locked', 400)

  const db = getDb()
  const taken = db
    .select({ pokemonId: daycareSlots.pokemonId })
    .from(daycareSlots)
    .where(and(eq(daycareSlots.userId, userId), eq(daycareSlots.slotIndex, slotIndex)))
    .get()
  if (taken) return fail('slot_taken', 400)

  const mon = db
    .select({ id: pokemon.id, location: pokemon.location, inPc: pokemon.inPc })
    .from(pokemon)
    .where(and(eq(pokemon.id, pokemonId), eq(pokemon.userId, userId)))
    .get()
  if (!mon) return fail('pokemon_not_found', 404)
  if (mon.location === 'daycare') return fail('in_daycare', 400)
  if (mon.inPc) return fail('in_pc', 400)

  const gardenCount = db
    .select({ id: pokemon.id })
    .from(pokemon)
    .where(and(eq(pokemon.userId, userId), eq(pokemon.location, 'garden'), eq(pokemon.inPc, false)))
    .all().length
  if (gardenCount <= 1) return fail('last_in_garden', 400)
  const left = leaveTeam(userId, [pokemonId])
  if (!left.ok) return fail(left.error, 400)

  db.insert(daycareSlots)
    .values({
      userId,
      slotIndex,
      pokemonId,
      enteredAt: now,
      lastSettledAt: now,
      xpGained: 0,
    })
    .run()
  db.update(pokemon)
    .set({ location: 'daycare' })
    .where(and(eq(pokemon.id, pokemonId), eq(pokemon.userId, userId)))
    .run()

  return {
    ok: true,
    placed: {
      slotIndex,
      pokemonId,
      enteredAt: now,
      fullAt: now + daycareConfig.maxMs,
    },
  }
}

type WithdrawResult = {
  slotIndex: number
  pokemonId: number
  xpGained: number
  levelsGained: number
  level: number
  xp: number
  hours: number
}

function withdraw(userId: number, slotIndex: number, now: number): Ok<{ withdrawn: WithdrawResult }> | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const row = db
    .select({
      pokemonId: daycareSlots.pokemonId,
      enteredAt: daycareSlots.enteredAt,
      lastSettledAt: daycareSlots.lastSettledAt,
      xpGained: daycareSlots.xpGained,
      level: pokemon.level,
      xp: pokemon.xp,
    })
    .from(daycareSlots)
    .innerJoin(pokemon, eq(daycareSlots.pokemonId, pokemon.id))
    .where(and(eq(daycareSlots.userId, userId), eq(daycareSlots.slotIndex, slotIndex)))
    .get()
  if (!row) return fail('pokemon_not_found', 404)

  // Um carregado aprendido na estadia já foi gravado pelo catch-up (seção 5.18).
  const levelsGained = levelsGainedFromStay(row.level, row.xp, row.xpGained)

  db.delete(daycareSlots)
    .where(and(eq(daycareSlots.userId, userId), eq(daycareSlots.slotIndex, slotIndex)))
    .run()
  db.update(pokemon)
    .set({ location: 'garden' })
    .where(and(eq(pokemon.id, row.pokemonId), eq(pokemon.userId, userId)))
    .run()

  return {
    ok: true,
    withdrawn: {
      slotIndex,
      pokemonId: row.pokemonId,
      xpGained: row.xpGained,
      levelsGained,
      level: row.level,
      xp: row.xp,
      hours: Math.floor((row.lastSettledAt - row.enteredAt) / hourMs),
    },
  }
}

function renew(
  userId: number,
  slotIndex: number,
  now: number,
): Ok<{ renewed: WithdrawResult & { enteredAt: number; fullAt: number } }> | Failure {
  const out = withdraw(userId, slotIndex, now)
  if (!out.ok) return out

  const db = getDb()
  db.insert(daycareSlots)
    .values({
      userId,
      slotIndex,
      pokemonId: out.withdrawn.pokemonId,
      enteredAt: now,
      lastSettledAt: now,
      xpGained: 0,
    })
    .run()
  db.update(pokemon)
    .set({ location: 'daycare' })
    .where(and(eq(pokemon.id, out.withdrawn.pokemonId), eq(pokemon.userId, userId)))
    .run()

  return {
    ok: true,
    renewed: {
      ...out.withdrawn,
      enteredAt: now,
      fullAt: now + daycareConfig.maxMs,
    },
  }
}
