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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-pc-team-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { encounterRoutes } = await import('./encounters.js')
const { pokemonRoutes } = await import('./pokemon.js')
const { stateRoutes } = await import('./state.js')
const { trainerRoutes } = await import('./trainer.js')
const { daycareRoutes } = await import('./daycare.js')

const app = new Hono()
  .route('/encounters', encounterRoutes)
  .route('/pokemon', pokemonRoutes)
  .route('/state', stateRoutes)
  .route('/trainer', trainerRoutes)
  .route('/daycare', daycareRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

type Mon = { id: number; location: string; teamSlot: number | null }

function player(username: string): { cookie: string; userId: number; starterId: number } {
  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  const userId = immediate(() => {
    const created = createPlayer({ username, googleSub: null, starter: 'bulbasaur', now })
    getDb()
      .insert(sessions)
      .values({ id: hashToken(token), userId: created.userId, createdAt: now, expiresAt: now + authConfig.sessionTtlMs })
      .run()
    return created.userId
  })
  const starter = getSqlite().prepare('select id from pokemon where user_id = ?').get(userId) as { id: number }
  return { cookie: `${authConfig.cookieName}=${token}`, userId, starterId: starter.id }
}

/** Cópia do inicial (com traços), fora do time: um "capturado" pronto para lutar. */
function clone(userId: number, starterId: number): number {
  const result = getSqlite()
    .prepare(
      `insert into pokemon (user_id, species_id, level, xp, caught_at, original_species_id, nature, ability_slot,
         fast_move, charged_move, iv_hp, iv_attack, iv_defense, iv_sp_attack, iv_sp_defense, iv_speed)
       select user_id, species_id, level, 0, caught_at, original_species_id, nature, ability_slot,
         fast_move, charged_move, iv_hp, iv_attack, iv_defense, iv_sp_attack, iv_sp_defense, iv_speed
       from pokemon where id = ? and user_id = ?`,
    )
    .run(starterId, userId)
  return Number(result.lastInsertRowid)
}

const send = (method: string, url: string, cookie: string, body: unknown = {}) =>
  app.request(url, { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, env)

async function mons(cookie: string): Promise<Map<number, Mon>> {
  const state = (await (await app.request('/state', { headers: { cookie } }, env)).json()) as { pokemon: Mon[] }
  return new Map(state.pokemon.map((mon) => [mon.id, mon]))
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error
}

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('o inicial abre o time; capturado não entra sozinho; o time aceita até 6 do jardim', async () => {
  const { cookie, userId, starterId } = player('red')
  const extra = clone(userId, starterId)
  let all = await mons(cookie)
  assert.equal(all.get(starterId)?.teamSlot, 0)
  assert.equal(all.get(extra)?.teamSlot, null)

  const ok = await send('PUT', '/trainer/team', cookie, { pokemonIds: [extra, starterId] })
  assert.equal(ok.status, 200)
  all = await mons(cookie)
  assert.equal(all.get(extra)?.teamSlot, 0)
  assert.equal(all.get(starterId)?.teamSlot, 1)

  const seven = Array.from({ length: 6 }, () => clone(userId, starterId))
  assert.equal(await errorOf(await send('PUT', '/trainer/team', cookie, { pokemonIds: [starterId, ...seven] })), 'invalid_team')
  assert.equal(await errorOf(await send('PUT', '/trainer/team', cookie, { pokemonIds: [] })), 'invalid_team')
  assert.equal(await errorOf(await send('PUT', '/trainer/team', cookie, { pokemonIds: [starterId, starterId] })), 'invalid_team')
  assert.equal((await send('PUT', '/trainer/team', cookie, { pokemonIds: [starterId, ...seven.slice(0, 5)] })).status, 200)
})

test('PC: sai do jardim e do time; o último do time não vai; do PC não entra no time', async () => {
  const { cookie, userId, starterId } = player('blue')
  const extra = clone(userId, starterId)
  const boxed = clone(userId, starterId)

  assert.equal(await errorOf(await send('POST', `/pokemon/${starterId}/pc`, cookie)), 'last_in_team')

  assert.equal((await send('POST', `/pokemon/${boxed}/pc`, cookie)).status, 200)
  let all = await mons(cookie)
  assert.equal(all.get(boxed)?.location, 'pc')
  assert.equal(await errorOf(await send('PUT', '/trainer/team', cookie, { pokemonIds: [starterId, boxed] })), 'invalid_team')
  assert.equal(await errorOf(await send('POST', '/daycare/0', cookie, { pokemonId: boxed })), 'in_pc')

  // Com dois no time, um vai para o PC e o outro sobe para a posição 0.
  assert.equal((await send('PUT', '/trainer/team', cookie, { pokemonIds: [starterId, extra] })).status, 200)
  assert.equal((await send('POST', `/pokemon/${starterId}/pc`, cookie)).status, 200)
  all = await mons(cookie)
  assert.equal(all.get(starterId)?.teamSlot, null)
  assert.equal(all.get(extra)?.teamSlot, 0)

  assert.equal((await send('POST', `/pokemon/${boxed}/garden`, cookie)).status, 200)
  all = await mons(cookie)
  assert.equal(all.get(boxed)?.location, 'garden')
  assert.equal(all.get(boxed)?.teamSlot, null)
})

test('soltar o time inteiro é recusado; soltar um do time compacta as posições', async () => {
  const { cookie, userId, starterId } = player('green')
  const a = clone(userId, starterId)
  const b = clone(userId, starterId)
  assert.equal((await send('PUT', '/trainer/team', cookie, { pokemonIds: [starterId, a] })).status, 200)
  assert.equal(await errorOf(await send('POST', '/pokemon/release', cookie, { pokemonIds: [starterId, a] })), 'last_in_team')
  assert.equal((await send('POST', `/pokemon/${starterId}/release`, cookie)).status, 200)
  const all = await mons(cookie)
  assert.equal(all.get(a)?.teamSlot, 0)
  assert.equal(all.get(b)?.teamSlot, null)
})

test('a luta leva o time inteiro, em qualquer ordem; só parte do time é recusada', async () => {
  const { cookie, userId, starterId } = player('gold')
  const a = clone(userId, starterId)
  assert.equal((await send('PUT', '/trainer/team', cookie, { pokemonIds: [starterId, a] })).status, 200)

  // Encontro só onde o jogador está (JORNADA.md, seção 11).
  getSqlite().prepare(`update trainers set current_place = 'route-29' where user_id = ?`).run(userId)
  const created = await send('POST', '/encounters', cookie, { regionSlug: 'route-29' })
  assert.equal(created.status, 201)
  const encounter = (await created.json()) as { id: number }

  assert.equal(await errorOf(await send('POST', `/encounters/${encounter.id}/battle/start`, cookie, { pokemonIds: [a] })), 'invalid_team')
  const started = await send('POST', `/encounters/${encounter.id}/battle/start`, cookie, { pokemonIds: [a, starterId] })
  assert.equal(started.status, 200)
})
