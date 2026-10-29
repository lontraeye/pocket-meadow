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
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { pokemon, sessions } from '../db/schema.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-pokemon-dev-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { pokemonRoutes } = await import('./pokemon.js')

const app = new Hono().route('/pokemon', pokemonRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

function post(url: string, body: unknown, cookie: string) {
  return app.request(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) },
    env,
  )
}

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

function starterOf(userId: number) {
  const row = getDb().select().from(pokemon).where(eq(pokemon.userId, userId)).get()
  assert.ok(row)
  return row
}

before(() => migrateDatabase())
after(() => {
  delete process.env.DEV_TOOLS
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('sem DEV_TOOLS as rotas de debug da ficha não existem', async () => {
  delete process.env.DEV_TOOLS
  const { cookie, userId } = player('brock')
  const mon = starterOf(userId)
  for (const action of ['evolve', 'level', 'shiny', 'delete']) {
    const response = await post(`/pokemon/${mon.id}/dev/${action}`, { toSpeciesId: 2, levels: 1 }, cookie)
    assert.equal(response.status, 404, action)
  }
  assert.equal(starterOf(userId).speciesId, mon.speciesId)
})

test('com DEV_TOOLS: evolui sem o nível, sobe nível, vira shiny e não apaga o último', async () => {
  process.env.DEV_TOOLS = '1'
  const { cookie, userId } = player('misty')
  const mon = starterOf(userId)
  assert.ok(mon.level < 16, 'o inicial ainda não teria nível para evoluir')

  const evolved = await post(`/pokemon/${mon.id}/dev/evolve`, { toSpeciesId: 2 }, cookie)
  assert.equal(evolved.status, 200)
  assert.equal(((await evolved.json()) as { speciesId: number }).speciesId, 2)
  assert.equal(starterOf(userId).speciesId, 2)

  const leveled = await post(`/pokemon/${mon.id}/dev/level`, { levels: 3 }, cookie)
  assert.equal(leveled.status, 200)
  assert.equal(starterOf(userId).level, mon.level + 3)
  assert.equal(starterOf(userId).xp, 0)

  const shiny = await post(`/pokemon/${mon.id}/dev/shiny`, {}, cookie)
  assert.deepEqual(await shiny.json(), { isShiny: !mon.isShiny })

  const last = await post(`/pokemon/${mon.id}/dev/delete`, {}, cookie)
  assert.equal(last.status, 400)
  assert.equal(((await last.json()) as { error: string }).error, 'last_pokemon')
})
