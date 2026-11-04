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

type Piece = { id: number; piece: string; structureId: number | null; slot: number; col: number; row: number; flipped: boolean }
type Layout = {
  pieces: Piece[]
  stored: { id: number; piece: string }[]
  plotLimit: number
  plotsPlaced: number
  nextPlots: { milestone: string; name: string; plots: number } | null
  locked: { piece: string; unlockAt: { milestone: string } }[]
}
type State = {
  garden: {
    layout: Layout
    trees: { key: string; placed: boolean; ready: number }[]
    benches: { id: number; placed: boolean }[]
    healMachines: { id: number; placed: boolean; charges: number }[]
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
/** Marca marcos como conquistados (o jardim abre por eles). */
const clear = (userId: number, ...keys: string[]) => {
  for (const key of keys) {
    getSqlite().prepare('insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, ?)').run(userId, key, Date.now())
  }
}
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
  // Desde o começo: 4 canteiros, nas casas da horta antiga.
  assert.deepEqual(
    layout.pieces.filter((row) => row.piece === 'berry_plot').map((row) => [row.slot, row.col, row.row]),
    [0, 1, 2, 3].map((slot) => [slot, DEFAULT_LAYOUT.plots[slot]!.col, DEFAULT_LAYOUT.plots[slot]!.row]),
  )
  for (const key of ['apricorn_tree', 'ball_bench', 'heal_machine'] as const) {
    const placed = pieceOf(layout, key)
    assert.ok(placed, key)
    assert.deepEqual([placed.col, placed.row], [DEFAULT_LAYOUT.structures[key].col, DEFAULT_LAYOUT.structures[key].row])
  }
  assert.deepEqual(layout.stored, [])
  assert.equal(layout.plotLimit, 4)
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
  assert.deepEqual(((await stored.json()) as { layout: Layout }).layout.stored, [{ id: tree.structureId, piece: 'apricorn_tree' }])

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
  const p = player('construcao-fechada', 30)
  await state(p.cookie)
  // A árvore azul vem do Marco de Goldenrod, não do nível.
  assert.equal(await errorOf(await post(p.cookie, '/build/place', { piece: 'apricorn_tree_blue', col: 5, row: 5 })), 'piece_locked')
  clear(p.userId, 'goldenrod')
  assert.equal((await post(p.cookie, '/build/place', { piece: 'apricorn_tree_blue', col: 5, row: 5 })).status, 409, 'já foi para o jardim sozinha')
  assert.equal(await errorOf(await post(p.cookie, '/build/place', { piece: 'nada', col: 5, row: 5 })), 'invalid_body')
})

test('canteiros: limite pelo marco, guardar só vazio, plantar só no colocado', async () => {
  const p = player('construcao-canteiro', 1)
  const sqlite = getSqlite()
  sqlite.prepare("insert into inventory (user_id, item_key, quantity) values (?, 'seed:oran', 5) on conflict do update set quantity = 5").run(p.userId)
  const layout = (await state(p.cookie)).garden.layout
  assert.equal(layout.plotLimit, 4)
  assert.equal(layout.plotsPlaced, 4)
  assert.deepEqual(layout.nextPlots, { milestone: 'azalea', name: 'Marco de Azalea', plots: 6 })
  assert.deepEqual(
    layout.locked.map((row) => [row.piece, row.unlockAt.milestone]),
    [
      ['apricorn_tree_blue', 'goldenrod'],
      ['apricorn_tree_yellow', 'olivine'],
    ],
  )
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
  assert.deepEqual(
    plots.map((row) => row.slot).sort(),
    layout.pieces.filter((row) => row.piece === 'berry_plot').map((row) => row.slot).sort(),
    'reaproveita o slot livre',
  )
})

