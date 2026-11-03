import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { Hono } from 'hono'
import { createPlayer } from '../auth/accounts.js'
import { hashToken } from '../auth/session.js'
import { APRICORN_ITEM } from '../config/apricorn.js'
import { authConfig } from '../config/auth.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { sessions } from '../db/schema.js'
import { setDevWeather } from '../game/weather.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-apricorn-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { gardenRoutes } = await import('./garden.js')
const { stateRoutes } = await import('./state.js')

migrateDatabase()
const app = new Hono().route('/garden', gardenRoutes).route('/state', stateRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }
const hourMs = 60 * 60 * 1000

after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

function player(username: string, level: number): { cookie: string; userId: number } {
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
  getSqlite().prepare('update trainers set level = ? where user_id = ?').run(level, userId)
  // O clima de hoje fixo; os dias anteriores seguem a semente.
  setDevWeather(userId, 'sunny')
  return { cookie: `${authConfig.cookieName}=${token}`, userId }
}

const harvest = (cookie: string) =>
  app.request('/garden/tree/harvest', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }, env)
const tree = async (cookie: string) => {
  const state = (await (await app.request('/state', { headers: { cookie } }, env)).json()) as {
    garden: { tree: { unlocked: boolean; ready: number; cap: number; readyAts: number[] } }
  }
  return state.garden.tree
}
const apricorns = (userId: number) =>
  (getSqlite().prepare('select quantity from inventory where user_id = ? and item_key = ?').get(userId, APRICORN_ITEM) as
    | { quantity: number }
    | undefined)?.quantity ?? 0
const rewind = (userId: number, ms: number) =>
  getSqlite().prepare("update garden_structures set since = since - ? where user_id = ? and key = 'apricorn_tree'").run(ms, userId)

test('fechada abaixo do nível', async () => {
  const p = player('arvore-fechada', 1)
  assert.equal((await tree(p.cookie)).unlocked, false)
  const response = await harvest(p.cookie)
  assert.equal(response.status, 400)
  assert.equal(((await response.json()) as { error: string }).error, 'tree_locked')
})

test('abre com 1 pendurado; colher leva para a mochila e zera', async () => {
  const p = player('arvore-abre', 2)
  const first = await tree(p.cookie)
  assert.equal(first.unlocked, true)
  assert.equal(first.ready, 1)
  assert.equal(first.readyAts.length, 4)

  const response = await harvest(p.cookie)
  assert.equal(response.status, 200)
  const body = (await response.json()) as { quantity: number; tree: { ready: number } }
  assert.equal(body.quantity, 1)
  assert.equal(body.tree.ready, 0)
  assert.equal(apricorns(p.userId), 1)

  const again = await harvest(p.cookie)
  assert.equal(again.status, 400)
  assert.equal(((await again.json()) as { error: string }).error, 'nothing_ready')
})

test('cresce com o tempo e para cheia', async () => {
  const p = player('arvore-cresce', 3)
  await tree(p.cookie)
  rewind(p.userId, 100 * hourMs)
  const full = await tree(p.cookie)
  assert.equal(full.ready, full.cap)
  assert.deepEqual(full.readyAts, [])
  const body = (await (await harvest(p.cookie)).json()) as { quantity: number }
  assert.equal(body.quantity, 5)
  assert.equal(apricorns(p.userId), 5)
})
