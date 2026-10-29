import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createPlayer } from '../auth/accounts.js'
import { hashToken } from '../auth/session.js'
import { authConfig } from '../config/auth.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { itemQty } from '../db/inventory.js'
import { migrateDatabase } from '../db/migrate.js'
import { encounters, sessions } from '../db/schema.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-miss-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { encounterRoutes } = await import('./encounters.js')

const app = new Hono().route('/encounters', encounterRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

function post(url: string, body: unknown, cookie: string) {
  return app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  }, env)
}

function loginPlayer(username: string): { cookie: string; userId: number } {
  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  let userId = 0
  immediate(() => {
    const created = createPlayer({ username, googleSub: null, starter: 'chikorita', now })
    userId = created.userId
    getDb()
      .insert(sessions)
      .values({
        id: hashToken(token),
        userId,
        createdAt: now,
        expiresAt: now + authConfig.sessionTtlMs,
      })
      .run()
  })
  return { cookie: `${authConfig.cookieName}=${token}`, userId }
}

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('POST /miss debita a bola e não muda throw_count nem agitation', async () => {
  const { cookie, userId } = loginPlayer('miss-ash')
  const now = Date.now()
  const beforeBalls = itemQty(userId, 'ball:poke')
  assert.ok(beforeBalls > 0)

  const encounterId = immediate(() => {
    const row = getDb()
      .insert(encounters)
      .values({
        userId,
        regionSlug: 'route-1',
        speciesId: 16,
        level: 5,
        isShiny: false,
        rngSeed: 12345,
        secretSeed: 67890,
        status: 'pending',
        wonAt: now,
        throwCount: 2,
        agitation: 3,
        createdAt: now,
        expiresAt: now + 60_000,
      })
      .returning({ id: encounters.id })
      .get()
    return row!.id
  })

  const res = await post(`/encounters/${encounterId}/miss`, { ball: 'poke' }, cookie)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { ball: string; throwCount: number; agitation: number }
  assert.equal(body.ball, 'poke')
  assert.equal(body.throwCount, 2)
  assert.equal(body.agitation, 3)
  assert.equal(itemQty(userId, 'ball:poke'), beforeBalls - 1)

  const row = getDb()
    .select({
      throwCount: encounters.throwCount,
      agitation: encounters.agitation,
      status: encounters.status,
    })
    .from(encounters)
    .where(and(eq(encounters.id, encounterId), eq(encounters.userId, userId)))
    .get()
  assert.equal(row?.throwCount, 2)
  assert.equal(row?.agitation, 3)
  assert.equal(row?.status, 'pending')
})

test('POST /miss sem bola → no_ball', async () => {
  const { cookie, userId } = loginPlayer('miss-broke')
  const now = Date.now()
  const encounterId = immediate(() => {
    const row = getDb()
      .insert(encounters)
      .values({
        userId,
        regionSlug: 'route-1',
        speciesId: 16,
        level: 5,
        isShiny: false,
        rngSeed: 1,
        secretSeed: 2,
        status: 'pending',
        wonAt: now,
        throwCount: 0,
        agitation: 0,
        createdAt: now,
        expiresAt: now + 60_000,
      })
      .returning({ id: encounters.id })
      .get()
    return row!.id
  })

  const res = await post(`/encounters/${encounterId}/miss`, { ball: 'master' }, cookie)
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'no_ball' })
})
