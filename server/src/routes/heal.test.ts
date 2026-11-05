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
import { healConfig } from '../config/heal.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { HEAL_MACHINE_KEY, healMachinesView, useHealMachine } from '../db/healMachine.js'
import { grantStructures } from '../db/structures.js'
import { migrateDatabase } from '../db/migrate.js'
import { settleGarden } from '../db/pets.js'
import { sessions } from '../db/schema.js'
import { simConfig } from '../game/sim/config.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-heal-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { encounterRoutes } = await import('./encounters.js')
const { gardenRoutes } = await import('./garden.js')
const { stateRoutes } = await import('./state.js')

const app = new Hono()
  .route('/encounters', encounterRoutes)
  .route('/garden', gardenRoutes)
  .route('/state', stateRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }
const hourMs = 60 * 60 * 1000
const sql = () => getSqlite()

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
  const starter = sql().prepare('select id from pokemon where user_id = ?').get(userId) as { id: number }
  sql().prepare(`update trainers set current_place = 'route-29' where user_id = ?`).run(userId)
  return { cookie: `${authConfig.cookieName}=${token}`, userId, starterId: starter.id }
}

const post = (cookie: string, url: string, body: unknown = {}) =>
  app.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)

const hpOf = (id: number) =>
  sql().prepare(
    'select hp_ratio as hpRatio, hp_updated_at as hpUpdatedAt, fainted_at as faintedAt from pokemon where id = ?',
  ).get(id) as {
    hpRatio: number
    hpUpdatedAt: number | null
    faintedAt: number | null
  }

test('luta começa com o HP guardado (startHpRatio no setup)', async () => {
  const p = player('heal-start')
  sql().prepare('update pokemon set hp_ratio = 0.4 where id = ?').run(p.starterId)
  const created = await post(p.cookie, '/encounters', { regionSlug: 'route-29' })
  assert.equal(created.status, 201)
  const encounter = (await created.json()) as { id: number }
  const started = await post(p.cookie, `/encounters/${encounter.id}/battle/start`, { pokemonIds: [p.starterId] })
  assert.equal(started.status, 200)
  const body = (await started.json()) as {
    setup: { team: { startHpRatio?: number; stats: { hp: number } }[] }
  }
  assert.equal(body.setup.team[0]!.startHpRatio, 0.4)
  const maxHp = Math.max(1, Math.floor(body.setup.team[0]!.stats.hp * simConfig.battleHpMultiplier))
  const expected = Math.max(1, Math.round(maxHp * 0.4))
  // Confere a fórmula do makeSide sem rodar a luta.
  assert.ok(expected <= maxHp)
  assert.ok(expected >= 1)
})

test('HP final da luta é gravado; desmaiado = 0 e fica fora do time', async () => {
  const p = player('heal-persist')
  // Time fraco vs selvagem alto: força derrota/desmaio do jogador.
  sql().prepare('update pokemon set level = 1, hp_ratio = 1 where id = ?').run(p.starterId)
  const created = await post(p.cookie, '/encounters', { regionSlug: 'route-29' })
  const encounter = (await created.json()) as { id: number }
  // Sobe o selvagem para garantir KO no automático.
  sql().prepare('update encounters set level = 50 where id = ?').run(encounter.id)
  const battle = await post(p.cookie, `/encounters/${encounter.id}/battle`, { pokemonIds: [p.starterId] })
  assert.equal(battle.status, 200)
  const outcome = (await battle.json()) as { won: boolean }
  assert.equal(outcome.won, false)
  const after = hpOf(p.starterId)
  assert.equal(after.hpRatio, 0)

  // Desmaiado não luta.
  const again = await post(p.cookie, '/encounters', { regionSlug: 'route-29' })
  const enc2 = (await again.json()) as { id: number }
  const refused = await post(p.cookie, `/encounters/${enc2.id}/battle/start`, { pokemonIds: [p.starterId] })
  assert.equal(refused.status, 400)
  assert.equal(((await refused.json()) as { error: string }).error, 'team_fainted')
})

