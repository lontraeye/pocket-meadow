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

// Habitats no jardim (PLANNING 5.22, redesenhado em 2026-11-04): chão pintado
// sem custo, habitat com área e tipo escolhidos (pontos = metade da área), casa
// no habitat pronto do tipo, bônus, e a água que não aceita peça.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-habitat-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { buildRoutes } = await import('./build.js')
const { gardenRoutes } = await import('./garden.js')
const { stateRoutes } = await import('./state.js')
const { habitatBonusIds } = await import('../db/habitat.js')

migrateDatabase()
const app = new Hono().route('/build', buildRoutes).route('/garden', gardenRoutes).route('/state', stateRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

type Habitat = { id: number; kind: string; tiles: { col: number; row: number }[] }
type Layout = {
  floor: { col: number; row: number; floor: string }[]
  floors: { floor: string; unlockAt: { milestone: string } | null }[]
  habitats: Habitat[]
  habitatKinds: { kind: string; unlockAt: { milestone: string } | null }[]
  pieces: { id: number; piece: string; col: number; row: number }[]
}
type State = { pokemon: { id: number; habitatId: number | null }[]; garden: { layout: Layout } }

function player(username: string): { cookie: string; userId: number; starterId: number } {
  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  const created = immediate(() => {
    const out = createPlayer({ username, googleSub: null, starter: 'chikorita', now })
    getDb()
      .insert(sessions)
      .values({ id: hashToken(token), userId: out.userId, createdAt: now, expiresAt: now + authConfig.sessionTtlMs })
      .run()
    return out
  })
  const starter = getSqlite().prepare('select id from pokemon where user_id = ?').get(created.userId) as { id: number }
  return { cookie: `${authConfig.cookieName}=${token}`, userId: created.userId, starterId: starter.id }
}

/** Outro Pokémon igual ao inicial (fora do time e sem casa), para encher as vagas. */
function copyOf(id: number): number {
  const columns = (getSqlite().prepare('pragma table_info(pokemon)').all() as { name: string }[])
    .map((column) => column.name)
    .filter((name) => !['id', 'team_slot', 'habitat_id'].includes(name))
    .join(', ')
  const out = getSqlite().prepare(`insert into pokemon (${columns}) select ${columns} from pokemon where id = ?`).run(id)
  return Number(out.lastInsertRowid)
}

const post = (cookie: string, url: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)
const state = async (cookie: string) => (await (await app.request('/state', { headers: { cookie } }, env)).json()) as State
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error
const layoutOf = async (response: Response) => ((await response.json()) as { layout: Layout }).layout
const clear = (userId: number, ...keys: string[]) => {
  for (const key of keys) {
    getSqlite().prepare('insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, ?)').run(userId, key, Date.now())
  }
}
const cells = (row: number, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ col: from + index, row }))
const paint = (row: number, from: number, to: number, floor: string | null) => cells(row, from, to).map((cell) => ({ ...cell, floor }))

test('chão: pinta sem custo, abre por marco, volta ao gramado e ignora o canteiro', async () => {
  const p = player('habitat-chao')
  const layout = (await state(p.cookie)).garden.layout
  assert.deepEqual(
    layout.floors.filter((row) => row.unlockAt === null).map((row) => row.floor),
    ['grama-alta', 'flores'],
  )
  assert.deepEqual(
    layout.habitatKinds.map((row) => [row.kind, row.unlockAt?.milestone ?? null]),
    [['pradaria', null], ['rochedo', 'azalea'], ['lago', 'ecruteak'], ['basico', null]],
  )
  assert.equal((await post(p.cookie, '/build/floor', { cells: paint(0, 0, 5, 'flores') })).status, 200)
  assert.equal(await errorOf(await post(p.cookie, '/build/floor', { cells: paint(1, 0, 0, 'areia') })), 'floor_locked')
  clear(p.userId, 'violet', 'azalea')
  assert.equal((await post(p.cookie, '/build/floor', { cells: paint(1, 0, 0, 'areia') })).status, 200)

  await post(p.cookie, '/build/floor', { cells: [{ col: 1, row: 9, floor: 'flores' }] })
  await post(p.cookie, '/build/floor', { cells: [{ col: 0, row: 0, floor: null }] })
  const floor = (await state(p.cookie)).garden.layout.floor
  assert.equal(floor.length, 6)
  assert.ok(!floor.some((tile) => tile.col === 1 && tile.row === 9), 'canteiro tem chão próprio')
  assert.equal(await errorOf(await post(p.cookie, '/build/floor', { cells: paint(0, 11, 12, 'flores') })), 'out_of_bounds')
})

