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
import { leagueConfig } from '../config/league.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { grantStructures } from '../db/structures.js'
import { itemQty } from '../db/inventory.js'
import { migrateDatabase } from '../db/migrate.js'
import { sessions } from '../db/schema.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-league-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { encounterRoutes } = await import('./encounters.js')
const { gardenRoutes } = await import('./garden.js')
const { leagueRoutes } = await import('./league.js')
const { placeRoutes } = await import('./places.js')

const app = new Hono()
  .route('/encounters', encounterRoutes)
  .route('/garden', gardenRoutes)
  .route('/league', leagueRoutes)
  .route('/places', placeRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }
const sql = () => getSqlite()

const GATES = ['violet', 'azalea', 'goldenrod', 'ecruteak', 'cianwood', 'olivine', 'mahogany', 'blackthorn']

before(() => migrateDatabase())
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
  const starterId = (sql().prepare('select id from pokemon where user_id = ?').get(userId) as { id: number }).id
  return { cookie: `${authConfig.cookieName}=${token}`, userId, starterId }
}

const post = (url: string, cookie: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, env)
const get = (url: string, cookie: string) => app.request(url, { headers: { cookie } }, env)
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

function openLeague(userId: number) {
  const now = Date.now()
  for (const key of GATES) {
    sql().prepare('insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, ?)').run(userId, key, now)
  }
  sql().prepare(`update trainers set current_place = 'indigo-plateau' where user_id = ?`).run(userId)
}

/**
 * Começa a tentativa e dispensa o encontro da 1ª luta que o start já abre:
 * os testes abaixo seguem pelo /league/next, como entre as lutas.
 */
async function startRun(cookie: string, pokemonIds: number[]) {
  const response = await post('/league/start', cookie, { pokemonIds })
  const body = (await response.json()) as { encounter?: { id: number } }
  if (response.ok && body.encounter) {
    assert.equal((await post(`/encounters/${body.encounter.id}/flee`, cookie)).status, 200)
  }
  return { status: response.status, body }
}

function teamJson(userId: number) {
  return JSON.parse(
    (sql().prepare(`select team from league_runs where user_id = ? and status = 'active'`).get(userId) as { team: string }).team,
  ) as { pokemonId: number; hpRatio: number }[]
}

test('a Liga recusa fora do Indigo Plateau, com o capítulo fechado e pelo resgate', async () => {
  const away = player('league-away')
  openLeague(away.userId)
  sql().prepare(`update trainers set current_place = 'new-bark' where user_id = ?`).run(away.userId)
  assert.equal(await errorOf(await post('/league/start', away.cookie, { pokemonIds: [away.starterId] })), 'milestone_not_here')

  const locked = player('league-locked')
  sql().prepare(`update trainers set current_place = 'indigo-plateau' where user_id = ?`).run(locked.userId)
  assert.equal(await errorOf(await post('/league/start', locked.cookie, { pokemonIds: [locked.starterId] })), 'milestone_locked')

  const here = player('league-claim')
  openLeague(here.userId)
  assert.equal(await errorOf(await post('/places/milestones/league/claim', here.cookie)), 'league_required')
})

test('o HP da tentativa passa para a luta seguinte e a máquina não mexe nele', async () => {
  const p = player('league-hp')
  openLeague(p.userId)
  sql().prepare('update pokemon set hp_ratio = 0.4, level = 100, species_id = 150 where id = ?').run(p.starterId)
  const started = await startRun(p.cookie, [p.starterId])
  assert.equal(started.status, 201)
  assert.equal(teamJson(p.userId)[0]!.hpRatio, 0.4)

  immediate(() => grantStructures(p.userId, Date.now()))
  const healed = await post('/garden/heal-machine/use', p.cookie)
  assert.equal(healed.status, 200)
  const row = sql().prepare('select hp_ratio as hp from pokemon where id = ?').get(p.starterId) as { hp: number }
  assert.equal(row.hp, 1)
  assert.equal(teamJson(p.userId)[0]!.hpRatio, 0.4)

  const next = await post('/league/next', p.cookie)
  assert.equal(next.status, 201)
  const encounter = (await next.json()) as { id: number }
  const battle = await post(`/encounters/${encounter.id}/battle/start`, p.cookie, { pokemonIds: [p.starterId] })
  assert.equal(battle.status, 200)
  const body = (await battle.json()) as { setup: { team: { startHpRatio?: number }[] } }
  assert.equal(body.setup.team[0]!.startHpRatio, 0.4)
})

