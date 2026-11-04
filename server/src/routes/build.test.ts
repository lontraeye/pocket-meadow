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
import { sessions } from '../db/schema.js'
import { DEFAULT_LAYOUT } from '../game/garden/layout.js'
import { setDevWeather } from '../game/weather.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-build-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { buildRoutes } = await import('./build.js')
const { gardenRoutes } = await import('./garden.js')
const { plotRoutes } = await import('./plots.js')
const { stateRoutes } = await import('./state.js')

migrateDatabase()
const app = new Hono()
  .route('/build', buildRoutes)
  .route('/garden', gardenRoutes)
  .route('/plots', plotRoutes)
  .route('/state', stateRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }
const hourMs = 60 * 60 * 1000

after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

type Piece = { id: number; piece: string; slot: number; col: number; row: number; flipped: boolean }
type Layout = { pieces: Piece[]; stored: string[]; plotLimit: number; plotsPlaced: number }
type State = {
  garden: {
    layout: Layout
    trees: { key: string; placed: boolean; ready: number }[]
    bench: { placed: boolean }
    healMachine: { placed: boolean; charges: number }
  }
}

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
  setDevWeather(userId, 'sunny')
  return { cookie: `${authConfig.cookieName}=${token}`, userId }
}

const post = (cookie: string, url: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)
const state = async (cookie: string) => (await (await app.request('/state', { headers: { cookie } }, env)).json()) as State
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error
const pieceOf = (layout: Layout, piece: string) => layout.pieces.find((row) => row.piece === piece)

test('conta de antes da construção: o que já existe fica nas casas de sempre', async () => {
  const p = player('construcao-migra', 8)
  const sqlite = getSqlite()
  // Como estava antes: estruturas e um arbusto no canteiro 2, sem layout.
  const now = Date.now()
  sqlite.prepare("insert into garden_structures (user_id, key, since, progress) values (?, 'apricorn_tree', ?, 2)").run(p.userId, now)
  sqlite.prepare("insert into garden_structures (user_id, key, since) values (?, 'ball_bench', ?)").run(p.userId, now)
  sqlite
    .prepare("insert into berry_plots (user_id, plot_index, berry_key, planted_at, ready_at) values (?, 2, 'oran', ?, ?)")
    .run(p.userId, now, now + hourMs)

  const { garden } = await state(p.cookie)
  const layout = garden.layout
  // Nível 8: 3 canteiros abertos, nas casas da horta antiga.
  assert.deepEqual(
    layout.pieces.filter((row) => row.piece === 'berry_plot').map((row) => [row.slot, row.col, row.row]),
    [0, 1, 2].map((slot) => [slot, DEFAULT_LAYOUT.plots[slot]!.col, DEFAULT_LAYOUT.plots[slot]!.row]),
  )
  for (const key of ['apricorn_tree', 'ball_bench', 'heal_machine'] as const) {
    const placed = pieceOf(layout, key)
    assert.ok(placed, key)
    assert.deepEqual([placed.col, placed.row], [DEFAULT_LAYOUT.structures[key].col, DEFAULT_LAYOUT.structures[key].row])
  }
  assert.deepEqual(layout.stored, [])
  assert.equal(layout.plotLimit, 3)
  assert.equal(garden.trees.find((row) => row.key === 'apricorn_tree')!.ready, 2)

  // Recarregar não duplica.
  assert.equal((await state(p.cookie)).garden.layout.pieces.length, layout.pieces.length)
})

