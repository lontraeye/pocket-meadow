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

// Habitats no jardim (PLANNING 5.22, decidido em 2026-11-04): pintar o chão
// sem custo, chãos abrindo por marco, casa no habitat do tipo e o bônus.

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

type State = {
  pokemon: { id: number; home: { col: number; row: number } | null }[]
  garden: {
    layout: {
      floor: { col: number; row: number; floor: string }[]
      floors: { floor: string; unlockAt: { milestone: string } | null }[]
    }
  }
}

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

/** Outro Pokémon igual ao inicial (fora do time), para encher as vagas. */
function copyOf(id: number): number {
  const columns = (getSqlite().prepare('pragma table_info(pokemon)').all() as { name: string }[])
    .map((column) => column.name)
    .filter((name) => !['id', 'team_slot', 'home_col', 'home_row'].includes(name))
    .join(', ')
  const out = getSqlite().prepare(`insert into pokemon (${columns}) select ${columns} from pokemon where id = ?`).run(id)
  return Number(out.lastInsertRowid)
}

const post = (cookie: string, url: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)
const state = async (cookie: string) => (await (await app.request('/state', { headers: { cookie } }, env)).json()) as State
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error
const clear = (userId: number, ...keys: string[]) => {
  for (const key of keys) {
    getSqlite().prepare('insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, ?)').run(userId, key, Date.now())
  }
}
/** Uma fileira de casas com o mesmo chão. */
const strip = (row: number, from: number, to: number, floor: string | null) =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ col: from + index, row, floor }))

test('chão: pinta sem custo, abre por marco, volta ao gramado e ignora o canteiro', async () => {
  const p = player('habitat-chao')
  const floors = (await state(p.cookie)).garden.layout.floors
  assert.deepEqual(
    floors.filter((row) => row.unlockAt === null).map((row) => row.floor),
    ['grama-alta', 'flores'],
  )
  assert.equal(floors.find((row) => row.floor === 'areia')?.unlockAt?.milestone, 'azalea')

  assert.equal((await post(p.cookie, '/build/floor', { cells: strip(0, 0, 5, 'flores') })).status, 200)
  assert.equal(await errorOf(await post(p.cookie, '/build/floor', { cells: strip(1, 0, 0, 'areia') })), 'floor_locked')
  clear(p.userId, 'violet', 'azalea')
  assert.equal((await post(p.cookie, '/build/floor', { cells: strip(1, 0, 0, 'areia') })).status, 200)

  // Canteiro tem chão próprio: a casa pintada embaixo dele não aparece.
  await post(p.cookie, '/build/floor', { cells: [{ col: 1, row: 9, floor: 'flores' }] })
  await post(p.cookie, '/build/floor', { cells: [{ col: 0, row: 0, floor: null }] })
  const floor = (await state(p.cookie)).garden.layout.floor
  assert.equal(floor.length, 6)
  assert.ok(!floor.some((tile) => tile.col === 1 && tile.row === 9))
  assert.ok(!floor.some((tile) => tile.col === 0 && tile.row === 0))

  assert.equal(await errorOf(await post(p.cookie, '/build/floor', { cells: strip(0, 11, 12, 'flores') })), 'out_of_bounds')
  assert.equal(await errorOf(await post(p.cookie, '/build/floor', { cells: [{ col: 0, row: 0, floor: 'lava' }] })), 'invalid_body')
})

test('casa: só no habitat do tipo, até as vagas; quem perde o habitat sai da casa', async () => {
  const p = player('habitat-casa')
  const home = (id: number, cell: { col: number; row: number } | null) => post(p.cookie, `/garden/pets/${id}/home`, { home: cell })

  // Zona pequena não é habitat.
  await post(p.cookie, '/build/floor', { cells: strip(0, 0, 4, 'flores') })
  assert.equal(await errorOf(await home(p.starterId, { col: 2, row: 0 })), 'not_a_habitat')

  // 6 casas de flores: Pradaria com 2 vagas; a casa guardada é a âncora da zona.
  await post(p.cookie, '/build/floor', { cells: strip(0, 5, 5, 'flores') })
  assert.equal((await home(p.starterId, { col: 3, row: 0 })).status, 200)
  assert.deepEqual((await state(p.cookie)).pokemon.find((mon) => mon.id === p.starterId)?.home, { col: 0, row: 0 })
  assert.ok(habitatBonusIds(p.userId).has(p.starterId), 'Chikorita na Pradaria ganha o bônus')

  const second = copyOf(p.starterId)
  const third = copyOf(p.starterId)
  assert.equal((await home(second, { col: 5, row: 0 })).status, 200)
  assert.equal(await errorOf(await home(third, { col: 1, row: 0 })), 'habitat_full')

  // Lago não aceita Planta.
  clear(p.userId, 'violet', 'azalea', 'goldenrod', 'ecruteak')
  await post(p.cookie, '/build/floor', { cells: strip(3, 0, 5, 'agua') })
  assert.equal(await errorOf(await home(third, { col: 0, row: 3 })), 'wrong_habitat')

  // Apagar metade da Pradaria: vira decoração e os dois saem da casa.
  const erased = await post(p.cookie, '/build/floor', { cells: strip(0, 3, 5, null) })
  const body = (await erased.json()) as { evicted: number[] }
  assert.deepEqual(body.evicted.sort(), [p.starterId, second].sort())
  const after = await state(p.cookie)
  assert.equal(after.pokemon.find((mon) => mon.id === p.starterId)?.home, null)
  assert.equal(habitatBonusIds(p.userId).size, 0)

  // Sair da casa por conta própria.
  await post(p.cookie, '/build/floor', { cells: strip(0, 3, 5, 'flores') })
  await home(p.starterId, { col: 0, row: 0 })
  assert.equal((await home(p.starterId, null)).status, 200)
  assert.equal((await state(p.cookie)).pokemon.find((mon) => mon.id === p.starterId)?.home, null)
})