test('derrota zera a tentativa; desmaiado no começo da próxima também', async () => {
  const p = player('league-loss')
  openLeague(p.userId)
  sql().prepare('update pokemon set level = 1 where id = ?').run(p.starterId)
  assert.equal((await startRun(p.cookie, [p.starterId])).status, 201)
  const next = await post('/league/next', p.cookie)
  const encounter = (await next.json()) as { id: number }
  const battle = await post(`/encounters/${encounter.id}/battle`, p.cookie, { pokemonIds: [p.starterId] })
  const lost = (await battle.json()) as { won: boolean; opponent: { league: { status: string } } }
  assert.equal(lost.won, false)
  assert.equal(lost.opponent.league.status, 'lost')
  const view = (await (await get('/league', p.cookie)).json()) as { run: unknown }
  assert.equal(view.run, null)

  sql().prepare('update pokemon set hp_ratio = 1, fainted_at = null, hunger = 100 where id = ?').run(p.starterId)
  assert.equal((await startRun(p.cookie, [p.starterId])).status, 201)
  sql().prepare(`update league_runs set team = ? where user_id = ? and status = 'active'`).run(
    JSON.stringify([{ pokemonId: p.starterId, hpRatio: 0 }]),
    p.userId,
  )
  assert.equal(await errorOf(await post('/league/next', p.cookie)), 'league_lost')
  const after = (await (await get('/league', p.cookie)).json()) as { run: unknown }
  assert.equal(after.run, null)
})

