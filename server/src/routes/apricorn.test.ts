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

/** Marca marcos como conquistados (o jardim abre por eles). */
const clear = (userId: number, ...keys: string[]) => {
  for (const key of keys) {
    getSqlite().prepare('insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, ?)').run(userId, key, Date.now())
  }
}

const harvest = (cookie: string) =>
  app.request('/garden/tree/harvest', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }, env)
type TreeState = {
  key: string
  unlocked: boolean
  ready: number
  cap: number
  readyAts: number[]
  unlockAt: { milestone: string; name: string } | null
}
const trees = async (cookie: string) => {
  const state = (await (await app.request('/state', { headers: { cookie } }, env)).json()) as { garden: { trees: TreeState[] } }
  return state.garden.trees
}
const tree = async (cookie: string) => (await trees(cookie))[0]!
const apricorns = (userId: number) =>
  (getSqlite().prepare('select quantity from inventory where user_id = ? and item_key = ?').get(userId, APRICORN_ITEM) as
    | { quantity: number }
    | undefined)?.quantity ?? 0
const rewind = (userId: number, ms: number) =>
  getSqlite().prepare("update garden_structures set since = since - ? where user_id = ? and key = 'apricorn_tree'").run(ms, userId)

test('a vermelha vem desde o começo; a azul abre no Marco de Goldenrod, a amarela no de Olivine', async () => {
  const p = player('arvore-fechada', 1)
  const all = await trees(p.cookie)
  assert.equal(all.find((row) => row.key === 'apricorn_tree')?.unlocked, true)
  const blue = all.find((row) => row.key === 'apricorn_tree_blue')!
  assert.deepEqual([blue.unlocked, blue.unlockAt?.milestone], [false, 'goldenrod'])
  assert.equal(all.find((row) => row.key === 'apricorn_tree_yellow')?.unlockAt?.milestone, 'olivine')
  const response = await app.request(
    '/garden/tree/harvest',
    { method: 'POST', headers: { cookie: p.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ key: 'apricorn_tree_blue' }) },
    env,
  )
  assert.equal(((await response.json()) as { error: string }).error, 'tree_locked')

  clear(p.userId, 'goldenrod')
  const opened = (await trees(p.cookie)).find((row) => row.key === 'apricorn_tree_blue')!
  assert.deepEqual([opened.unlocked, opened.unlockAt, opened.ready], [true, null, 1])
})

