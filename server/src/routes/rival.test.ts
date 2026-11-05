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
import type { StarterKey } from '../config/trainer.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { itemQty } from '../db/inventory.js'
import { migrateDatabase } from '../db/migrate.js'
import { starterOf } from '../db/rival.js'
import { sessions } from '../db/schema.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-rival-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { encounterRoutes } = await import('./encounters.js')
const { leaderRoutes } = await import('./leaders.js')
const { placeRoutes } = await import('./places.js')
const { rivalRoutes } = await import('./rival.js')

const app = new Hono()
  .route('/encounters', encounterRoutes)
  .route('/leaders', leaderRoutes)
  .route('/places', placeRoutes)
  .route('/rival', rivalRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }
const sql = () => getSqlite()

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

function player(username: string, starter: StarterKey = 'chikorita') {
  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  const userId = immediate(() => {
    const created = createPlayer({ username, googleSub: null, starter, now })
    getDb()
      .insert(sessions)
      .values({ id: hashToken(token), userId: created.userId, createdAt: now, expiresAt: now + authConfig.sessionTtlMs })
      .run()
    return created.userId
  })
  const starterId = (sql().prepare('select id from pokemon where user_id = ?').get(userId) as { id: number }).id
  return { cookie: `${authConfig.cookieName}=${token}`, userId, starterId }
}

const post = (url: string, cookie: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, env)
const get = (url: string, cookie: string) => app.request(url, { headers: { cookie } }, env)
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

type RivalHere = { key: string; foes: { speciesId: number; level: number; ace: boolean }[]; rewards: string[] } | null
const rivalAt = async (cookie: string) =>
  ((await (await get('/places', cookie)).json()) as { here: { rival: RivalHere } }).here.rival

function goTo(userId: number, place: string) {
  sql().prepare('update trainers set current_place = ? where user_id = ?').run(place, userId)
}

function makeStrong(pokemonId: number) {
  sql()
    .prepare(
      `update pokemon set level = 100, species_id = 150, hp_ratio = 1, fainted_at = null, hunger = 100, nature = 'modest',
        fast_move = 'confusion', charged_move = 'psychic',
        iv_hp = 31, iv_attack = 31, iv_defense = 31, iv_sp_attack = 31, iv_sp_defense = 31, iv_speed = 31
       where id = ?`,
    )
    .run(pokemonId)
}

test('o rival aparece só no lugar dele, com o inicial que vence o do jogador', async () => {
  const p = player('rival-where')
  assert.equal(await rivalAt(p.cookie), null, 'em New Bark não há rival')
  assert.equal(await errorOf(await post('/rival/rival-1/challenge', p.cookie)), 'rival_not_here')

  goTo(p.userId, 'cherrygrove')
  const here = await rivalAt(p.cookie)
  assert.equal(here?.key, 'rival-1')
  // Chikorita do jogador → Cyndaquil do rival.
  assert.equal(here?.foes.at(-1)?.speciesId, 155)
  assert.deepEqual(here?.rewards, ['5 Poké Balls'])

  const water = player('rival-where-water', 'cyndaquil')
  goTo(water.userId, 'cherrygrove')
  assert.equal((await rivalAt(water.cookie))?.foes.at(-1)?.speciesId, 158)
})

test('luta de capítulo fechado não abre', async () => {
  const p = player('rival-locked')
  goTo(p.userId, 'azalea')
  assert.equal(await rivalAt(p.cookie), null)
  assert.equal(await errorOf(await post('/rival/rival-2/challenge', p.cookie)), 'rival_locked')
  assert.equal(await errorOf(await post('/rival/nao-existe/challenge', p.cookie)), 'rival_not_found')
})

test('vencer dá o prêmio uma vez e a luta some; o marco não depende dela', async () => {
  const p = player('rival-win')
  makeStrong(p.starterId)
  goTo(p.userId, 'cherrygrove')
  const balls = itemQty(p.userId, 'ball:poke')

  const started = await post('/rival/rival-1/challenge', p.cookie)
  assert.equal(started.status, 201)
  const encounter = (await started.json()) as { id: number; leader: { kind: string } | null }
  assert.equal(encounter.leader?.kind, 'rival')

  const battle = (await (await post(`/encounters/${encounter.id}/battle`, p.cookie, { pokemonIds: [p.starterId] })).json()) as {
    won: boolean
    status: string
    opponent: { kind: string; trainerKind: string; rival: { rewards: string[] } | null }
  }
  assert.equal(battle.won, true)
  assert.equal(battle.status, 'defeated')
  assert.equal(battle.opponent.trainerKind, 'rival')
  assert.deepEqual(battle.opponent.rival?.rewards, ['5 Poké Balls'])
  assert.equal(itemQty(p.userId, 'ball:poke'), balls + 5)

  assert.equal(await rivalAt(p.cookie), null)
  assert.equal(await errorOf(await post('/rival/rival-1/challenge', p.cookie)), 'rival_cleared')

  // O marco do capítulo 1 abre sem o rival: o líder de Violet aceita o desafio de quem nunca lutou com ele.
  const skip = player('rival-skip')
  goTo(skip.userId, 'violet')
  assert.equal((await post('/leaders/violet/challenge', skip.cookie)).status, 201)
})

test('conta antiga sem o inicial gravado usa o Pokémon mais antigo', () => {
  const p = player('rival-old', 'totodile')
  assert.equal(starterOf(p.userId), 158)
  sql().prepare('update trainers set starter_species_id = null where user_id = ?').run(p.userId)
  assert.equal(starterOf(p.userId), 158)
  sql().prepare('update pokemon set original_species_id = 16 where user_id = ?').run(p.userId)
  assert.equal(starterOf(p.userId), null)
})
