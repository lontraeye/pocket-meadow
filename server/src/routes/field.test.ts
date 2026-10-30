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
import { battleConfig } from '../config/battle.js'
import { regionBySlug } from '../config/regions.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { sessions } from '../db/schema.js'
import { rollWild } from '../game/battle.js'
import { mulberry32 } from '../game/rng.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-field-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { fieldRoutes } = await import('./field.js')
const { placeRoutes } = await import('./places.js')

const app = new Hono().route('/field', fieldRoutes).route('/places', placeRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

type Spawn = { id: number; slot: number; speciesId: number; level: number; isShiny: boolean; displayName: string }

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

const post = (url: string, cookie: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, env)
const field = (cookie: string) => app.request('/field', { headers: { cookie } }, env)
const spawnsOf = async (cookie: string) => ((await (await field(cookie)).json()) as { spawns: Spawn[] }).spawns
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('cidade não tem campo; na rota aparecem 4 da área, já vistos, e o campo fica salvo', async () => {
  const { cookie, userId } = player('ethan')
  assert.equal(await errorOf(await field(cookie)), 'no_field_here')

  await post('/places/travel', cookie, { to: 'route-29' })
  const spawns = await spawnsOf(cookie)
  assert.equal(spawns.length, battleConfig.fieldSize)
  assert.deepEqual(
    spawns.map((spawn) => spawn.slot),
    [0, 1, 2, 3],
  )
  const region = regionBySlug('route-29')!
  for (const spawn of spawns) {
    const slot = region.slots.find((entry) => entry.speciesId === spawn.speciesId)
    assert.ok(slot, `${spawn.speciesId} não é da Rota 29`)
    assert.ok(region.slots.some((entry) => entry.speciesId === spawn.speciesId && spawn.level >= entry.minLevel && spawn.level <= entry.maxLevel))
  }
  const seen = getSqlite()
    .prepare(`select species_id from pokedex_entries where user_id = ? and seen_count > 0`)
    .all(userId) as { species_id: number }[]
  for (const spawn of spawns) assert.ok(seen.some((row) => row.species_id === spawn.speciesId))

  // Sair e voltar: os mesmos.
  await post('/places/travel', cookie, { to: 'new-bark' })
  await post('/places/travel', cookie, { to: 'route-29' })
  assert.deepEqual(
    (await spawnsOf(cookie)).map((spawn) => spawn.id),
    spawns.map((spawn) => spawn.id),
  )
})

test('enfrentar leva o Pokémon do campo para o encontro, com a mesma semente, e a vaga fica vazia', async () => {
  const { cookie } = player('kris')
  await post('/places/travel', cookie, { to: 'route-29' })
  const before = await spawnsOf(cookie)
  const target = before[1]!

  const engaged = await post('/field/1/engage', cookie)
  assert.equal(engaged.status, 201)
  const encounter = (await engaged.json()) as { id: number; speciesId: number; level: number; isShiny: boolean }
  assert.equal(encounter.speciesId, target.speciesId)
  assert.equal(encounter.level, target.level)

  // Quem foi enfrentado sai; os outros ficam como estavam.
  const after = await spawnsOf(cookie)
  assert.equal(after.length, battleConfig.fieldSize - 1)
  assert.equal(after.find((spawn) => spawn.slot === 1), undefined)
  assert.deepEqual(
    after.map((spawn) => spawn.id),
    before.filter((spawn) => spawn.slot !== 1).map((spawn) => spawn.id),
  )

  // Replay (seção 7): a semente do encontro sorteia o mesmo selvagem.
  const row = getSqlite().prepare(`select rng_seed from encounters where id = ?`).get(encounter.id) as { rng_seed: number }
  const replay = rollWild(mulberry32(row.rng_seed), { slots: regionBySlug('route-29')!.slots, shinyRate: battleConfig.shinyRate })
  assert.equal(replay.speciesId, target.speciesId)
  assert.equal(replay.level, target.level)

  // Com encontro pendente, não dá para enfrentar outro (e a vaga não é gasta).
  const other = after.find((spawn) => spawn.slot === 2)!
  assert.equal(await errorOf(await post('/field/2/engage', cookie)), 'encounter_pending')
  assert.equal((await spawnsOf(cookie)).find((spawn) => spawn.slot === 2)?.id, other.id)
})

test('explorar de novo: só com o campo vazio; chegar na área enche o campo vazio', async () => {
  const { cookie, userId } = player('lyra')
  await post('/places/travel', cookie, { to: 'route-29' })
  const response = (await (await field(cookie)).json()) as { spawns: Spawn[]; canExplore: boolean }
  assert.equal(response.canExplore, false)
  assert.equal(await errorOf(await post('/field/explore', cookie)), 'field_not_empty')

  const clearEncounter = getSqlite().prepare(`delete from encounters where user_id = ?`)
  for (const spawn of response.spawns) {
    assert.equal((await post(`/field/${spawn.slot}/engage`, cookie)).status, 201)
    clearEncounter.run(userId)
  }
  // Vazio: o GET não repõe ninguém, mas oferece explorar.
  const empty = (await (await field(cookie)).json()) as { spawns: Spawn[]; canExplore: boolean }
  assert.equal(empty.spawns.length, 0)
  assert.equal(empty.canExplore, true)

  const explored = await post('/field/explore', cookie)
  assert.equal(explored.status, 200)
  const filled = (await explored.json()) as { spawns: Spawn[]; canExplore: boolean }
  assert.equal(filled.spawns.length, battleConfig.fieldSize)
  assert.equal(filled.canExplore, false)

  // Esvazia de novo, sai e volta: a chegada enche.
  getSqlite().prepare(`delete from field_spawns where user_id = ?`).run(userId)
  await post('/places/travel', cookie, { to: 'new-bark' })
  await post('/places/travel', cookie, { to: 'route-29' })
  assert.equal((await spawnsOf(cookie)).length, battleConfig.fieldSize)
})

test('vaga inexistente e área fechada são recusadas', async () => {
  const { cookie, userId } = player('silver')
  await post('/places/travel', cookie, { to: 'route-29' })
  assert.equal(await errorOf(await post('/field/9/engage', cookie)), 'spawn_not_found')
  // Lugar salvo numa área de capítulo fechado (ex.: veio de um config antigo).
  getSqlite().prepare(`update trainers set current_place = 'route-32' where user_id = ?`).run(userId)
  assert.equal(await errorOf(await field(cookie)), 'region_locked')
})

type Spot = { kind: string; actions: { method: string; label: string; open: boolean; reason: string | null }[] }
const spotsOf = async (cookie: string) => ((await (await field(cookie)).json()) as { spots: Spot[] }).spots

test('manchas: árvore e água aparecem fechadas sem marco; com a ferramenta, sorteiam da tabela do método', async () => {
  const { cookie, userId } = player('fisher')
  getSqlite().prepare(`update trainers set current_place = 'route-30' where user_id = ?`).run(userId)
  let spots = await spotsOf(cookie)
  assert.deepEqual(
    spots.map((spot) => spot.kind),
    ['water', 'tree'],
  )
  const fish = spots[0]!.actions.find((entry) => entry.label === 'Pescar')!
  assert.equal(fish.method, 'oldRod')
  assert.equal(fish.reason, 'Vara Velha abre no Marco de Azalea')
  assert.equal(await errorOf(await post('/field/use', cookie, { method: 'oldRod' })), 'tool_locked')
  assert.equal(await errorOf(await post('/field/use', cookie, { method: 'rockSmash' })), 'spot_not_found')

  const grant = getSqlite().prepare(`insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, 1)`)
  for (const key of ['violet', 'azalea']) grant.run(userId, key)
  spots = await spotsOf(cookie)
  assert.equal(spots[0]!.actions[0]!.open, true)
  // Surf ainda fechado (marco de Ecruteak).
  assert.equal(spots[0]!.actions.find((entry) => entry.method === 'surf')?.open, false)

  const used = await post('/field/use', cookie, { method: 'headbutt' })
  assert.equal(used.status, 201)
  const row = getSqlite()
    .prepare(`select species_id as speciesId, region_slug as regionSlug from encounters where user_id = ? and status = 'pending'`)
    .get(userId) as { speciesId: number; regionSlug: string }
  assert.equal(row.regionSlug, 'route-30')
  const tree = regionBySlug('route-30')!.methods.headbutt!
  assert.ok(tree.some((slot) => slot.speciesId === row.speciesId), `${row.speciesId} não é da árvore`)
  // Com encontro em andamento, não usa outra mancha.
  assert.equal(await errorOf(await post('/field/use', cookie, { method: 'oldRod' })), 'encounter_pending')
})

test('lugar só de água: sem ninguém no mato, só a mancha de água', async () => {
  const { cookie, userId } = player('sailor')
  const grant = getSqlite().prepare(`insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, 1)`)
  for (const key of ['violet', 'azalea', 'goldenrod', 'ecruteak']) grant.run(userId, key)
  getSqlite().prepare(`update trainers set current_place = 'sea-routes-40-41' where user_id = ?`).run(userId)
  const response = (await (await field(cookie)).json()) as { spawns: Spawn[]; spots: Spot[] }
  assert.equal(response.spawns.length, 0)
  assert.deepEqual(
    response.spots.map((spot) => spot.kind),
    ['water', 'rock'],
  )
})

