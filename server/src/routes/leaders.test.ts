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
import { leaderConfigs } from '../config/leaders.js'
import { milestoneByKey } from '../config/milestones.js'
import { natures } from '../config/natures.js'
import { traitsConfig } from '../config/traits.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { sessions } from '../db/schema.js'
import { resolveAbilityKey } from '../game/traits.js'
import { abilitiesFor, movesByName } from '../seed/traitsData.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-leaders-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { encounterRoutes } = await import('./encounters.js')
const { leaderRoutes } = await import('./leaders.js')
const { placeRoutes } = await import('./places.js')
const { devRoutes } = await import('./dev.js')

const app = new Hono()
  .route('/encounters', encounterRoutes)
  .route('/leaders', leaderRoutes)
  .route('/places', placeRoutes)
  .route('/dev', devRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

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
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

type Encounter = {
  id: number
  speciesId: number
  level: number
  leader: { key: string; name: string; foes: { speciesId: number; level: number; ace: boolean }[] } | null
}
type Battle = {
  won: boolean
  status: string
  opponent: { kind: string; name?: string; cleared?: { key: string; opens: number } | null }
}

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('config dos líderes: marcos, golpes, habilidades e naturezas existem', () => {
  const moves = movesByName()
  const natureKeys = new Set(natures.map((nature) => nature.key))
  for (const leader of leaderConfigs) {
    assert.ok(milestoneByKey(leader.milestoneKey), leader.milestoneKey)
    assert.ok(leader.foes.length >= 2, `${leader.name}: pelo menos 2 Pokémon`)
    assert.equal(leader.foes.filter((foe) => foe.ace).length, 1, `${leader.name}: um ás`)
    for (const foe of leader.foes) {
      const fast = moves.get(foe.fastMove)
      assert.ok(fast && fast.power > 0 && fast.power <= traitsConfig.fastPowerMax, `${foe.fastMove} não é rápido`)
      if (foe.chargedMove) {
        const charged = moves.get(foe.chargedMove)
        assert.ok(charged && charged.power > traitsConfig.fastPowerMax, `${foe.chargedMove} não é carregado`)
      }
      assert.ok(natureKeys.has(foe.nature), foe.nature)
      const abilities = abilitiesFor(foe.speciesId)
      // A posição pedida existe (senão cairia na 1ª sem avisar).
      if (foe.abilitySlot === '2') assert.ok(abilities.slot2, `${foe.speciesId} sem 2ª habilidade`)
      if (foe.abilitySlot === 'hidden') assert.ok(abilities.hidden, `${foe.speciesId} sem habilidade oculta`)
      assert.ok(resolveAbilityKey(abilities, foe.abilitySlot))
    }
  }
})

test('desafio: vencer cada Pokémon do líder abre o próximo; o último dá o marco', async () => {
  const { cookie, userId } = player('challenger')
  const sql = getSqlite()
  sql.prepare(`update trainers set level = 5, current_place = 'violet' where user_id = ?`).run(userId)
  // Um time que vence com folga, para o teste não depender da sorte da luta.
  sql.prepare(`update pokemon set level = 60 where user_id = ?`).run(userId)
  const team = (sql.prepare(`select id from pokemon where user_id = ? and team_slot is not null`).all(userId) as { id: number }[]).map(
    (row) => row.id,
  )

  // O marco de Violet não sai mais pelo resgate: só vencendo o líder.
  assert.equal(await errorOf(await post('/places/milestones/violet/claim', cookie)), 'leader_required')

  const started = await post('/leaders/violet/challenge', cookie)
  assert.equal(started.status, 201)
  const encounter = (await started.json()) as Encounter
  assert.equal(encounter.leader?.name, 'Líder de Violet')
  assert.deepEqual(
    encounter.leader?.foes.map((foe) => [foe.speciesId, foe.level, foe.ace]),
    [
      [16, 7, false],
      [17, 9, true],
    ],
  )
  // Com encontro em andamento, não abre outro desafio.
  assert.equal(await errorOf(await post('/leaders/violet/challenge', cookie)), 'encounter_pending')

  // Uma luta só, contra o time todo: os dois caem, e vem o marco.
  const response = await post(`/encounters/${encounter.id}/battle`, cookie, { pokemonIds: team })
  const battle = (await response.json()) as Battle & { log: { kind: string; side?: string; slot?: number }[] }
  assert.equal(battle.won, true)
  assert.equal(battle.status, 'defeated')
  assert.equal(battle.opponent.kind, 'leader')
  assert.equal(battle.opponent.name, 'Líder de Violet')
  assert.deepEqual(
    battle.log.filter((e) => e.kind === 'faint' && e.side === 'wild').map((e) => e.slot),
    [0, 1],
  )
  assert.deepEqual(battle.opponent.cleared && { key: battle.opponent.cleared.key, opens: battle.opponent.cleared.opens }, {
    key: 'violet',
    opens: 2,
  })
  // Vitória contra o líder não abre captura.
  assert.equal(await errorOf(await post(`/encounters/${encounter.id}/throw`, cookie, { ball: 'poke', quality: 'nice' })), 'encounter_not_found')
  const cleared = sql.prepare(`select count(*) as n from trainer_milestones where user_id = ? and milestone_key = 'violet'`).get(userId) as {
    n: number
  }
  assert.equal(cleared.n, 1)
  assert.equal(await errorOf(await post('/leaders/violet/challenge', cookie)), 'milestone_cleared')

  // Teste: refazer o último líder tira o marco e deixa desafiar de novo.
  sql.prepare(`update trainers set current_place = 'route-30' where user_id = ?`).run(userId)
  const reset = await post('/dev/leader/reset', cookie)
  assert.deepEqual(await reset.json(), { key: 'violet', name: 'Marco de Violet', town: 'violet' })
  assert.equal((await post('/leaders/violet/challenge', cookie)).status, 201)
  assert.equal(await errorOf(await post('/dev/leader/reset', cookie)), 'no_leader_cleared')
})

test('desafio fora da cidade ou sem nível é recusado', async () => {
  const { cookie, userId } = player('rookie')
  assert.equal(await errorOf(await post('/leaders/violet/challenge', cookie)), 'milestone_not_here')
  getSqlite().prepare(`update trainers set level = 1, current_place = 'violet' where user_id = ?`).run(userId)
  assert.equal(await errorOf(await post('/leaders/violet/challenge', cookie)), 'milestone_level')
  assert.equal(await errorOf(await post('/leaders/nowhere/challenge', cookie)), 'milestone_not_found')
})