test('a quinta vitória dá o marco, abre o capítulo 10 e o prêmio só na primeira vez', async () => {
  const p = player('league-champ')
  openLeague(p.userId)
  sql()
    .prepare(
      `update pokemon set level = 100, species_id = 150, hp_ratio = 1, nature = 'modest',
        fast_move = 'powder-snow', charged_move = 'blizzard',
        iv_hp = 31, iv_attack = 31, iv_defense = 31, iv_sp_attack = 31, iv_sp_defense = 31, iv_speed = 31
       where id = ?`,
    )
    .run(p.starterId)
  assert.equal((await startRun(p.cookie, [p.starterId])).status, 201)

  type LeagueBattle = {
    won: boolean
    opponent: { league: { status: string; champion: boolean; rewards: string[]; nextName: string | null } }
  }
  let last: LeagueBattle | null = null
  for (let fight = 0; fight < 5; fight += 1) {
    const next = await post('/league/next', p.cookie)
    assert.equal(next.status, 201, `luta ${fight + 1}`)
    const encounter = (await next.json()) as { id: number; leader: { kind: string } | null }
    // A tela da Liga se guia pelo tipo do treinador no encontro.
    assert.equal(encounter.leader?.kind, fight < 4 ? 'elite' : 'champion')
    const response = await post(`/encounters/${encounter.id}/battle`, p.cookie, { pokemonIds: [p.starterId] })
    assert.equal(response.status, 200, `luta ${fight + 1}`)
    last = (await response.json()) as LeagueBattle
    assert.equal(last.won, true, `luta ${fight + 1}`)
    sql().prepare('update pokemon set hp_ratio = 1, fainted_at = null, hunger = 100 where id = ?').run(p.starterId)
    if (fight < 4) {
      sql()
        .prepare(`update league_runs set team = ? where user_id = ? and status = 'active'`)
        .run(JSON.stringify([{ pokemonId: p.starterId, hpRatio: 1 }]), p.userId)
    }
  }
  assert.equal(last!.opponent.league.status, 'won')
  assert.equal(last!.opponent.league.champion, true)
  assert.ok(last!.opponent.league.rewards.length > 0)

  const cleared = sql().prepare(`select count(*) as n from trainer_milestones where user_id = ? and milestone_key = 'league'`).get(p.userId) as {
    n: number
  }
  assert.equal(cleared.n, 1)
  assert.equal(itemQty(p.userId, 'ball:ultra'), leagueConfig.championRewards.items[0]!.quantity)
  assert.equal(itemQty(p.userId, 'mat:apricorn-yellow'), leagueConfig.championRewards.items[1]!.quantity)
  const candies = (sql().prepare('select generic_candies as n from trainers where user_id = ?').get(p.userId) as { n: number }).n
  assert.equal(candies, leagueConfig.championRewards.genericCandies)

  const places = (await (await get('/places', p.cookie)).json()) as {
    goal: { chapter: number }
    places: { slug: string; open: boolean }[]
  }
  assert.equal(places.goal.chapter, 10)
  assert.equal(places.places.find((place) => place.slug === 'tin-tower')?.open, true)
  // Campeão: começar de novo é a revanche, e o prêmio de campeão não vem outra vez.
  const rematch = (await (await post('/league/start', p.cookie, { pokemonIds: [p.starterId] })).json()) as {
    rematch: boolean
    trainers: { foes: { level: number }[] }[]
  }
  assert.equal(rematch.rematch, true)
  assert.equal(rematch.trainers[0]!.foes[0]!.level, 40 + leagueConfig.rematchLevelBonus)
  assert.equal((await post('/league/abandon', p.cookie)).status, 200)
  assert.equal(itemQty(p.userId, 'ball:ultra'), leagueConfig.championRewards.items[0]!.quantity)

  const again = player('league-again')
  openLeague(again.userId)
  sql().prepare('insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, ?)').run(again.userId, 'league', Date.now())
  sql()
    .prepare(
      `update pokemon set level = 100, species_id = 150, nature = 'modest',
        fast_move = 'powder-snow', charged_move = 'blizzard',
        iv_hp = 31, iv_attack = 31, iv_defense = 31, iv_sp_attack = 31, iv_sp_defense = 31, iv_speed = 31
       where id = ?`,
    )
    .run(again.starterId)
  sql()
    .prepare(`insert into league_runs (user_id, started_at, stage, status, team) values (?, ?, 4, 'active', ?)`)
    .run(again.userId, Date.now(), JSON.stringify([{ pokemonId: again.starterId, hpRatio: 1 }]))
  const next = await post('/league/next', again.cookie)
  const encounter = (await next.json()) as { id: number }
  const battle = await post(`/encounters/${encounter.id}/battle`, again.cookie, { pokemonIds: [again.starterId] })
  const body = (await battle.json()) as { won: boolean; opponent: { league: { rewards: string[] } } }
  assert.equal(body.won, true)
  assert.deepEqual(body.opponent.league.rewards, [])
  assert.equal(itemQty(again.userId, 'ball:ultra'), 0)
})

