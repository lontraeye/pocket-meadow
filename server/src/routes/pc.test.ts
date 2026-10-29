import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { Hono } from 'hono'
import { createPlayer } from '../auth/accounts.js'
import { hashToken } from '../auth/session.js'
import { authConfig } from '../config/auth.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { sessions } from '../db/schema.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-pc-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { pcRoutes } = await import('./pc.js')

const app = new Hono().route('/pc', pcRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

function player(username: string): { cookie: string; userId: number; starterId: number } {
  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  const userId = immediate(() => {
    const created = createPlayer({ username, googleSub: null, starter: 'chikorita', now })
    getDb()
      .insert(sessions)
      .values({ id: hashToken(token), userId: created.userId, createdAt: now, expiresAt: now + authConfig.sessionTtlMs })
      .run()
    return created.userId
  })
  const starter = getSqlite().prepare('select id from pokemon where user_id = ?').get(userId) as { id: number }
  return { cookie: `${authConfig.cookieName}=${token}`, userId, starterId: starter.id }
}

/** Um Pokémon a mais no jardim (cópia do inicial). */
function extra(userId: number, starterId: number, where: 'garden' | 'pc' | 'daycare' = 'garden'): number {
  const result = getSqlite()
    .prepare(
      `insert into pokemon (user_id, species_id, level, xp, caught_at, original_species_id, location, in_pc)
       select user_id, species_id, level, 0, caught_at, original_species_id, ?, ?
       from pokemon where id = ?`,
    )
    .run(where === 'daycare' ? 'daycare' : 'garden', where === 'pc' ? 1 : 0, starterId)
  return Number(result.lastInsertRowid)
}

/** Onde cada um está: 't0'..'t5' (time), 'garden', 'pc' ou 'daycare'. */
function where(id: number): string {
  const row = getSqlite().prepare('select location, in_pc, team_slot from pokemon where id = ?').get(id) as {
    location: string
    in_pc: number
    team_slot: number | null
  }
  if (row.team_slot !== null) return `t${row.team_slot}`
  return row.location === 'daycare' ? 'daycare' : row.in_pc ? 'pc' : 'garden'
}

const move = (cookie: string, body: unknown) =>
  app.request('/pc/move', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, env)
const moveMany = (cookie: string, body: unknown) =>
  app.request('/pc/move-many', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, env)
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('entra no fim do time; time cheio recusa; numa vaga ocupada, troca (quem sai vai para onde o outro estava)', async () => {
  const { cookie, userId, starterId } = player('red')
  const a = extra(userId, starterId)
  assert.equal((await move(cookie, { pokemonId: a, to: 'team' })).status, 200)
  assert.equal(where(a), 't1')

  const more = Array.from({ length: 4 }, () => extra(userId, starterId))
  for (const id of more) assert.equal((await move(cookie, { pokemonId: id, to: 'team' })).status, 200)
  const full = extra(userId, starterId)
  assert.equal(await errorOf(await move(cookie, { pokemonId: full, to: 'team' })), 'team_full')

  // Do jardim para a vaga 0: o inicial sai para o jardim.
  assert.equal((await move(cookie, { pokemonId: full, to: 'team', slot: 0 })).status, 200)
  assert.equal(where(full), 't0')
  assert.equal(where(starterId), 'garden')

  // Do PC para a vaga 1: quem estava lá vai para o PC.
  const boxed = extra(userId, starterId, 'pc')
  assert.equal((await move(cookie, { pokemonId: boxed, to: 'team', slot: 1 })).status, 200)
  assert.equal(where(boxed), 't1')
  assert.equal(where(a), 'pc')
})

test('dentro do time, reordena trocando de vaga', async () => {
  const { cookie, userId, starterId } = player('blue')
  const a = extra(userId, starterId)
  const b = extra(userId, starterId)
  await move(cookie, { pokemonId: a, to: 'team' })
  await move(cookie, { pokemonId: b, to: 'team' })
  assert.equal((await move(cookie, { pokemonId: starterId, to: 'team', slot: 2 })).status, 200)
  assert.deepEqual([where(starterId), where(a), where(b)], ['t2', 't1', 't0'])
  assert.equal(await errorOf(await move(cookie, { pokemonId: a, to: 'team', slot: 9 })), 'invalid_slot')
})

test('PC e jardim: o time não esvazia, vários de uma vez, daycare não sai', async () => {
  const { cookie, userId, starterId } = player('green')
  assert.equal(await errorOf(await move(cookie, { pokemonId: starterId, to: 'pc' })), 'last_in_team')

  const a = extra(userId, starterId)
  const b = extra(userId, starterId)
  assert.equal((await moveMany(cookie, { pokemonIds: [a, b], to: 'pc' })).status, 200)
  assert.deepEqual([where(a), where(b)], ['pc', 'pc'])
  assert.equal(await errorOf(await moveMany(cookie, { pokemonIds: [a, starterId], to: 'garden' })), 'last_in_team')
  assert.equal((await moveMany(cookie, { pokemonIds: [a], to: 'garden' })).status, 200)
  assert.equal(where(a), 'garden')

  const resting = extra(userId, starterId, 'daycare')
  assert.equal(await errorOf(await move(cookie, { pokemonId: resting, to: 'pc' })), 'in_daycare')
  assert.equal(await errorOf(await moveMany(cookie, { pokemonIds: [resting], to: 'pc' })), 'in_daycare')
  assert.equal(await errorOf(await move(cookie, { pokemonId: 999999, to: 'pc' })), 'pokemon_not_found')
})
