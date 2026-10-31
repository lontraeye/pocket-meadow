import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { Hono } from 'hono'
import { createPlayer } from '../auth/accounts.js'
import { hashToken } from '../auth/session.js'
import { authConfig } from '../config/auth.js'
import { petConfig } from '../config/pets.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { settleGarden } from '../db/pets.js'
import { sessions } from '../db/schema.js'
import { gardenXp, pickGift, settlePet } from '../game/pets.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-garden-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { gardenRoutes } = await import('./garden.js')

migrateDatabase()
const app = new Hono().route('/garden', gardenRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }
const hourMs = 60 * 60 * 1000

after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

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

type PetRow = { hunger: number; affection: number; happiness: number; pet_at: number | null; level: number; xp: number }
const petRow = (id: number) =>
  getSqlite().prepare('select hunger, affection, happiness, pet_at, level, xp from pokemon where id = ?').get(id) as PetRow

const post = (cookie: string, url: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)

test('settlePet: necessidades caem; a felicidade sobe até cruzar o limite e cai depois', () => {
  const cared = settlePet({ hunger: 100, affection: 100, happiness: 0 }, 0, 6 * hourMs)
  assert.equal(Math.round(cared.hunger), 50)
  assert.equal(Math.round(cared.affection), 75)
  assert.ok(cared.happiness > 12 && cared.happiness < 13)

  // Fome cruza 40 em 7,2 h: sobe até lá e cai nas 4,8 h seguintes.
  const day = settlePet({ hunger: 100, affection: 100, happiness: 50 }, 0, 12 * hourMs)
  const top = 50 + petConfig.happinessUpPerHour * 7.2
  assert.ok(Math.abs(day.happiness - (top - petConfig.happinessDownPerHour * 4.8)) < 1e-9)
  assert.equal(day.hunger, 0)

  const neglected = settlePet({ hunger: 10, affection: 10, happiness: 30 }, 0, 24 * hourMs)
  assert.ok(neglected.happiness < 30)
  assert.equal(settlePet({ hunger: 0, affection: 0, happiness: 1 }, 0, 100 * hourMs).happiness, 0)
})

test('gardenXp: cresce com o nível e a felicidade; sem felicidade, nada', () => {
  assert.equal(gardenXp(10, 100, 3), 30)
  assert.equal(gardenXp(10, 50, 3), 15)
  assert.equal(gardenXp(10, 0, 24), 0)
})

test('pickGift: sorteio ponderado cobre a tabela inteira', () => {
  const table = [{ weight: 1, k: 'a' }, { weight: 3, k: 'b' }]
  assert.equal(pickGift(table, 0).k, 'a')
  assert.equal(pickGift(table, 0.3).k, 'b')
  assert.equal(pickGift(table, 0.999).k, 'b')
})

test('jardim: começa a contar ao entrar, liquida o tempo e dá XP ao pet feliz', () => {
  const { userId, starterId } = player('pet1')
  const t0 = 1_000_000_000_000
  immediate(() => settleGarden(userId, t0))
  assert.equal(petRow(starterId).pet_at, t0)

  getSqlite().prepare('update pokemon set hunger = 100, affection = 100, happiness = 100, level = 10, xp = 0 where id = ?').run(starterId)
  immediate(() => settleGarden(userId, t0 + 3 * hourMs))
  const row = petRow(starterId)
  assert.equal(row.pet_at, t0 + 3 * hourMs)
  assert.equal(Math.round(row.hunger), 75)
  assert.equal(row.xp, 30, 'Nv 10 feliz: 1 × 10 × 1 × 3 h')
})

test('jardim: no PC congela e não ganha nada; presentes saem do pet feliz', () => {
  const { userId, starterId } = player('pet2')
  const t0 = 1_000_000_000_000
  const sqlite = getSqlite()
  sqlite.prepare('update pokemon set hunger = 100, affection = 100, happiness = 100, pet_at = ?, last_gift_at = ? where id = ?').run(t0, t0, starterId)
  immediate(() => settleGarden(userId, t0 + petConfig.gifts.intervalMs))
  const gifts = sqlite.prepare('select item_key, quantity from garden_gifts where user_id = ?').all(userId)
  assert.equal(gifts.length, 1)

  sqlite.prepare('update pokemon set in_pc = 1 where id = ?').run(starterId)
  immediate(() => settleGarden(userId, t0 + petConfig.gifts.intervalMs + hourMs))
  const frozen = petRow(starterId)
  assert.equal(frozen.pet_at, null)
  immediate(() => settleGarden(userId, t0 + 100 * hourMs))
  assert.deepEqual(petRow(starterId), frozen, 'no PC nada muda')
})

test('rotas: carinho com intervalo, berry como comida, coletar presente', async () => {
  const { cookie, userId, starterId } = player('pet3')
  const sqlite = getSqlite()
  sqlite.prepare('update pokemon set affection = 10, hunger = 20 where id = ?').run(starterId)

  const first = await post(cookie, `/garden/pets/${starterId}/pet`)
  assert.equal(first.status, 200)
  const body = (await first.json()) as { affection: number; petReadyAt: number | null }
  assert.ok(body.affection >= 39 && body.affection <= 40)
  assert.ok(body.petReadyAt !== null)
  const again = await post(cookie, `/garden/pets/${starterId}/pet`)
  assert.equal(again.status, 400)
  assert.equal(((await again.json()) as { error: string }).error, 'pet_cooldown')

  const noBerry = await post(cookie, `/garden/pets/${starterId}/snack`, { berryKey: 'oran' })
  assert.equal(((await noBerry.json()) as { error: string }).error, 'no_berry')
  sqlite.prepare("insert into inventory (user_id, item_key, quantity) values (?, 'berry:oran', 2)").run(userId)
  const fed = await post(cookie, `/garden/pets/${starterId}/snack`, { berryKey: 'oran' })
  assert.equal(fed.status, 200)
  assert.ok(((await fed.json()) as { hunger: number }).hunger >= 59)
  sqlite.prepare('update pokemon set hunger = 95 where id = ?').run(starterId)
  const full = await post(cookie, `/garden/pets/${starterId}/snack`, { berryKey: 'oran' })
  assert.equal(((await full.json()) as { error: string }).error, 'not_hungry')

  const before = (sqlite.prepare('select generic_candies from trainers where user_id = ?').get(userId) as { generic_candies: number }).generic_candies
  const gift = sqlite
    .prepare("insert into garden_gifts (user_id, pokemon_id, item_key, quantity, created_at) values (?, ?, 'generic_candy', 2, ?)")
    .run(userId, starterId, Date.now())
  const got = await post(cookie, `/garden/gifts/${gift.lastInsertRowid}/collect`)
  assert.equal(got.status, 200)
  const afterCandies = (sqlite.prepare('select generic_candies from trainers where user_id = ?').get(userId) as { generic_candies: number }).generic_candies
  assert.equal(afterCandies, before + 2)
  const twice = await post(cookie, `/garden/gifts/${gift.lastInsertRowid}/collect`)
  assert.equal(twice.status, 404)
})