test('habitat: área sem buraco, sem invadir outro e tipo aberto pelo marco', async () => {
  const p = player('habitat-area')
  const created = await post(p.cookie, '/build/habitat', { kind: 'pradaria', cells: cells(0, 0, 5) })
  assert.equal(created.status, 200)
  const first = (await layoutOf(created)).habitats[0]!
  assert.deepEqual([first.kind, first.tiles.length], ['pradaria', 6])

  // Encostado no primeiro é outro habitat (a fronteira é a área de cada um).
  assert.equal((await post(p.cookie, '/build/habitat', { kind: 'basico', cells: cells(1, 0, 5) })).status, 200)
  assert.equal(await errorOf(await post(p.cookie, '/build/habitat', { kind: 'basico', cells: cells(0, 5, 7) })), 'habitat_overlap')
  assert.equal(
    await errorOf(await post(p.cookie, '/build/habitat', { kind: 'basico', cells: [{ col: 9, row: 0 }, { col: 11, row: 0 }] })),
    'habitat_not_connected',
  )
  assert.equal(await errorOf(await post(p.cookie, '/build/habitat', { kind: 'lago', cells: cells(3, 0, 5) })), 'habitat_locked')

  // Editar a área e o tipo; excluir.
  const edited = await post(p.cookie, `/build/habitat/${first.id}`, { cells: cells(0, 0, 7) })
  assert.equal((await layoutOf(edited)).habitats.find((row) => row.id === first.id)?.tiles.length, 8)
  const deleted = await post(p.cookie, `/build/habitat/${first.id}/delete`)
  assert.equal((await layoutOf(deleted)).habitats.length, 1)
})

test('casa: só no habitat pronto do tipo, até as vagas; quem não cabe mais sai', async () => {
  const p = player('habitat-casa')
  const home = (id: number, habitatId: number | null) => post(p.cookie, `/garden/pets/${id}/home`, { habitatId })
  const pradaria = (await layoutOf(await post(p.cookie, '/build/habitat', { kind: 'pradaria', cells: cells(0, 0, 5) }))).habitats[0]!

  // 6 casas pedem 3 pontos de planta: sem chão, não está pronto.
  assert.equal(await errorOf(await home(p.starterId, pradaria.id)), 'habitat_not_ready')
  await post(p.cookie, '/build/floor', { cells: paint(0, 0, 2, 'flores') })
  assert.equal((await home(p.starterId, pradaria.id)).status, 200)
  assert.equal((await state(p.cookie)).pokemon.find((mon) => mon.id === p.starterId)?.habitatId, pradaria.id)
  assert.ok(habitatBonusIds(p.userId).has(p.starterId), 'Chikorita na Pradaria pronta ganha o bônus')

  const second = copyOf(p.starterId)
  const third = copyOf(p.starterId)
  assert.equal((await home(second, pradaria.id)).status, 200)
  assert.equal(await errorOf(await home(third, pradaria.id)), 'habitat_full')

  // Lago não aceita Planta.
  clear(p.userId, 'violet', 'azalea', 'goldenrod', 'ecruteak')
  await post(p.cookie, '/build/floor', { cells: paint(3, 0, 5, 'agua') })
  const lago = (await layoutOf(await post(p.cookie, '/build/habitat', { kind: 'lago', cells: cells(3, 0, 5) }))).habitats[1]!
  assert.equal(await errorOf(await home(third, lago.id)), 'wrong_habitat')

  // Apagar uma flor: fica com 2 de 3 pontos, deixa de estar pronto e os dois saem.
  const erased = await post(p.cookie, '/build/floor', { cells: paint(0, 2, 2, null) })
  assert.deepEqual(((await erased.json()) as { evicted: number[] }).evicted.sort(), [p.starterId, second].sort())
  assert.equal(habitatBonusIds(p.userId).size, 0)

  // Trocar o tipo para Lago também tira quem não é de Água.
  await post(p.cookie, '/build/floor', { cells: paint(0, 2, 2, 'flores') })
  await home(p.starterId, pradaria.id)
  const changed = await post(p.cookie, `/build/habitat/${pradaria.id}`, { kind: 'lago' })
  assert.deepEqual(((await changed.json()) as { evicted: number[] }).evicted, [p.starterId])
})

