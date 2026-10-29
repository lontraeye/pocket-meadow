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
import { checkPlaces, linksOf, placeConfigs, START_PLACE } from '../config/places.js'
import { loadRegions } from '../config/regions.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { sessions } from '../db/schema.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-places-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { placeRoutes } = await import('./places.js')
const { encounterRoutes } = await import('./encounters.js')

const app = new Hono().route('/places', placeRoutes).route('/encounters', encounterRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

type Link = { to: string; requires: string | null; open: boolean; reason: string | null; isNew: boolean }
type View = {
  current: string
  canFly: boolean
  flyReason: string | null
  goal: {
    chapter: number
    caught: number
    total: number
    milestone: { key: string; town: string; needLevel: number; ready: boolean; here: boolean } | null
  }
  places: { slug: string; open: boolean; visited: boolean; links: Link[]; speciesTotal: number }[]
  here: { species: { speciesId: number | null; status: string }[] }
}

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

/** Põe no time uma cópia do inicial com outra espécie. */
function addToTeam(userId: number, speciesId: number, slot: number): void {
  getSqlite()
    .prepare(
      `insert into pokemon (user_id, species_id, level, xp, caught_at, original_species_id, location, in_pc, team_slot)
       select user_id, ?, level, 0, caught_at, ?, 'garden', 0, ?
       from pokemon where user_id = ? limit 1`,
    )
    .run(speciesId, speciesId, slot, userId)
}

const post = (url: string, cookie: string, body: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, env)
const view = async (cookie: string) => (await (await app.request('/places', { headers: { cookie } }, env)).json()) as View
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('o config confere, toda área de Johto tem lugar e o mapa é conectado', () => {
  checkPlaces()
  const slugs = new Set(placeConfigs.map((place) => place.slug))
  for (const region of loadRegions().filter((item) => item.gameRegion === 'johto')) {
    assert.ok(slugs.has(region.slug), `${region.slug} sem lugar`)
  }
  const seen = new Set([START_PLACE])
  const queue = [START_PLACE]
  while (queue.length > 0) {
    for (const link of linksOf(queue.shift()!)) {
      if (seen.has(link.to)) continue
      seen.add(link.to)
      queue.push(link.to)
    }
  }
  assert.equal(seen.size, placeConfigs.length)
})

test('começa em New Bark; anda só para vizinhos abertos; avisa a primeira visita', async () => {
  const { cookie, userId } = player('ethan')
  let places = await view(cookie)
  assert.equal(places.current, 'new-bark')
  const links = places.places.find((place) => place.slug === 'new-bark')!.links
  assert.deepEqual(links.find((link) => link.to === 'route-29'), { to: 'route-29', requires: null, open: true, reason: null, isNew: true })
  assert.equal(links.find((link) => link.to === 'route-27')?.open, false)

  assert.equal(await errorOf(await post('/places/travel', cookie, { to: 'cherrygrove' })), 'place_not_linked')
  let moved = await post('/places/travel', cookie, { to: 'route-29' })
  assert.deepEqual(await moved.json(), { current: 'route-29', firstVisit: true, flew: false })
  moved = await post('/places/travel', cookie, { to: 'new-bark' })
  assert.deepEqual(await moved.json(), { current: 'new-bark', firstVisit: false, flew: false })

  // Violet só abre a Rota 32 com o marco de Violet (nível alto não basta).
  getSqlite().prepare(`update trainers set level = 20 where user_id = ?`).run(userId)
  getSqlite().prepare(`update trainers set current_place = 'violet' where user_id = ?`).run(userId)
  assert.equal(await errorOf(await post('/places/travel', cookie, { to: 'route-32' })), 'place_locked')
  places = await view(cookie)
  assert.equal(places.places.find((place) => place.slug === 'route-29')?.visited, true)
  assert.equal(places.goal.chapter, 1)
  assert.equal(places.goal.milestone?.key, 'violet')
  assert.equal(places.goal.milestone?.needLevel, 3)
  assert.equal(places.goal.milestone?.here, true)
})

test('encontro só onde está; não viaja com encontro pendente; espécies do lugar sem spoiler', async () => {
  const { cookie } = player('kris')
  assert.equal(await errorOf(await post('/encounters', cookie, { regionSlug: 'route-29' })), 'not_here')
  await post('/places/travel', cookie, { to: 'route-29' })

  let places = await view(cookie)
  assert.ok(places.here.species.length > 0)
  assert.ok(places.here.species.every((entry) => entry.status === 'unknown' && entry.speciesId === null))

  const created = await post('/encounters', cookie, { regionSlug: 'route-29' })
  assert.equal(created.status, 201)
  const wild = (await created.json()) as { id: number; speciesId: number }
  assert.equal(await errorOf(await post('/places/travel', cookie, { to: 'new-bark' })), 'encounter_pending')

  places = await view(cookie)
  assert.ok(places.here.species.some((entry) => entry.speciesId === wild.speciesId && entry.status === 'seen'))
  assert.equal(await errorOf(await post('/encounters', cookie, { regionSlug: 'route-30' })), 'not_here')
})

test('marco: só na cidade e com o nível; abre o capítulo seguinte uma vez', async () => {
  const { cookie, userId } = player('lyra')
  const claim = () => app.request('/places/milestones/violet/claim', { method: 'POST', headers: { cookie } }, env)
  assert.equal(await errorOf(await claim()), 'milestone_not_here')

  getSqlite().prepare(`update trainers set current_place = 'violet' where user_id = ?`).run(userId)
  assert.equal(await errorOf(await claim()), 'milestone_level')
  getSqlite().prepare(`update trainers set level = 3 where user_id = ?`).run(userId)
  let places = await view(cookie)
  assert.equal(places.goal.milestone?.ready, true)
  const ok = await claim()
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { key: 'violet', opens: 2, grants: [] })
  assert.equal(await errorOf(await claim()), 'milestone_cleared')

  places = await view(cookie)
  assert.equal(places.goal.chapter, 2)
  assert.equal(places.goal.milestone?.key, 'azalea')
  assert.equal((await post('/places/travel', cookie, { to: 'route-32' })).status, 200)
})

