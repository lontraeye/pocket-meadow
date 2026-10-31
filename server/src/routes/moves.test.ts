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
import { moveProgressionConfig } from '../config/traits.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { sessions } from '../db/schema.js'
import { movesByName } from '../seed/traitsData.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-moves-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { pokemonRoutes } = await import('./pokemon.js')

const app = new Hono().route('/pokemon', pokemonRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

function player(username: string): { cookie: string; userId: number; monId: number } {
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
  const mon = getSqlite().prepare(`select id from pokemon where user_id = ?`).get(userId) as { id: number }
  return { cookie: `${authConfig.cookieName}=${token}`, userId, monId: mon.id }
}

const post = (url: string, cookie: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, env)
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error
const movesOf = (id: number) =>
  getSqlite().prepare(`select fast_move as fast, charged_move as charged, move_offer as offer from pokemon where id = ?`).get(id) as {
    fast: string
    charged: string | null
    offer: string | null
  }
const candiesOf = (userId: number) =>
  (getSqlite().prepare(`select coalesce(sum(amount), 0) as n from candies where user_id = ?`).get(userId) as { n: number }).n

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('doce sorteia o carregado de novo: gasta os doces e nunca dá golpe mais fraco', async () => {
  const { cookie, userId, monId } = player('trainer-a')
  const sql = getSqlite()
  // Chikorita Nv 55: carregados da linha são Body Slam (85, Nv 29) e Solar Beam (120, Nv 50).
  sql.prepare(`update pokemon set level = 55, charged_move = 'body-slam' where id = ?`).run(monId)
  const chain = (sql.prepare(`select evolution_chain_id as c from species where id = 152`).get() as { c: number }).c
  const cost = moveProgressionConfig.rerollCost.charged

  assert.equal(await errorOf(await post(`/pokemon/${monId}/moves/reroll`, cookie, { slot: 'charged' })), 'not_enough_candies')

  sql.prepare(`insert into candies (user_id, evolution_chain_id, amount) values (?, ?, ?)`).run(userId, chain, cost + 5)
  const before = movesByName().get('body-slam')!.power
  const response = await post(`/pokemon/${monId}/moves/reroll`, cookie, { slot: 'charged' })
  assert.equal(response.status, 200)
  const reroll = (await response.json()) as { slot: string; move: { name: string; power: number }; spent: number; balance: number }
  assert.equal(reroll.slot, 'charged')
  // O único igual ou melhor que o Body Slam até o Nv 55.
  assert.equal(reroll.move.name, 'solar-beam')
  assert.ok(reroll.move.power >= before)
  assert.equal(reroll.spent, cost)
  assert.equal(candiesOf(userId), 5)
  assert.equal(movesOf(monId).charged, reroll.move.name)
})

test('doce recusa quando já tem o golpe mais forte do tipo', async () => {
  const { cookie, userId, monId } = player('trainer-b')
  const sql = getSqlite()
  const chain = (sql.prepare(`select evolution_chain_id as c from species where id = 152`).get() as { c: number }).c
  sql.prepare(`insert into candies (user_id, evolution_chain_id, amount) values (?, ?, 100)`).run(userId, chain)
  // Nv 1: só o primeiro rápido existe, não há nada igual ou melhor para sortear.
  sql.prepare(`update pokemon set level = 1 where id = ?`).run(monId)
  assert.equal(await errorOf(await post(`/pokemon/${monId}/moves/reroll`, cookie, { slot: 'fast' })), 'no_better_move')
  assert.equal(candiesOf(userId), 100)
})

test('oferta: aprender troca o golpe do mesmo tipo; manter só tira a oferta', async () => {
  const { cookie, monId } = player('trainer-c')
  const sql = getSqlite()
  sql.prepare(`update pokemon set level = 55, charged_move = 'body-slam', move_offer = 'solar-beam' where id = ?`).run(monId)
  assert.equal((await post(`/pokemon/${monId}/moves/offer`, cookie, { accept: true })).status, 200)
  assert.deepEqual({ ...movesOf(monId), fast: undefined }, { fast: undefined, charged: 'solar-beam', offer: null })

  const fast = movesOf(monId).fast
  sql.prepare(`update pokemon set move_offer = 'razor-leaf' where id = ?`).run(monId)
  assert.equal((await post(`/pokemon/${monId}/moves/offer`, cookie, { accept: false })).status, 200)
  assert.deepEqual(movesOf(monId), { fast, charged: 'solar-beam', offer: null })
  assert.equal(await errorOf(await post(`/pokemon/${monId}/moves/offer`, cookie, { accept: true })), 'no_move_offer')
})