test('abre com 1 pendurado; colher leva para a mochila e zera', async () => {
  const p = player('arvore-abre', 1)
  const first = await tree(p.cookie)
  assert.equal(first.unlocked, true)
  assert.equal(first.ready, 1)
  assert.equal(first.readyAts.length, 4)

  const response = await harvest(p.cookie)
  assert.equal(response.status, 200)
  const body = (await response.json()) as { quantity: number; trees: { ready: number }[] }
  assert.equal(body.quantity, 1)
  assert.equal(body.trees[0]!.ready, 0)
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

// Bancada de bolas (5.23).
const addMon = (userId: number, speciesId: number) =>
  Number(
    getSqlite()
      .prepare('insert into pokemon (user_id, species_id, level, caught_at, original_species_id) values (?, ?, 5, ?, ?)')
      .run(userId, speciesId, Date.now(), speciesId).lastInsertRowid,
  )
const bench = (cookie: string, action: string, body: unknown = {}) =>
  app.request(`/garden/bench/${action}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error
const balls = (userId: number) =>
  (getSqlite().prepare("select quantity from inventory where user_id = ? and item_key = 'ball:poke'").get(userId) as
    | { quantity: number }
    | undefined)?.quantity ?? 0
const giveApricorns = (userId: number, quantity: number) =>
  getSqlite()
    .prepare('insert into inventory (user_id, item_key, quantity) values (?, ?, ?) on conflict do update set quantity = quantity + excluded.quantity')
    .run(userId, APRICORN_ITEM, quantity)
const rewindJob = (userId: number, ms: number) =>
  getSqlite().prepare('update craft_jobs set started_at = started_at - ? where user_id = ?').run(ms, userId)

test('operador: só Normal, Lutador ou Aço, fora do time', async () => {
  const p = player('bancada-operador', 2)
  const sentret = addMon(p.userId, 161)
  const chikorita = (getSqlite().prepare('select id from pokemon where user_id = ? and species_id = 152').get(p.userId) as { id: number }).id
  assert.equal(await errorOf(await bench(p.cookie, 'operator', { pokemonId: chikorita })), 'in_team')
  const bulbasaur = addMon(p.userId, 1)
  assert.equal(await errorOf(await bench(p.cookie, 'operator', { pokemonId: bulbasaur })), 'wrong_type')
  const response = await bench(p.cookie, 'operator', { pokemonId: sentret })
  assert.equal(response.status, 200)
  assert.equal(((await response.json()) as { bench: { operatorId: number } }).bench.operatorId, sentret)
})

test('lote de Poké Balls: começa, coleta as prontas, cancela devolvendo o resto', async () => {
  const p = player('bancada-lote', 2)
  const sentret = addMon(p.userId, 161)
  assert.equal(await errorOf(await bench(p.cookie, 'start', { quantity: 1 })), 'no_operator')
  await bench(p.cookie, 'operator', { pokemonId: sentret })
  assert.equal(await errorOf(await bench(p.cookie, 'start', { quantity: 3 })), 'no_apricorn')
  assert.equal(await errorOf(await bench(p.cookie, 'start', { quantity: 6 })), 'invalid_quantity')

  giveApricorns(p.userId, 5)
  const before = balls(p.userId)
  const started = await bench(p.cookie, 'start', { quantity: 5 })
  assert.equal(started.status, 200)
  const job = ((await started.json()) as { job: { unitMs: number } }).job
  assert.equal(apricorns(p.userId), 0)
  assert.equal(await errorOf(await bench(p.cookie, 'operator', { pokemonId: null })), 'bench_busy')
  assert.equal(await errorOf(await bench(p.cookie, 'collect')), 'nothing_ready')

  rewindJob(p.userId, job.unitMs * 2)
  const collected = (await (await bench(p.cookie, 'collect')).json()) as { balls: number }
  // Cada Apricorn vira 2 Poké Balls.
  assert.equal(collected.balls, 4)
  assert.equal(balls(p.userId), before + 4)

  rewindJob(p.userId, job.unitMs)
  const cancelled = (await (await bench(p.cookie, 'cancel')).json()) as { balls: number; refunded: number; bench: { job: unknown } }
  assert.deepEqual([cancelled.balls, cancelled.refunded], [2, 2])
  assert.equal(cancelled.bench.job, null)
  assert.equal(balls(p.userId), before + 6)
  assert.equal(apricorns(p.userId), 2)
})

test('operador feliz trabalha mais rápido; operador não vai para o time, PC nem daycare', async () => {
  const p = player('bancada-trava', 2)
  const sentret = addMon(p.userId, 161)
  getSqlite().prepare('update pokemon set happiness = 100 where id = ?').run(sentret)
  await bench(p.cookie, 'operator', { pokemonId: sentret })
  giveApricorns(p.userId, 1)
  const job = ((await (await bench(p.cookie, 'start', { quantity: 1 })).json()) as { job: { unitMs: number } }).job
  assert.ok(job.unitMs < 30 * 60 * 1000 && job.unitMs >= 22.5 * 60 * 1000 - 1)

  const { movePokemon, setTeam } = await import('../db/team.js')
  const starter = (getSqlite().prepare('select id from pokemon where user_id = ? and team_slot = 0').get(p.userId) as { id: number }).id
  assert.deepEqual(immediate(() => movePokemon(p.userId, sentret, 'team')), { ok: false, error: 'operating' })
  assert.deepEqual(immediate(() => movePokemon(p.userId, sentret, 'pc')), { ok: false, error: 'operating' })
  assert.deepEqual(immediate(() => setTeam(p.userId, [starter, sentret])), { ok: false, error: 'operating' })
})

test('Headbutt pode soltar Apricorn', async () => {
  const { spotDropsConfig } = await import('../config/spotDrops.js')
  const row = spotDropsConfig.tables.headbutt.find((entry) => entry.itemKey === APRICORN_ITEM)
  assert.ok(row && row.weight > 0)
})

test('upgrade da bancada: pede o marco e itens, leva tempo, libera Great Ball', async () => {
  const p = player('bancada-upgrade', 1)
  clear(p.userId, 'goldenrod')
  const sentret = addMon(p.userId, 161)
  await bench(p.cookie, 'operator', { pokemonId: sentret })
  assert.equal(await errorOf(await bench(p.cookie, 'upgrade')), 'missing_items')
  assert.equal(await errorOf(await bench(p.cookie, 'start', { recipeKey: 'great_ball', quantity: 1 })), 'recipe_locked')

  giveApricorns(p.userId, 15)
  getSqlite().prepare("insert into inventory (user_id, item_key, quantity) values (?, 'berry:oran', 5)").run(p.userId)
  const started = await bench(p.cookie, 'upgrade')
  assert.equal(started.status, 200)
  const body = (await started.json()) as { toLevel: number; bench: { upgrade: { toLevel: number } | null; level: number } }
  assert.equal(body.toLevel, 2)
  assert.equal(body.bench.level, 1)
  assert.equal(apricorns(p.userId), 0)
  // Parada durante o upgrade.
  giveApricorns(p.userId, 1)
  assert.equal(await errorOf(await bench(p.cookie, 'start', { quantity: 1 })), 'bench_upgrading')

  // Termina: nível 2, lote de 10, Great Ball liberada (a árvore azul veio com o marco).
  getSqlite().prepare("update garden_structures set upgrade_ends_at = ? where user_id = ? and key = 'ball_bench'").run(Date.now() - 1, p.userId)
  const { benchView } = await import('../db/bench.js')
  const { treesView } = await import('../db/apricorn.js')
  const state = immediate(() => ({
    garden: { bench: benchView(p.userId, Date.now()), trees: treesView(p.userId, Date.now()) },
  }))
  assert.equal(state.garden.bench.level, 2)
  assert.equal(state.garden.bench.batchSize, 10)
  assert.equal(state.garden.bench.upgrade, null)
  assert.equal(state.garden.bench.recipes.find((r) => r.key === 'great_ball')?.unlocked, true)
  const blue = state.garden.trees.find((t) => t.key === 'apricorn_tree_blue')!
  assert.deepEqual([blue.unlocked, blue.ready], [true, 1])
  assert.equal(state.garden.trees.find((t) => t.key === 'apricorn_tree_yellow')?.unlocked, false)

  // Colhe o azul e faz uma Great Ball.
  const harvested = (await (
    await app.request('/garden/tree/harvest', { method: 'POST', headers: { cookie: p.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ key: 'apricorn_tree_blue' }) }, env)
  ).json()) as { itemKey: string; quantity: number }
  assert.deepEqual(harvested.itemKey, 'mat:apricorn-blue')
  const job = ((await (await bench(p.cookie, 'start', { recipeKey: 'great_ball', quantity: 1 })).json()) as { job: { unitMs: number; perUnit: number } }).job
  assert.equal(job.perUnit, 1)
  rewindJob(p.userId, job.unitMs)
  const collected = (await (await bench(p.cookie, 'collect')).json()) as { balls: number; itemKey: string }
  assert.deepEqual([collected.balls, collected.itemKey], [1, 'ball:great'])
})

test('upgrade pede o marco, não o nível de treinador', async () => {
  const p = player('bancada-nivel', 30)
  giveApricorns(p.userId, 15)
  getSqlite().prepare("insert into inventory (user_id, item_key, quantity) values (?, 'berry:oran', 5)").run(p.userId)
  assert.equal(await errorOf(await bench(p.cookie, 'upgrade')), 'milestone_needed')
  const state = (await (await app.request('/state', { headers: { cookie: p.cookie } }, env)).json()) as {
    garden: { bench: { next: { unlockAt: { milestone: string } | null } | null } }
  }
  assert.equal(state.garden.bench.next?.unlockAt?.milestone, 'goldenrod')
})