test('Voo: com o marco de Cianwood, viaja direto para uma cidade visitada', async () => {
  const { cookie, userId } = player('silver')
  const grant = getSqlite().prepare(`insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, 1)`)
  for (const key of ['violet', 'azalea', 'goldenrod', 'ecruteak']) grant.run(userId, key)
  getSqlite().prepare(`insert into trainer_places (user_id, place_slug, first_visit_at) values (?, 'goldenrod', 1)`).run(userId)

  // Sem Voo, Goldenrod está longe de New Bark.
  assert.equal(await errorOf(await post('/places/travel', cookie, { to: 'goldenrod' })), 'place_not_linked')
  grant.run(userId, 'cianwood')
  // Voo ganho, mas o time não tem Pokémon Voador.
  let places = await view(cookie)
  assert.equal(places.canFly, false)
  assert.equal(places.flyReason, 'Voo: precisa de um Pokémon do tipo Voador no time')
  assert.equal(await errorOf(await post('/places/travel', cookie, { to: 'goldenrod' })), 'place_not_linked')
  addToTeam(userId, 16, 1) // Pidgey
  places = await view(cookie)
  assert.equal(places.canFly, true)
  assert.equal(places.flyReason, null)
  const flew = await post('/places/travel', cookie, { to: 'goldenrod' })
  assert.deepEqual(await flew.json(), { current: 'goldenrod', firstVisit: false, flew: true })
  // Voo só para cidade visitada: Azalea nunca foi visitada.
  assert.equal(await errorOf(await post('/places/travel', cookie, { to: 'azalea' })), 'place_not_linked')
})

test('Surf: abre no marco de Ecruteak e pede um Pokémon de Água no time', async () => {
  const { cookie, userId } = player('surfer')
  const grant = getSqlite().prepare(`insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, 1)`)
  for (const key of ['violet', 'azalea', 'goldenrod']) grant.run(userId, key)
  getSqlite().prepare(`update trainers set current_place = 'olivine' where user_id = ?`).run(userId)
  const seaLink = async () =>
    (await view(cookie)).places.find((place) => place.slug === 'olivine')!.links.find((link) => link.to === 'sea-routes-40-41')!

  // Capítulo 5 ainda fechado: o motivo é o marco do capítulo.
  assert.equal((await seaLink()).reason, 'Abre no Marco de Ecruteak')
  grant.run(userId, 'ecruteak')
  const link = await seaLink()
  assert.equal(link.open, false)
  assert.equal(link.requires, 'surf')
  assert.equal(link.reason, 'Surf: precisa de um Pokémon do tipo Água no time')
  assert.equal(await errorOf(await post('/places/travel', cookie, { to: 'sea-routes-40-41' })), 'place_locked')

  addToTeam(userId, 158, 1) // Totodile
  assert.equal((await seaLink()).open, true)
  assert.equal((await post('/places/travel', cookie, { to: 'sea-routes-40-41' })).status, 200)
})
