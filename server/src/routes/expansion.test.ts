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
import { STONE_ITEM, WOOD_ITEM } from '../config/buildRecipes.js'
import { expansionCost } from '../config/gardenExpansion.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { creditItems, itemQty } from '../db/inventory.js'
import { migrateDatabase } from '../db/migrate.js'
import { sessions } from '../db/schema.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-expansion-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { buildRoutes } = await import('./build.js')
const { stateRoutes } = await import('./state.js')

migrateDatabase()
const app = new Hono().route('/build', buildRoutes).route('/state', stateRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }
const sql = () => getSqlite()

after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

type Bounds = { minCol: number; minRow: number; maxCol: number; maxRow: number }
type Layout = {
  cols: number
  rows: number
  bounds: Bounds
  pieces: { id: number; piece: string; col: number; row: number }[]
  expansion: {
    done: number
    unlocked: number
    next: { n: number; items: { itemKey: string; quantity: number }[]; genericCandies: { quantity: number } } | null
    nextAt: { milestone: string } | null
    sides: Record<'up' | 'down' | 'left' | 'right', boolean>
    building: { side: string; readyAt: number } | null
  }
}

function player(username: string) {
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

const post = (cookie: string, url: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)
const layoutOf = async (cookie: string) =>
  ((await (await app.request('/state', { headers: { cookie } }, env)).json()) as { garden: { layout: Layout } }).garden.layout
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

function clear(userId: number, ...keys: string[]) {
  for (const key of keys) {
    sql().prepare('insert or ignore into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, ?)').run(userId, key, Date.now())
  }
}

function fund(userId: number, n: number) {
  const cost = expansionCost(n)
  immediate(() => creditItems(userId, cost.items))
  sql().prepare('update trainers set generic_candies = generic_candies + ? where user_id = ?').run(cost.genericCandies, userId)
}

/** Termina a obra agora (o relógio dela já passou). */
function finishNow(userId: number) {
  sql().prepare('update trainers set garden_expand_ready_at = ?, garden_expand_started_at = ? where user_id = ?').run(Date.now() - 1, Date.now() - 2, userId)
}

test('conta nova: 12×12, expansão fechada até a Azalea', async () => {
  const p = player('exp-new')
  const layout = await layoutOf(p.cookie)
  assert.deepEqual(layout.bounds, { minCol: 0, minRow: 0, maxCol: 11, maxRow: 11 })
  assert.equal(layout.cols, 12)
  assert.equal(layout.expansion.unlocked, 0)
  assert.equal(layout.expansion.nextAt?.milestone, 'azalea')
  assert.equal(await errorOf(await post(p.cookie, '/build/expand', { side: 'left' })), 'expansion_locked')
  assert.equal(await errorOf(await post(p.cookie, '/build/expand', { side: 'diagonal' })), 'invalid_body')
})

test('expandir: gasta, ocupa a fila de obras e abre a faixa no lado escolhido', async () => {
  const p = player('exp-left')
  clear(p.userId, 'violet', 'azalea')
  fund(p.userId, 1)
  const cost = expansionCost(1)

  const started = await post(p.cookie, '/build/expand', { side: 'left' })
  assert.equal(started.status, 200)
  const during = ((await started.json()) as { layout: Layout }).layout
  assert.equal(during.expansion.building?.side, 'left')
  assert.equal(itemQty(p.userId, WOOD_ITEM), 0)
  assert.equal(itemQty(p.userId, STONE_ITEM), 0)
  const candies = (sql().prepare('select generic_candies as n from trainers where user_id = ?').get(p.userId) as { n: number }).n
  assert.equal(candies, 0, `gastou ${cost.genericCandies} doces`)
  // Uma obra por vez: nem outra expansão nem uma construção.
  assert.equal(await errorOf(await post(p.cookie, '/build/expand', { side: 'up' })), 'build_busy')
  assert.equal(await errorOf(await post(p.cookie, '/build/craft', { piece: 'apricorn_tree' })), 'build_busy')

  finishNow(p.userId)
  const after = await layoutOf(p.cookie)
  assert.deepEqual(after.bounds, { minCol: -2, minRow: 0, maxCol: 11, maxRow: 11 })
  assert.equal(after.cols, 14)
  assert.equal(after.expansion.done, 1)
  assert.equal(after.expansion.building, null)

  // A faixa nova (colunas -2 e -1) aceita chão; fora dela, não.
  assert.equal((await post(p.cookie, '/build/floor', { cells: [{ col: -2, row: 3, floor: 'grama-alta' }] })).status, 200)
  assert.equal(await errorOf(await post(p.cookie, '/build/floor', { cells: [{ col: -3, row: 3, floor: 'grama-alta' }] })), 'out_of_bounds')

  // Só a Azalea: a segunda ainda não abriu, e o custo dela cresce.
  assert.equal(after.expansion.unlocked, 1)
  assert.equal(after.expansion.next?.n, 2)
  assert.equal(after.expansion.next?.items[0]?.quantity, expansionCost(2).items[0]!.quantity)
  fund(p.userId, 2)
  assert.equal(await errorOf(await post(p.cookie, '/build/expand', { side: 'up' })), 'expansion_locked')
  clear(p.userId, 'goldenrod')
  assert.equal((await post(p.cookie, '/build/expand', { side: 'up' })).status, 200)
  finishNow(p.userId)
  assert.deepEqual((await layoutOf(p.cookie)).bounds, { minCol: -2, minRow: -2, maxCol: 11, maxRow: 11 })
})

test('sem material ou doces não começa; lado no teto de 20 não cresce', async () => {
  const p = player('exp-cap')
  clear(p.userId, 'violet', 'azalea')
  assert.equal(await errorOf(await post(p.cookie, '/build/expand', { side: 'right' })), 'missing_items')
  immediate(() => creditItems(p.userId, expansionCost(1).items))
  assert.equal(await errorOf(await post(p.cookie, '/build/expand', { side: 'right' })), 'not_enough_candies')

  // Largura já em 20 (colunas -8..11): esquerda e direita fecham, cima e baixo seguem.
  sql().prepare('update trainers set garden_min_col = -8 where user_id = ?').run(p.userId)
  const layout = await layoutOf(p.cookie)
  assert.deepEqual(layout.expansion.sides, { up: true, down: true, left: false, right: false })
  fund(p.userId, 1)
  assert.equal(await errorOf(await post(p.cookie, '/build/expand', { side: 'right' })), 'expansion_side_full')
  assert.equal((await post(p.cookie, '/build/expand', { side: 'down' })).status, 200)
})