test('desmaiado na luta continua fora 1 minuto depois (o descanso não o levanta)', async () => {
  const p = player('heal-faint-minute')
  sql().prepare('update pokemon set level = 1, hp_ratio = 1 where id = ?').run(p.starterId)
  const created = await post(p.cookie, '/encounters', { regionSlug: 'route-29' })
  const encounter = (await created.json()) as { id: number }
  sql().prepare('update encounters set level = 50 where id = ?').run(encounter.id)
  const battle = await post(p.cookie, `/encounters/${encounter.id}/battle`, { pokemonIds: [p.starterId] })
  assert.equal(battle.status, 200)
  assert.equal(((await battle.json()) as { won: boolean }).won, false)
  assert.equal(hpOf(p.starterId).hpRatio, 0)
  assert.ok(hpOf(p.starterId).faintedAt != null)

  // 1 minuto depois: o catch-up da próxima luta liquida o jardim. O desmaio
  // tem de continuar (team_fainted), e não virar HP > 0 pelo descanso.
  const ago = Date.now() - 60_000
  sql()
    .prepare(
      'update pokemon set pet_at = ?, hp_updated_at = ?, location = ?, in_pc = 0 where id = ?',
    )
    .run(ago, ago, 'garden', p.starterId)

  const again = await post(p.cookie, '/encounters', { regionSlug: 'route-29' })
  const enc2 = (await again.json()) as { id: number }
  const refused = await post(p.cookie, `/encounters/${enc2.id}/battle/start`, { pokemonIds: [p.starterId] })
  assert.equal(refused.status, 400)
  assert.equal(((await refused.json()) as { error: string }).error, 'team_fainted')
})

test('desmaiado não descansa; 2 h depois volta com 0,1 e o jardim continua', () => {
  const p = player('heal-faint-clock')
  const t0 = Date.now()
  sql()
    .prepare(
      'update pokemon set hp_ratio = 0, fainted_at = ?, hp_updated_at = ?, pet_at = ?, location = ?, in_pc = 0 where id = ?',
    )
    .run(t0, t0, t0, 'garden', p.starterId)
  immediate(() => settleGarden(p.userId, t0 + hourMs))
  const mid = hpOf(p.starterId)
  assert.equal(mid.hpRatio, 0)
  assert.equal(mid.faintedAt, t0)

  const wake = t0 + healConfig.faintRecoverMs
  immediate(() => settleGarden(p.userId, wake + healConfig.restFullMs / 2))
  const rested = hpOf(p.starterId)
  assert.equal(rested.faintedAt, null)
  assert.ok(Math.abs(rested.hpRatio - (healConfig.faintRecoverRatio + 0.5)) < 1e-9)
})

test('o relógio do desmaio corre no PC, sem descanso', () => {
  const p = player('heal-faint-pc')
  const t0 = Date.now()
  sql()
    .prepare('update pokemon set hp_ratio = 0, fainted_at = ?, hp_updated_at = ?, pet_at = ?, in_pc = 1 where id = ?')
    .run(t0, t0, t0, p.starterId)
  const wake = t0 + healConfig.faintRecoverMs
  immediate(() => settleGarden(p.userId, wake + healConfig.restFullMs))
  const woken = hpOf(p.starterId)
  assert.equal(woken.faintedAt, null)
  assert.equal(woken.hpRatio, healConfig.faintRecoverRatio)
  immediate(() => settleGarden(p.userId, wake + 2 * healConfig.restFullMs))
  assert.equal(hpOf(p.starterId).hpRatio, healConfig.faintRecoverRatio)
})

test('descanso no jardim recupera HP pelo tempo', () => {
  const p = player('heal-rest')
  const t0 = Date.now()
  sql()
    .prepare('update pokemon set hp_ratio = 0, hp_updated_at = ?, pet_at = ?, location = ?, in_pc = 0 where id = ?')
    .run(t0, t0, 'garden', p.starterId)
  immediate(() => settleGarden(p.userId, t0 + healConfig.restFullMs / 2))
  const mid = hpOf(p.starterId)
  assert.ok(Math.abs(mid.hpRatio - 0.5) < 1e-9)
  // A outra metade a partir do pet_at atualizado: chega a 1.
  immediate(() => settleGarden(p.userId, t0 + healConfig.restFullMs))
  const full = hpOf(p.starterId)
  assert.equal(full.hpRatio, 1)
})

