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
import { berries } from '../config/berries.js'
import { weatherConfig } from '../config/weather.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { sessions } from '../db/schema.js'
import { setDevWeather } from '../game/weather.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-plots-weather-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { plotRoutes } = await import('./plots.js')
const { stateRoutes } = await import('./state.js')

const app = new Hono().route('/plots', plotRoutes).route('/state', stateRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

function player(username: string): { cookie: string; userId: number } {
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
  return { cookie: `${authConfig.cookieName}=${token}`, userId }
}

async function plantOran(plotIndex: number, cookie: string) {
  const response = await app.request(
    `/plots/${plotIndex}/plant`,
    { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ berryKey: 'oran' }) },
    env,
  )
  assert.equal(response.status, 200)
  return (await response.json()) as { plantedAt: number; readyAt: number; weatherBoost: boolean }
}

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('plantar no clima favorito cresce mais rápido; em outro clima, o tempo normal', async () => {
  const { cookie, userId } = player('erika')
  assert.equal(berries.oran.favoriteWeather, 'rain')

  setDevWeather(userId, 'rain')
  const boosted = await plantOran(0, cookie)
  assert.equal(boosted.weatherBoost, true)
  assert.equal(boosted.readyAt - boosted.plantedAt, Math.round(berries.oran.growMs * weatherConfig.favoriteGrowFactor))

  setDevWeather(userId, 'sunny')
  const normal = await plantOran(1, cookie)
  assert.equal(normal.weatherBoost, false)
  assert.equal(normal.readyAt - normal.plantedAt, berries.oran.growMs)
  setDevWeather(userId, null)
})

test('o /state manda o clima de hoje, quando muda e o favorito de cada berry', async () => {
  const { cookie, userId } = player('sabrina')
  setDevWeather(userId, 'wind')
  const response = await app.request('/state', { headers: { cookie } }, env)
  const state = (await response.json()) as {
    weather: { key: string; name: string; until: number }
    weatherGrowFactor: number
    berries: { key: string; favoriteWeather: string }[]
  }
  assert.equal(state.weather.key, 'wind')
  assert.equal(state.weather.name, weatherConfig.names.wind)
  assert.ok(state.weather.until > Date.now())
  assert.equal(state.weatherGrowFactor, weatherConfig.favoriteGrowFactor)
  assert.equal(state.berries.find((berry) => berry.key === 'oran')?.favoriteWeather, 'rain')
  // A semente nunca vai ao front.
  assert.ok(!JSON.stringify(state).includes('weatherSeed'))
  setDevWeather(userId, null)
})
