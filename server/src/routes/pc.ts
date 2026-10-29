import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { immediate } from '../db/client.js'
import { moveMany, movePokemon, type Place } from '../db/team.js'
import { readObject } from './http.js'

// Tela do PC: move Pokémon entre time, jardim e PC numa transação só (uma
// troca nunca deixa ninguém no meio do caminho).

export const pcRoutes = new Hono<AuthEnv>()

const PLACES: readonly Place[] = ['team', 'garden', 'pc']

function isPlace(value: unknown): value is Place {
  return typeof value === 'string' && (PLACES as readonly string[]).includes(value)
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

pcRoutes.post('/move', requireUser, async (c) => {
  const body = await readObject(c)
  if (!body || !isId(body.pokemonId) || !isPlace(body.to)) return c.json({ error: 'invalid_body' }, 400)
  if (body.slot !== undefined && typeof body.slot !== 'number') return c.json({ error: 'invalid_body' }, 400)
  const { pokemonId, to } = body
  const slot = body.slot as number | undefined
  const result = immediate(() => movePokemon(c.get('userId'), pokemonId, to, slot))
  if (!result.ok) return c.json({ error: result.error }, result.error === 'pokemon_not_found' ? 404 : 400)
  return c.json({ ok: true })
})

pcRoutes.post('/move-many', requireUser, async (c) => {
  const body = await readObject(c)
  const ids = body?.pokemonIds
  const to = body?.to
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || !ids.every(isId) || (to !== 'garden' && to !== 'pc')) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  if (new Set(ids).size !== ids.length) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => moveMany(c.get('userId'), ids, to))
  if (!result.ok) {
    return c.json(
      { error: result.error, ...(result.pokemonId !== undefined ? { pokemonId: result.pokemonId } : {}) },
      result.error === 'pokemon_not_found' ? 404 : 400,
    )
  }
  return c.json({ ok: true })
})