test('revanche: o prêmio vem uma vez por semana, sem mexer no marco', async () => {
  const p = player('league-rematch')
  openLeague(p.userId)
  sql().prepare('insert into trainer_milestones (user_id, milestone_key, cleared_at) values (?, ?, ?)').run(p.userId, 'league', Date.now())
  const winLast = async () => {
    sql()
      .prepare(
        `update pokemon set level = 100, species_id = 150, hp_ratio = 1, fainted_at = null, hunger = 100, nature = 'modest',
          fast_move = 'powder-snow', charged_move = 'blizzard',
          iv_hp = 31, iv_attack = 31, iv_defense = 31, iv_sp_attack = 31, iv_sp_defense = 31, iv_speed = 31
         where id = ?`,
      )
      .run(p.starterId)
    sql()
      .prepare(`insert into league_runs (user_id, started_at, stage, status, team, rematch) values (?, ?, 4, 'active', ?, 1)`)
      .run(p.userId, Date.now(), JSON.stringify([{ pokemonId: p.starterId, hpRatio: 1 }]))
    const encounter = (await (await post('/league/next', p.cookie)).json()) as { id: number; level: number }
    assert.equal(encounter.level, 44 + leagueConfig.rematchLevelBonus, 'o campeão da revanche')
    const battle = (await (await post(`/encounters/${encounter.id}/battle`, p.cookie, { pokemonIds: [p.starterId] })).json()) as {
      won: boolean
      opponent: { league: { status: string; rematch: boolean; rewards: string[]; opens: number | null } }
    }
    assert.equal(battle.won, true)
    assert.equal(battle.opponent.league.status, 'won')
    assert.equal(battle.opponent.league.rematch, true)
    assert.equal(battle.opponent.league.opens, null)
    return battle.opponent.league.rewards
  }
  const ultra = leagueConfig.rematchRewards.items[0]!

  assert.equal((await winLast()).length, leagueConfig.rematchRewards.items.length + 1)
  assert.equal(itemQty(p.userId, ultra.itemKey), ultra.quantity)
  assert.deepEqual(await winLast(), [], 'a segunda na mesma semana não dá prêmio')
  assert.equal(itemQty(p.userId, ultra.itemKey), ultra.quantity)

  // As vitórias de antes da semana não contam: o prêmio volta.
  sql().prepare(`update league_runs set finished_at = finished_at - 8 * 24 * 60 * 60 * 1000 where user_id = ?`).run(p.userId)
  assert.equal((await winLast()).length, leagueConfig.rematchRewards.items.length + 1)
  assert.equal(itemQty(p.userId, ultra.itemKey), ultra.quantity * 2)
  const milestones = sql().prepare(`select count(*) as n from trainer_milestones where user_id = ? and milestone_key = 'league'`).get(p.userId) as { n: number }
  assert.equal(milestones.n, 1)
})

test('na Liga, o primeiro da lista enviada abre a luta (se estiver vivo na tentativa)', async () => {
  const p = player('league-lead')
  openLeague(p.userId)
  const second = sql()
    .prepare(
      `insert into pokemon (user_id, species_id, level, team_slot, caught_at, caught_ball, original_species_id,
        iv_hp, iv_attack, iv_defense, iv_sp_attack, iv_sp_defense, iv_speed, nature, ability_slot, fast_move, charged_move)
       select user_id, 150, 50, 1, caught_at, caught_ball, 150, 31, 31, 31, 31, 31, 31, 'modest', ability_slot, 'confusion', 'psychic'
       from pokemon where id = ?`,
    )
    .run(p.starterId).lastInsertRowid as number
  assert.equal((await startRun(p.cookie, [p.starterId, second])).status, 201)
  const encounter = (await (await post('/league/next', p.cookie)).json()) as { id: number }
  const start = (await (await post(`/encounters/${encounter.id}/battle/start`, p.cookie, { pokemonIds: [second, p.starterId] })).json()) as {
    setup: { team: { id: number }[]; foes: unknown[] }
    timeLimitMs: number
  }
  assert.deepEqual(start.setup.team.map((fighter) => fighter.id), [second, p.starterId])
  // Elite de 5: 60 s + 4 × 30 s.
  assert.equal(start.timeLimitMs, 180_000)
})

test('começar já abre a 1ª luta, e desistir fecha a Liga e esse encontro de uma vez', async () => {
  const p = player('league-flow')
  openLeague(p.userId)
  const started = await post('/league/start', p.cookie, { pokemonIds: [p.starterId] })
  assert.equal(started.status, 201)
  const body = (await started.json()) as { run: { stage: number } | null; encounter: { id: number; leader: { key: string } } }
  assert.equal(body.run?.stage, 0)
  assert.equal(body.encounter.leader.key, 'league-1')

  assert.equal((await post('/league/abandon', p.cookie)).status, 200)
  const encounter = sql().prepare('select status from encounters where id = ?').get(body.encounter.id) as { status: string }
  assert.equal(encounter.status, 'fled')
  const view = (await (await get('/league', p.cookie)).json()) as { run: unknown }
  assert.equal(view.run, null)

  // Com a luta já começada, desistir espera a luta acabar.
  const again = (await (await post('/league/start', p.cookie, { pokemonIds: [p.starterId] })).json()) as { encounter: { id: number } }
  assert.equal((await post(`/encounters/${again.encounter.id}/battle/start`, p.cookie, { pokemonIds: [p.starterId] })).status, 200)
  assert.equal(await errorOf(await post('/league/abandon', p.cookie)), 'battle_in_progress')
})
