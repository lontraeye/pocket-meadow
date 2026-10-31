import { and, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { berries } from '../config/berries.js'
import { GENERIC_CANDY_GIFT, petConfig } from '../config/pets.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { creditItems, debitItem } from '../db/inventory.js'
import { gardenGifts, pokemon, trainers } from '../db/schema.js'
import { petReadyAt } from '../game/pets.js'
import { type Failure, fail, parseId, readObject } from './http.js'

// Cuidado como pet (PLANNING.md, seção 5.21): carinho, berry como comida e
// presentes no chão. O catch-up liquida o jardim antes de cada ação.
export const gardenRoutes = new Hono<AuthEnv>()

type PetView = { pokemonId: number; hunger: number; affection: number; happiness: number; petReadyAt: number | null }

gardenRoutes.post('/pets/:id/pet', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => pet(c.get('userId'), id, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.pet)
})

gardenRoutes.post('/pets/:id/snack', requireUser, async (c) => {
  const id = parseId(c.req.param('id'))
  const body = await readObject(c)
  const berryKey = body?.berryKey
  if (id === null || typeof berryKey !== 'string' || !(berryKey in berries)) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const result = immediate(() => snack(c.get('userId'), id, berryKey, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.pet)
})

gardenRoutes.post('/gifts/:id/collect', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => collect(c.get('userId'), id, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.gift)
})

function errorBody(result: Failure): { error: string; readyAt?: number } {
  return { error: result.error, ...(result.readyAt !== undefined ? { readyAt: result.readyAt } : {}) }
}

function gardenPet(userId: number, pokemonId: number) {
  const row = getDb()
    .select({
      id: pokemon.id,
      location: pokemon.location,
      inPc: pokemon.inPc,
      hunger: pokemon.hunger,
      affection: pokemon.affection,
      happiness: pokemon.happiness,
      lastPetAt: pokemon.lastPetAt,
    })
    .from(pokemon)
    .where(and(eq(pokemon.id, pokemonId), eq(pokemon.userId, userId)))
    .get()
  if (!row) return fail('pokemon_not_found', 404)
  if (row.inPc) return fail('in_pc', 400)
  if (row.location !== 'garden') return fail('in_daycare', 400)
  return { ok: true as const, row }
}

function pet(userId: number, pokemonId: number, now: number): { ok: true; pet: PetView } | Failure {
  persistCatchUp(userId, now)
  const found = gardenPet(userId, pokemonId)
  if (!found.ok) return found
  const readyAt = petReadyAt(found.row.lastPetAt, now)
  if (readyAt !== null) return fail('pet_cooldown', 400, { readyAt })
  const affection = Math.min(100, found.row.affection + petConfig.petAmount)
  getDb().update(pokemon).set({ affection, lastPetAt: now }).where(eq(pokemon.id, pokemonId)).run()
  return { ok: true, pet: view({ ...found.row, affection, lastPetAt: now }, now) }
}

function snack(userId: number, pokemonId: number, berryKey: string, now: number): { ok: true; pet: PetView } | Failure {
  persistCatchUp(userId, now)
  const found = gardenPet(userId, pokemonId)
  if (!found.ok) return found
  if (found.row.hunger >= petConfig.fullAt) return fail('not_hungry', 400)
  if (!debitItem(userId, `berry:${berryKey}`)) return fail('no_berry', 400)
  const hunger = Math.min(100, found.row.hunger + petConfig.berryFill)
  getDb().update(pokemon).set({ hunger }).where(eq(pokemon.id, pokemonId)).run()
  return { ok: true, pet: view({ ...found.row, hunger }, now) }
}

function collect(
  userId: number,
  giftId: number,
  now: number,
): { ok: true; gift: { itemKey: string; quantity: number } } | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const gift = db
    .select({ itemKey: gardenGifts.itemKey, quantity: gardenGifts.quantity })
    .from(gardenGifts)
    .where(and(eq(gardenGifts.id, giftId), eq(gardenGifts.userId, userId)))
    .get()
  if (!gift) return fail('gift_not_found', 404)
  db.delete(gardenGifts).where(eq(gardenGifts.id, giftId)).run()
  if (gift.itemKey === GENERIC_CANDY_GIFT) {
    db.update(trainers)
      .set({ genericCandies: sql`${trainers.genericCandies} + ${gift.quantity}`, updatedAt: now })
      .where(eq(trainers.userId, userId))
      .run()
  } else {
    creditItems(userId, [{ itemKey: gift.itemKey, quantity: gift.quantity }])
  }
  return { ok: true, gift }
}

export function view(
  row: { id: number; hunger: number; affection: number; happiness: number; lastPetAt: number | null },
  now: number,
): PetView {
  return {
    pokemonId: row.id,
    hunger: Math.round(row.hunger),
    affection: Math.round(row.affection),
    happiness: Math.round(row.happiness),
    petReadyAt: petReadyAt(row.lastPetAt, now),
  }
}
