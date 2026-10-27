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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-trainer-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { trainerRoutes } = await import('./trainer.js')
const { stateRoutes } = await import('./state.js')

const app = new Hono().route('/trainer', trainerRoutes).route('/state', stateRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

function send(url: string, init: RequestInit = {}) {
  return app.request(url, init, env)
}

function put(url: string, body: unknown, cookie?: string) {
  return send(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

function loginCookie(username: string): string {
  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  immediate(() => {
    const created = createPlayer({ username, googleSub: null, starter: 'bulbasaur', now })
    getDb()
      .insert(sessions)
      .values({
        id: hashToken(token),
        userId: created.userId,
        createdAt: now,
        expiresAt: now + authConfig.sessionTtlMs,
      })
      .run()
  })
  return `${authConfig.cookieName}=${token}`
}

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('PUT /trainer/prefs grava battleAuto e o /state devolve', async () => {
  const cookie = loginCookie('misty')

  const saved = await put('/trainer/prefs', { battleAuto: true }, cookie)
  assert.equal(saved.status, 200)
  assert.deepEqual(await saved.json(), { battleAuto: true })

  const state = await send('/state', { headers: { cookie } })
  assert.equal(state.status, 200)
  const body = (await state.json()) as { trainer: { battleAuto: boolean } }
  assert.equal(body.trainer.battleAuto, true)

  const off = await put('/trainer/prefs', { battleAuto: false }, cookie)
  assert.equal(off.status, 200)
  assert.deepEqual(await off.json(), { battleAuto: false })
  const again = await send('/state', { headers: { cookie } })
  assert.equal(((await again.json()) as { trainer: { battleAuto: boolean } }).trainer.battleAuto, false)
})

test('PUT /trainer/prefs recusa corpo inválido', async () => {
  const cookie = loginCookie('surge')
  assert.equal((await put('/trainer/prefs', { battleAuto: 'yes' }, cookie)).status, 400)
  assert.equal((await put('/trainer/prefs', { battleAuto: true, extra: 1 }, cookie)).status, 400)
  assert.equal((await put('/trainer/prefs', {}, cookie)).status, 400)
  assert.deepEqual(await (await put('/trainer/prefs', { auto: true }, cookie)).json(), {
    error: 'invalid_body',
  })
})

test('PUT /trainer/prefs exige login', async () => {
  assert.equal((await put('/trainer/prefs', { battleAuto: true })).status, 401)
  assert.deepEqual(await (await put('/trainer/prefs', { battleAuto: true })).json(), {
    error: 'not_signed_in',
  })
})