test('água: peça não fica na água e água não vai embaixo de peça', async () => {
  const p = player('habitat-agua')
  clear(p.userId, 'violet', 'azalea', 'goldenrod', 'ecruteak')
  const plot = (await state(p.cookie)).garden.layout.pieces.find((row) => row.piece === 'berry_plot')!
  assert.equal(
    await errorOf(await post(p.cookie, '/build/floor', { cells: [{ col: plot.col, row: plot.row, floor: 'agua' }] })),
    'piece_on_water',
  )
  await post(p.cookie, '/build/floor', { cells: [{ col: 5, row: 2, floor: 'agua' }] })
  assert.equal(await errorOf(await post(p.cookie, `/build/${plot.id}/move`, { col: 5, row: 2 })), 'on_water')
  assert.equal((await post(p.cookie, `/build/${plot.id}/move`, { col: 6, row: 2 })).status, 200)
})

test('visitante: chega no habitat pronto, vai embora, não acumula e vira encontro sem energia', async () => {
  const { settleVisitors, visitorsView } = await import('../db/visitors.js')
  const p = player('habitat-visita')
  const hour = 60 * 60 * 1000
  const pradaria = (await layoutOf(await post(p.cookie, '/build/habitat', { kind: 'pradaria', cells: cells(0, 0, 5) }))).habitats[0]!
  const nextAt = () =>
    (getSqlite().prepare('select visitor_next_at as at from habitats where id = ?').get(pradaria.id) as { at: number | null }).at
  const t0 = Date.now() + 100 * hour
  const low = () => 0

  // Sem estar pronto, não agenda ninguém.
  immediate(() => settleVisitors(p.userId, t0, low))
  assert.equal(nextAt(), null)

  // Pronto: o primeiro chega depois do intervalo (3 h no mínimo) e fica 4 h.
  await post(p.cookie, '/build/floor', { cells: paint(0, 0, 2, 'flores') })
  getSqlite().prepare('update habitats set visitor_next_at = null where id = ?').run(pradaria.id)
  immediate(() => settleVisitors(p.userId, t0, low))
  assert.equal(nextAt(), t0 + 3 * hour)
  immediate(() => settleVisitors(p.userId, t0 + 3 * hour, low))
  const [visitor] = immediate(() => visitorsView(p.userId))
  assert.ok(visitor, 'chegou')
  assert.equal(visitor.leavesAt, t0 + 7 * hour)
  immediate(() => settleVisitors(p.userId, t0 + 7 * hour, low))
  assert.equal(immediate(() => visitorsView(p.userId)).length, 0, 'foi embora')

  // Fora muito tempo: os que viriam e iriam sem ninguém ver são pulados, sem acumular.
  immediate(() => settleVisitors(p.userId, t0 + 40 * hour, low))
  const later = immediate(() => visitorsView(p.userId))
  assert.equal(later.length, 1)
  assert.ok(later[0]!.leavesAt > t0 + 40 * hour)

  // Habitat que deixa de estar pronto manda o visitante embora e para o relógio.
  await post(p.cookie, '/build/floor', { cells: paint(0, 0, 2, null) })
  immediate(() => settleVisitors(p.userId, t0 + 40 * hour, low))
  assert.equal(immediate(() => visitorsView(p.userId)).length, 0)
  assert.equal(nextAt(), null)

  // Tocar no visitante abre o encontro (de graça) e ele sai do habitat.
  await post(p.cookie, '/build/floor', { cells: paint(0, 0, 2, 'flores') })
  const now = Date.now()
  immediate(() => settleVisitors(p.userId, now, low))
  getSqlite().prepare('update habitats set visitor_next_at = ? where id = ?').run(now - 1, pradaria.id)
  immediate(() => settleVisitors(p.userId, now, low))
  const [guest] = immediate(() => visitorsView(p.userId))
  assert.ok(guest)
  const energy = () => (getSqlite().prepare('select energy from trainers where user_id = ?').get(p.userId) as { energy: number }).energy
  const before = energy()
  const opened = await post(p.cookie, `/garden/visitors/${guest.id}/encounter`)
  assert.equal(opened.status, 201)
  const encounter = (await opened.json()) as { speciesId?: number; species?: { id: number } }
  const pending = getSqlite()
    .prepare(`select species_id as speciesId, level from encounters where user_id = ? and status = 'pending'`)
    .get(p.userId) as { speciesId: number; level: number }
  assert.deepEqual([pending.speciesId, pending.level], [guest.speciesId, guest.level])
  assert.ok(encounter)
  assert.equal(energy(), before, 'não gasta energia')
  assert.equal(immediate(() => visitorsView(p.userId)).length, 0)
  assert.equal(await errorOf(await post(p.cookie, `/garden/visitors/${guest.id}/encounter`)), 'visitor_not_found')
})