test('bancada só se guarda parada; máquina guardada não cura', async () => {
  const p = player('construcao-bancada', 2)
  const sqlite = getSqlite()
  const layout = (await state(p.cookie)).garden.layout
  const bench = pieceOf(layout, 'ball_bench')!
  sqlite
    .prepare(
      "insert into craft_jobs (user_id, structure_key, structure_id, recipe_key, quantity, unit_ms, started_at) values (?, 'ball_bench', ?, 'poke_ball', 2, ?, ?)",
    )
    .run(p.userId, bench.structureId, hourMs, Date.now())
  assert.equal(await errorOf(await post(p.cookie, `/build/${bench.id}/store`)), 'bench_busy')
  sqlite.prepare('update craft_jobs set cancelled_at = ? where user_id = ?').run(Date.now(), p.userId)
  assert.equal((await post(p.cookie, `/build/${bench.id}/store`)).status, 200)
  assert.equal((await state(p.cookie)).garden.benches[0]!.placed, false)
  assert.equal(await errorOf(await post(p.cookie, '/garden/bench/start', { quantity: 1 })), 'not_placed')

  const heal = pieceOf(layout, 'heal_machine')!
  sqlite.prepare('update pokemon set hp_ratio = 0.5 where user_id = ?').run(p.userId)
  assert.equal((await post(p.cookie, `/build/${heal.id}/store`)).status, 200)
  assert.equal(await errorOf(await post(p.cookie, '/garden/heal-machine/use')), 'not_placed')
  const view = (await state(p.cookie)).garden.healMachines[0]!
  assert.equal(view.placed, false)
})

test('duas bancadas e duas máquinas: cada peça com o seu estado', async () => {
  const p = player('construcao-duas', 1)
  const sqlite = getSqlite()
  const { createStructure } = await import('../db/structures.js')
  await state(p.cookie)
  // A segunda de cada vem guardada (as receitas entram no passo 2c).
  const [bench2, heal2] = immediate(() => [
    createStructure(p.userId, 'ball_bench', Date.now()),
    createStructure(p.userId, 'heal_machine', Date.now()),
  ])
  const before = (await state(p.cookie)).garden
  assert.deepEqual(
    before.layout.stored.map((row) => row.piece).sort(),
    ['ball_bench', 'heal_machine'],
  )
  assert.equal((await post(p.cookie, '/build/place', { piece: 'ball_bench', structureId: bench2, col: 3, row: 3 })).status, 200)
  assert.equal((await post(p.cookie, '/build/place', { piece: 'heal_machine', col: 6, row: 3 })).status, 200)
  assert.equal(await errorOf(await post(p.cookie, '/build/place', { piece: 'ball_bench', col: 8, row: 3 })), 'already_placed')

  const garden = (await state(p.cookie)).garden
  assert.equal(garden.benches.length, 2)
  assert.equal(garden.healMachines.length, 2)
  const bench1 = garden.benches.find((row) => row.id !== bench2)!.id

  // Operadores diferentes; o mesmo não opera as duas.
  const add = (speciesId: number) =>
    Number(
      sqlite
        .prepare('insert into pokemon (user_id, species_id, level, caught_at, original_species_id) values (?, ?, 5, ?, ?)')
        .run(p.userId, speciesId, Date.now(), speciesId).lastInsertRowid,
    )
  const sentret = add(161)
  const machop = add(66)
  assert.equal((await post(p.cookie, '/garden/bench/operator', { id: bench1, pokemonId: sentret })).status, 200)
  assert.equal(await errorOf(await post(p.cookie, '/garden/bench/operator', { id: bench2, pokemonId: sentret })), 'operating')
  assert.equal((await post(p.cookie, '/garden/bench/operator', { id: bench2, pokemonId: machop })).status, 200)

  // Um lote em cada uma, ao mesmo tempo.
  sqlite.prepare("insert into inventory (user_id, item_key, quantity) values (?, 'mat:apricorn', 10) on conflict do update set quantity = 10").run(p.userId)
  // Cada ação devolve a bancada dela (os Pokémon de teste não têm traits para o /state).
  type BenchBody = { bench: { id: number; job: { quantity: number } | null } }
  const first = (await (await post(p.cookie, '/garden/bench/start', { id: bench1, quantity: 2 })).json()) as BenchBody
  const second = (await (await post(p.cookie, '/garden/bench/start', { id: bench2, quantity: 3 })).json()) as BenchBody
  assert.deepEqual([first.bench.id, first.bench.job?.quantity], [bench1, 2])
  assert.deepEqual([second.bench.id, second.bench.job?.quantity], [bench2, 3])
  const collect = (await (await post(p.cookie, '/garden/bench/collect', { id: bench1 })).json()) as { error: string }
  assert.equal(collect.error, 'nothing_ready')

  // Máquinas: a escolhida gasta; sem id, a de mais cargas.
  sqlite.prepare('update pokemon set hp_ratio = 0.5 where user_id = ?').run(p.userId)
  sqlite.prepare('update garden_structures set progress = 1, since = ? where id = ?').run(Date.now(), heal2)
  const heal1 = garden.healMachines.find((row) => row.id !== heal2)!.id
  sqlite.prepare('update garden_structures set progress = 3, since = ? where id = ?').run(Date.now(), heal1)
  const used = (await (await post(p.cookie, '/garden/heal-machine/use', { id: heal2 })).json()) as {
    machineId: number
    healMachines: { id: number; charges: number }[]
  }
  assert.equal(used.machineId, heal2)
  assert.deepEqual(
    used.healMachines.map((row) => [row.id, row.charges]).sort(),
    [[heal1, 3], [heal2, 0]].sort(),
  )
  sqlite.prepare('update pokemon set hp_ratio = 0.5 where user_id = ?').run(p.userId)
  const auto = (await (await post(p.cookie, '/garden/heal-machine/use')).json()) as { machineId: number }
  assert.equal(auto.machineId, heal1)
})