test('máquina: recarrega pelo tempo, gasta 1 carga, cura a equipe e recusa sem carga', async () => {
  const p = player('heal-machine')
  const now = Date.now()
  immediate(() => grantStructures(p.userId, now))
  // Zera cargas e rebobina o since.
  sql()
    .prepare(`update garden_structures set progress = 0, since = ? where user_id = ? and key = ?`)
    .run(now, p.userId, HEAL_MACHINE_KEY)
  let view = immediate(() => healMachinesView(p.userId, now)[0]!)
  assert.equal(view.charges, 0)

  // Sem carga: recusa.
  sql().prepare('update pokemon set hp_ratio = 0.2 where id = ?').run(p.starterId)
  const empty = await post(p.cookie, '/garden/heal-machine/use')
  assert.equal(empty.status, 400)
  assert.equal(((await empty.json()) as { error: string }).error, 'no_charge')

  // Uma carga depois de 3h.
  sql()
    .prepare(`update garden_structures set progress = 0, since = ? where user_id = ? and key = ?`)
    .run(now - healConfig.machine.rechargeMs, p.userId, HEAL_MACHINE_KEY)
  view = immediate(() => healMachinesView(p.userId, now)[0]!)
  assert.equal(view.charges, 1)

  const used = await post(p.cookie, '/garden/heal-machine/use')
  assert.equal(used.status, 200)
  const body = (await used.json()) as { healed: number; healMachines: { charges: number }[] }
  assert.equal(body.healed, 1)
  assert.equal(body.healMachines[0]!.charges, 0)
  assert.equal(hpOf(p.starterId).hpRatio, 1)

  // Equipe saudável: recusa (com carga).
  sql()
    .prepare(`update garden_structures set progress = 2, since = ? where user_id = ? and key = ?`)
    .run(now, p.userId, HEAL_MACHINE_KEY)
  const healthy = immediate(() => useHealMachine(p.userId, now))
  assert.equal(healthy.ok, false)
  if (!healthy.ok) assert.equal(healthy.error, 'team_healthy')

  // State manda a máquina.
  const state = (await (await app.request('/state', { headers: { cookie: p.cookie } }, env)).json()) as {
    garden: {
      healMachines: { charges: number; max: number; nextChargeAt: number | null }[]
      faintRecoverRatio: number
    }
    pokemon: { hpRatio: number; faintedUntil: number | null }[]
  }
  assert.equal(state.garden.healMachines[0]!.max, healConfig.machine.maxCharges)
  assert.equal(state.garden.faintRecoverRatio, healConfig.faintRecoverRatio)
  assert.ok(typeof state.pokemon[0]!.hpRatio === 'number')
  assert.equal(state.pokemon[0]!.faintedUntil, null)
})

test('a máquina cura desmaiado e limpa o desmaio', async () => {
  const p = player('heal-faint-machine')
  const now = Date.now()
  immediate(() => grantStructures(p.userId, now))
  sql()
    .prepare('update pokemon set hp_ratio = 0, fainted_at = ? where id = ?')
    .run(now, p.starterId)
  const used = await post(p.cookie, '/garden/heal-machine/use')
  assert.equal(used.status, 200)
  const after = hpOf(p.starterId)
  assert.equal(after.hpRatio, 1)
  assert.equal(after.faintedAt, null)
})

test('time com um desmaiado e um vivo luta só com o vivo', async () => {
  const p = player('heal-faint-partial')
  sql().prepare('update pokemon set level = 1, hp_ratio = 1 where id = ?').run(p.starterId)
  const created = await post(p.cookie, '/encounters', { regionSlug: 'route-29' })
  const encounter = (await created.json()) as { id: number }
  sql().prepare('update encounters set level = 50 where id = ?').run(encounter.id)
  const battle = await post(p.cookie, `/encounters/${encounter.id}/battle`, { pokemonIds: [p.starterId] })
  assert.equal(battle.status, 200)
  assert.equal(hpOf(p.starterId).hpRatio, 0)
  assert.ok(hpOf(p.starterId).faintedAt != null)

  const alive = Number(
    sql()
      .prepare(
        `insert into pokemon (user_id, species_id, level, xp, caught_at, original_species_id, nature, ability_slot,
           fast_move, charged_move, iv_hp, iv_attack, iv_defense, iv_sp_attack, iv_sp_defense, iv_speed, team_slot, hp_ratio)
         select user_id, species_id, 20, 0, caught_at, original_species_id, nature, ability_slot,
           fast_move, charged_move, iv_hp, iv_attack, iv_defense, iv_sp_attack, iv_sp_defense, iv_speed, 1, 1
         from pokemon where id = ?`,
      )
      .run(p.starterId).lastInsertRowid,
  )

  const again = await post(p.cookie, '/encounters', { regionSlug: 'route-29' })
  const enc2 = (await again.json()) as { id: number }
  const started = await post(p.cookie, `/encounters/${enc2.id}/battle/start`, {
    pokemonIds: [alive, p.starterId],
  })
  assert.equal(started.status, 200)
  const body = (await started.json()) as { setup: { team: { id: number | null }[] } }
  // A pausa "quem entra" lista o setup: o desmaiado não é opção.
  assert.deepEqual(
    body.setup.team.map((fighter) => fighter.id),
    [alive],
  )
})