test('mover: casa livre dentro do jardim; a bancada ocupa a casa do operador', async () => {
  const p = player('construcao-move', 2)
  const { layout } = (await state(p.cookie)).garden
  const bench = pieceOf(layout, 'ball_bench')!
  const heal = pieceOf(layout, 'heal_machine')!

  assert.equal(await errorOf(await post(p.cookie, `/build/${bench.id}/move`, { col: 0, row: 0 })), 'out_of_bounds')
  assert.equal(await errorOf(await post(p.cookie, `/build/${bench.id}/move`, { col: 12, row: 3 })), 'out_of_bounds')
  // A casa do operador (à esquerda) cairia na máquina de cura.
  assert.equal(await errorOf(await post(p.cookie, `/build/${bench.id}/move`, { col: heal.col + 1, row: heal.row })), 'occupied')

  const moved = await post(p.cookie, `/build/${bench.id}/move`, { col: 5, row: 2 })
  assert.equal(moved.status, 200)
  const after = ((await moved.json()) as { layout: Layout }).layout
  assert.deepEqual([pieceOf(after, 'ball_bench')!.col, pieceOf(after, 'ball_bench')!.row], [5, 2])
  // A casa antiga da bancada ficou livre.
  const healMove = await post(p.cookie, `/build/${heal.id}/move`, { col: bench.col, row: bench.row })
  assert.equal(healMove.status, 200)
})

test('girar: a bancada leva a casa do operador para o outro lado; árvore não gira', async () => {
  const p = player('construcao-girar', 2)
  const { layout } = (await state(p.cookie)).garden
  const bench = pieceOf(layout, 'ball_bench')!
  const tree = pieceOf(layout, 'apricorn_tree')!
  assert.equal(bench.flipped, false)

  // Girada, a casa do operador sai de (col − 1, row) para (col, row − 1).
  const turned = await post(p.cookie, `/build/${bench.id}/move`, { col: 5, row: 0, flipped: true })
  assert.equal(await errorOf(turned), 'out_of_bounds')
  const ok = await post(p.cookie, `/build/${bench.id}/move`, { col: 0, row: 3, flipped: true })
  assert.equal(ok.status, 200)
  const after = ((await ok.json()) as { layout: Layout }).layout
  assert.equal(pieceOf(after, 'ball_bench')!.flipped, true)
  // Mover sem `flipped` mantém o giro.
  const kept = await post(p.cookie, `/build/${bench.id}/move`, { col: 0, row: 5 })
  assert.equal(((await kept.json()) as { layout: Layout }).layout.pieces.find((row) => row.id === bench.id)!.flipped, true)
  // A casa do operador (0, 4) está ocupada pela pegada.
  assert.equal(await errorOf(await post(p.cookie, `/build/${tree.id}/move`, { col: 0, row: 4 })), 'occupied')

  const treeTurn = await post(p.cookie, `/build/${tree.id}/move`, { col: 3, row: 3, flipped: true })
  assert.equal(treeTurn.status, 200)
  assert.equal(((await treeTurn.json()) as { layout: Layout }).layout.pieces.find((row) => row.id === tree.id)!.flipped, false)
  assert.equal(await errorOf(await post(p.cookie, `/build/${bench.id}/move`, { col: 3, row: 5, flipped: 'sim' })), 'invalid_body')
})

test('árvore guardada para de crescer, não colhe e volta a contar ao colocar', async () => {
  const p = player('construcao-arvore', 2)
  const sqlite = getSqlite()
  const tree = pieceOf((await state(p.cookie)).garden.layout, 'apricorn_tree')!
  const stored = await post(p.cookie, `/build/${tree.id}/store`)
  assert.equal(stored.status, 200)
  assert.deepEqual(((await stored.json()) as { layout: Layout }).layout.stored, ['apricorn_tree'])

  sqlite.prepare("update garden_structures set since = since - ? where user_id = ? and key = 'apricorn_tree'").run(100 * hourMs, p.userId)
  const frozen = (await state(p.cookie)).garden.trees.find((row) => row.key === 'apricorn_tree')!
  assert.equal(frozen.placed, false)
  assert.equal(frozen.ready, 1, 'guardada não cresce')
  assert.equal(await errorOf(await post(p.cookie, '/garden/tree/harvest', { key: 'apricorn_tree' })), 'not_placed')

  const placed = await post(p.cookie, '/build/place', { piece: 'apricorn_tree', col: 0, row: 0 })
  assert.equal(placed.status, 200)
  const back = (await state(p.cookie)).garden.trees.find((row) => row.key === 'apricorn_tree')!
  assert.equal(back.placed, true)
  assert.equal(back.ready, 1, 'o tempo guardado não conta')
  assert.equal(await errorOf(await post(p.cookie, '/build/place', { piece: 'apricorn_tree', col: 3, row: 3 })), 'already_placed')
})

