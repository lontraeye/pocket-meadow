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
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { missionDay, missionsView } from '../db/missions.js'
import { sessions } from '../db/schema.js'
import { drawDay, missionText, type MissionContext } from '../game/missions.js'
import { mulberry32 } from '../game/rng.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-missions-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { missionRoutes } = await import('./missions.js')

migrateDatabase()
const app = new Hono().route('/missions', missionRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

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

const post = (cookie: string, url: string) =>
  app.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }, env)

/** Um selvagem vencido (e capturado, se `caught`) agora. */
function win(userId: number, caught = false) {
  const now = Date.now()
  getSqlite()
    .prepare(
      `insert into encounters (user_id, region_slug, species_id, level, rng_seed, status, created_at, expires_at, won_at, resolved_at)
       values (?, 'route-29', 16, 3, 1, ?, ?, ?, ?, ?)`,
    )
    .run(userId, caught ? 'caught' : 'pending', now, now + 60_000, now, caught ? now : null)
}

const ctx: MissionContext = {
  level: 5,
  areas: [{ slug: 'route-29', name: 'Rota 29' }],
  areaTypes: ['normal', 'flying'],
  teamTypes: ['grass'],
  hasNewSpecies: true,
}

test('drawDay: 3 missões de tipos diferentes, só as possíveis', () => {
  for (let seed = 1; seed < 50; seed += 1) {
    const day = drawDay(ctx, mulberry32(seed))
    assert.equal(day.length, 3)
    assert.equal(new Set(day.map((m) => m.kind)).size, 3)
  }
  const poor = drawDay({ ...ctx, areas: [], areaTypes: [], teamTypes: [], hasNewSpecies: false }, mulberry32(3))
  assert.deepEqual(poor.map((m) => m.kind).sort(), ['catch_any', 'win_any'])
})

test('missionText: textos em português', () => {
  assert.equal(missionText('win_area', { region: 'route-29', regionName: 'Rota 29' }, 3), 'Vença 3 lutas em Rota 29')
  assert.equal(missionText('catch_type', { type: 'water' }, 2), 'Capture 2 Pokémon do tipo Água')
})

test('missões do dia: gravadas uma vez, progresso, resgate, baú e troca', async () => {
  const { cookie, userId } = player('missao1')
  const sqlite = getSqlite()
  const first = immediate(() => missionsView(userId, 5, Date.now()))
  assert.equal(first.list.length, 3)
  assert.equal(first.day, missionDay(Date.now()))
  const again = immediate(() => missionsView(userId, 5, Date.now()))
  assert.deepEqual(again.list.map((m) => m.text), first.list.map((m) => m.text), 'recarregar não sorteia de novo')

  // Fixa as missões para o teste: vencer 2, capturar 1, vencer 1.
  const ids = first.list.map((m) => m.id)
  const set = sqlite.prepare("update daily_missions set kind = ?, params = '{}', target = ?, assigned_at = ? where id = ?")
  const since = Date.now() - 1000
  set.run('win_any', 2, since, ids[0])
  set.run('catch_any', 1, since, ids[1])
  set.run('win_any', 1, since, ids[2])

  const early = await post(cookie, `/missions/${ids[0]}/claim`)
  assert.equal(early.status, 400)
  assert.equal(((await early.json()) as { error: string }).error, 'mission_not_done')

  win(userId)
  win(userId, true)
  const balls = () =>
    (sqlite.prepare("select coalesce(sum(quantity), 0) q from inventory where user_id = ? and item_key = 'ball:poke'").get(userId) as { q: number }).q
  const before = balls()
  const ok = await post(cookie, `/missions/${ids[0]}/claim`)
  assert.equal(ok.status, 200)
  assert.equal(balls(), before + 5)
  assert.equal((await post(cookie, `/missions/${ids[0]}/claim`)).status, 409)

  assert.equal((await post(cookie, '/missions/chest/claim')).status, 400, 'baú só com as 3')
  assert.equal((await post(cookie, `/missions/${ids[1]}/claim`)).status, 200)

  // Troca: uma por dia, só em missão não resgatada.
  assert.equal((await post(cookie, `/missions/${ids[0]}/reroll`)).status, 409)
  const swapped = await post(cookie, `/missions/${ids[2]}/reroll`)
  assert.equal(swapped.status, 200)
  assert.equal((await post(cookie, `/missions/${ids[2]}/reroll`)).status, 400)

  // Volta a missão trocada para algo já cumprido e fecha o dia.
  set.run('win_any', 1, since, ids[2])
  assert.equal((await post(cookie, `/missions/${ids[2]}/claim`)).status, 200)
  const chest = await post(cookie, '/missions/chest/claim')
  assert.equal(chest.status, 200)
  assert.equal((await post(cookie, '/missions/chest/claim')).status, 409)
  const view = immediate(() => missionsView(userId, 5, Date.now()))
  assert.equal(view.claimable, 0)
  assert.ok(view.chest.claimed)
})
