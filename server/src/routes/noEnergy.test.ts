import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createPlayer } from '../auth/accounts.js'
import { hashToken } from '../auth/session.js'
import { authConfig } from '../config/auth.js'
import { trainerConfig } from '../config/trainer.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { inventory, sessions, trainers } from '../db/schema.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-no-energy-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { encounterRoutes } = await import('./encounters.js')
const { itemRoutes } = await import('./items.js')
const { stateRoutes } = await import('./state.js')

const app = new Hono().route('/encounters', encounterRoutes).route('/items', itemRoutes).route('/state', stateRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

function player(username: string): { cookie: string; userId: number } {
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
  return { cookie: `${authConfig.cookieName}=${token}`, userId }
}

const post = (url: string, cookie: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, env)

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('com a energia desligada, o encontro sai mesmo com 0 e não gasta nada', async () => {
  assert.equal(trainerConfig.energyEnabled, false)
  const { cookie, userId } = player('janine')
  // Energia zerada agora (sem tempo para recarregar).
  getDb().update(trainers).set({ energy: 0, energyUpdatedAt: Date.now() }).where(eq(trainers.userId, userId)).run()

  const first = await post('/encounters', cookie, { regionSlug: 'route-1' })
  assert.equal(first.status, 201)
  const encounter = (await first.json()) as { id: number }
  assert.equal((await post(`/encounters/${encounter.id}/flee`, cookie)).status, 200)
  assert.equal((await post('/encounters', cookie, { regionSlug: 'route-1' })).status, 201)

  const row = getDb().select({ energy: trainers.energy }).from(trainers).where(eq(trainers.userId, userId)).get()
  assert.equal(row?.energy, 0)

  const state = (await (await app.request('/state', { headers: { cookie } }, env)).json()) as {
    trainer: { energyEnabled: boolean }
  }
  assert.equal(state.trainer.energyEnabled, false)
})

test('a Oran não se usa na mochila sem energia: só na captura', async () => {
  const { cookie, userId } = player('koga')
  getDb().insert(inventory).values({ userId, itemKey: 'berry:oran', quantity: 1 }).run()

  const response = await post('/items/berry:oran/use', cookie)
  assert.equal(response.status, 400)
  assert.equal(((await response.json()) as { error: string }).error, 'berry_not_usable')

  const state = (await (await app.request('/state', { headers: { cookie } }, env)).json()) as {
    berries: { key: string; bagUsable: boolean; effectDescription: string; capture: { description: string } | null }[]
  }
  const oran = state.berries.find((berry) => berry.key === 'oran')
  assert.equal(oran?.bagUsable, false)
  assert.equal(oran?.effectDescription, oran?.capture?.description)
})