test('peça que ainda não abriu não se coloca', async () => {
  const p = player('construcao-fechada', 1)
  await state(p.cookie)
  assert.equal(await errorOf(await post(p.cookie, '/build/place', { piece: 'ball_bench', col: 5, row: 5 })), 'piece_locked')
  assert.equal(await errorOf(await post(p.cookie, '/build/place', { piece: 'nada', col: 5, row: 5 })), 'invalid_body')
})

test('canteiros: limite pelo nível, guardar só vazio, plantar só no colocado', async () => {
  const p = player('construcao-canteiro', 1)
  const sqlite = getSqlite()
  sqlite.prepare("insert into inventory (user_id, item_key, quantity) values (?, 'seed:oran', 5) on conflict do update set quantity = 5").run(p.userId)
  const layout = (await state(p.cookie)).garden.layout
  assert.equal(layout.plotLimit, 2)
  assert.equal(layout.plotsPlaced, 2)
  assert.equal(await errorOf(await post(p.cookie, '/build/place', { piece: 'berry_plot', col: 0, row: 0 })), 'plot_limit')

  const [first, second] = layout.pieces.filter((row) => row.piece === 'berry_plot')
  assert.equal((await post(p.cookie, `/plots/${first!.slot}/plant`, { berryKey: 'oran' })).status, 200)
  assert.equal(await errorOf(await post(p.cookie, `/build/${first!.id}/store`)), 'plot_not_empty')

  // Mover o canteiro plantado leva o arbusto junto (o slot é o mesmo).
  assert.equal((await post(p.cookie, `/build/${first!.id}/move`, { col: 6, row: 6 })).status, 200)

  assert.equal((await post(p.cookie, `/build/${second!.id}/store`)).status, 200)
  assert.equal(await errorOf(await post(p.cookie, `/plots/${second!.slot}/plant`, { berryKey: 'oran' })), 'plot_locked')
  const placed = await post(p.cookie, '/build/place', { piece: 'berry_plot', col: 7, row: 6 })
  assert.equal(placed.status, 200)
  const plots = (await state(p.cookie)).garden.layout.pieces.filter((row) => row.piece === 'berry_plot')
  assert.deepEqual(plots.map((row) => row.slot).sort(), [first!.slot, second!.slot].sort(), 'reaproveita o slot livre')
})

test('bancada só se guarda parada; máquina guardada não cura', async () => {
  const p = player('construcao-bancada', 2)
  const sqlite = getSqlite()
  const layout = (await state(p.cookie)).garden.layout
  const bench = pieceOf(layout, 'ball_bench')!
  sqlite
    .prepare("insert into craft_jobs (user_id, structure_key, recipe_key, quantity, unit_ms, started_at) values (?, 'ball_bench', 'poke_ball', 2, ?, ?)")
    .run(p.userId, hourMs, Date.now())
  assert.equal(await errorOf(await post(p.cookie, `/build/${bench.id}/store`)), 'bench_busy')
  sqlite.prepare('update craft_jobs set cancelled_at = ? where user_id = ?').run(Date.now(), p.userId)
  assert.equal((await post(p.cookie, `/build/${bench.id}/store`)).status, 200)
  assert.equal((await state(p.cookie)).garden.bench.placed, false)
  assert.equal(await errorOf(await post(p.cookie, '/garden/bench/start', { quantity: 1 })), 'not_placed')

  const heal = pieceOf(layout, 'heal_machine')!
  sqlite.prepare('update pokemon set hp_ratio = 0.5 where user_id = ?').run(p.userId)
  assert.equal((await post(p.cookie, `/build/${heal.id}/store`)).status, 200)
  assert.equal(await errorOf(await post(p.cookie, '/garden/heal-machine/use')), 'not_placed')
  const view = (await state(p.cookie)).garden.healMachine
  assert.equal(view.placed, false)
})