test('receitas: marco libera, gasta materiais, leva tempo, uma por vez e para no teto', async () => {
  const p = player('construcao-receita', 1)
  const sqlite = getSqlite()
  const give = (itemKey: string, quantity: number) =>
    sqlite
      .prepare('insert into inventory (user_id, item_key, quantity) values (?, ?, ?) on conflict do update set quantity = excluded.quantity')
      .run(p.userId, itemKey, quantity)
  type Recipe = { piece: string; count: number; cap: number; unlockAt: { milestone: string } | null }
  type CraftLayout = Layout & { recipes: Recipe[]; building: { piece: string; readyAt: number } | null }
  const layoutOf = async () => (await state(p.cookie)).garden.layout as CraftLayout
  const tree = (layout: CraftLayout) => layout.recipes.find((row) => row.piece === 'apricorn_tree')!

  // Sem o Marco de Azalea a receita da árvore está fechada.
  assert.equal(tree(await layoutOf()).unlockAt?.milestone, 'azalea')
  assert.equal(await errorOf(await post(p.cookie, '/build/craft', { piece: 'apricorn_tree' })), 'build_recipe_locked')

  clear(p.userId, 'azalea')
  assert.deepEqual([tree(await layoutOf()).count, tree(await layoutOf()).cap], [1, 2])
  assert.equal(await errorOf(await post(p.cookie, '/build/craft', { piece: 'apricorn_tree' })), 'missing_items')

  give('mat:wood', 10)
  give('mat:apricorn', 5)
  give('berry:oran', 3)
  const crafted = await post(p.cookie, '/build/craft', { piece: 'apricorn_tree' })
  assert.equal(crafted.status, 200)
  const during = ((await crafted.json()) as { layout: CraftLayout }).layout
  assert.equal(during.building?.piece, 'apricorn_tree')
  assert.equal(tree(during).count, 2)
  assert.equal(during.stored.length, 0, 'em construção não aparece guardada')
  const wood = sqlite.prepare("select quantity from inventory where user_id = ? and item_key = 'mat:wood'").get(p.userId) as
    | { quantity: number }
    | undefined
  assert.equal(wood?.quantity ?? 0, 0)

  // Pronta: vai para o inventário de construção; o teto (2) chegou.
  sqlite.prepare('update garden_structures set ready_at = ? where user_id = ? and ready_at is not null').run(Date.now() - 1, p.userId)
  const done = await layoutOf()
  assert.equal(done.building, null)
  assert.deepEqual(done.stored.map((row) => row.piece), ['apricorn_tree'])
  assert.equal((await state(p.cookie)).garden.trees.filter((row) => row.placed).length, 1)
  give('mat:wood', 10)
  give('mat:apricorn', 5)
  give('berry:oran', 3)
  assert.equal(await errorOf(await post(p.cookie, '/build/craft', { piece: 'apricorn_tree' })), 'piece_cap')

  // Ecruteak sobe o teto para 3; uma construção por vez (a máquina espera a árvore).
  clear(p.userId, 'ecruteak', 'cianwood')
  assert.equal((await post(p.cookie, '/build/craft', { piece: 'apricorn_tree' })).status, 200)
  give('mat:stone', 10)
  give('mat:wood', 5)
  give('berry:oran', 5)
  assert.equal(await errorOf(await post(p.cookie, '/build/craft', { piece: 'heal_machine' })), 'build_busy')
})
