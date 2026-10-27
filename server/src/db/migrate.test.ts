import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { applySpeciesSnapshot, readSpeciesSnapshot } from '../seed/apply.js'
import { backfillPokemonTraits } from './backfillTraits.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const drizzleDir = path.resolve(here, '../..', 'drizzle')

function execMigration(db: Database.Database, file: string): void {
  const sql = fs.readFileSync(path.join(drizzleDir, file), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    const text = statement.trim()
    if (text) db.exec(text)
  }
}

test('a migração de base_experience preserva espécies que já existem', () => {
  const file = path.join(os.tmpdir(), `pocket-meadow-migrate-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = new Database(file)
  execMigration(db, '0000_init.sql')
  execMigration(db, '0001_auth_events.sql')
  execMigration(db, '0002_encounter_fighters.sql')

  db.prepare(
    `insert into users (username, password_hash, created_at) values ('ash', 'hash', 1)`,
  ).run()
  db.prepare(
    `insert into species (
      id, name, display_name, type1, hp, attack, defense, sp_attack, sp_defense, speed,
      base_stat_total, capture_rate, evolution_chain_id, evolution_stage
    ) values (16, 'pidgey', 'Pidgey', 'normal', 40, 45, 40, 35, 35, 56, 251, 255, 10, 1)`,
  ).run()
  db.prepare(
    `insert into pokemon (
      user_id, species_id, level, xp, caught_at, original_species_id
    ) values (1, 16, 3, 0, 1, 16)`,
  ).run()

  execMigration(db, '0003_base_experience.sql')

  const species = db.prepare('select name, display_name, base_experience from species where id = 16').get() as {
    name: string
    display_name: string
    base_experience: number
  }
  const mon = db.prepare('select level from pokemon where species_id = 16').get() as { level: number }
  assert.equal(species.name, 'pidgey')
  assert.equal(species.display_name, 'Pidgey')
  assert.equal(species.base_experience, 0)
  assert.equal(mon.level, 3)
  db.close()
  fs.rmSync(file, { force: true })
})

test('a migração de via_trade preserva evoluções e o snapshot marca a troca', () => {
  const file = path.join(os.tmpdir(), `pocket-meadow-via-trade-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = new Database(file)
  for (const fileName of [
    '0000_init.sql',
    '0001_auth_events.sql',
    '0002_encounter_fighters.sql',
    '0003_base_experience.sql',
  ]) {
    execMigration(db, fileName)
  }

  db.prepare(
    `insert into species (
      id, name, display_name, type1, hp, attack, defense, sp_attack, sp_defense, speed,
      base_stat_total, base_experience, capture_rate, evolution_chain_id, evolution_stage
    ) values
      (93, 'haunter', 'Haunter', 'ghost', 45, 50, 45, 115, 55, 95, 405, 142, 90, 47, 2),
      (94, 'gengar', 'Gengar', 'ghost', 60, 65, 60, 130, 75, 110, 500, 225, 45, 47, 3)`,
  ).run()
  db.prepare(
    `insert into evolutions (from_species_id, to_species_id, min_level, candy_cost)
     values (93, 94, 36, 100)`,
  ).run()

  execMigration(db, '0004_via_trade.sql')

  const before = db
    .prepare('select min_level, via_trade from evolutions where from_species_id = 93 and to_species_id = 94')
    .get() as { min_level: number; via_trade: number }
  assert.equal(before.min_level, 36)
  assert.equal(before.via_trade, 0)

  // Snapshot atual inclui EV yield (0008); aplica só depois das colunas existirem.
  for (const fileName of [
    '0005_daycare_xp_gained.sql',
    '0006_google_login.sql',
    '0007_drop_password.sql',
    '0008_pokemon_traits.sql',
  ]) {
    execMigration(db, fileName)
  }

  applySpeciesSnapshot(db, readSpeciesSnapshot())
  const after = db
    .prepare('select min_level, via_trade from evolutions where from_species_id = 93 and to_species_id = 94')
    .get() as { min_level: number; via_trade: number }
  assert.equal(after.min_level, 36)
  assert.equal(after.via_trade, 1)

  db.close()
  fs.rmSync(file, { force: true })
})
test('a migração de xp_gained preserva slots de daycare que já existem', () => {
  const file = path.join(os.tmpdir(), `pocket-meadow-daycare-xp-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = new Database(file)
  for (const fileName of [
    '0000_init.sql',
    '0001_auth_events.sql',
    '0002_encounter_fighters.sql',
    '0003_base_experience.sql',
    '0004_via_trade.sql',
  ]) {
    execMigration(db, fileName)
  }

  db.prepare(
    `insert into users (username, password_hash, created_at) values ('misty', 'hash', 1)`,
  ).run()
  db.prepare(
    `insert into species (
      id, name, display_name, type1, hp, attack, defense, sp_attack, sp_defense, speed,
      base_stat_total, base_experience, capture_rate, evolution_chain_id, evolution_stage
    ) values (16, 'pidgey', 'Pidgey', 'normal', 40, 45, 40, 35, 35, 56, 251, 50, 255, 10, 1)`,
  ).run()
  db.prepare(
    `insert into pokemon (
      user_id, species_id, level, xp, caught_at, original_species_id, location
    ) values (1, 16, 5, 0, 1, 16, 'daycare')`,
  ).run()
  db.prepare(
    `insert into daycare_slots (user_id, slot_index, pokemon_id, entered_at, last_settled_at)
     values (1, 0, 1, 1000, 1000)`,
  ).run()

  execMigration(db, '0005_daycare_xp_gained.sql')

  const row = db
    .prepare('select pokemon_id, entered_at, xp_gained from daycare_slots where user_id = 1 and slot_index = 0')
    .get() as { pokemon_id: number; entered_at: number; xp_gained: number }
  assert.equal(row.pokemon_id, 1)
  assert.equal(row.entered_at, 1000)
  assert.equal(row.xp_gained, 0)
  db.close()
  fs.rmSync(file, { force: true })
})

test('as migrações do login pelo Google preservam contas e o save', () => {
  const file = path.join(os.tmpdir(), `pocket-meadow-google-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  for (const fileName of [
    '0000_init.sql',
    '0001_auth_events.sql',
    '0002_encounter_fighters.sql',
    '0003_base_experience.sql',
    '0004_via_trade.sql',
    '0005_daycare_xp_gained.sql',
  ]) {
    execMigration(db, fileName)
  }

  db.prepare(`insert into users (username, password_hash, created_at) values ('brock', 'hash', 1)`).run()
  db.prepare(
    `insert into species (
      id, name, display_name, type1, hp, attack, defense, sp_attack, sp_defense, speed,
      base_stat_total, base_experience, capture_rate, evolution_chain_id, evolution_stage
    ) values (74, 'geodude', 'Geodude', 'rock', 40, 80, 100, 30, 30, 20, 300, 60, 255, 31, 1)`,
  ).run()
  db.prepare(
    `insert into pokemon (user_id, species_id, level, xp, caught_at, original_species_id)
     values (1, 74, 12, 40, 1, 74)`,
  ).run()
  db.prepare(`insert into sessions (id, user_id, created_at, expires_at) values ('s', 1, 1, 9999999999999)`).run()

  execMigration(db, '0006_google_login.sql')
  execMigration(db, '0007_drop_password.sql')

  const user = db.prepare('select * from users where id = 1').get() as Record<string, unknown>
  assert.equal(user.username, 'brock')
  assert.equal(user.google_sub, null)
  assert.equal('password_hash' in user, false)
  const mon = db.prepare('select level, xp from pokemon where user_id = 1').get() as { level: number; xp: number }
  assert.deepEqual({ ...mon }, { level: 12, xp: 40 })
  assert.equal((db.prepare('select count(*) as n from sessions').get() as { n: number }).n, 1)

  // google_sub é único quando preenchido; várias contas locais podem ficar sem.
  db.prepare(`update users set google_sub = 'g1' where id = 1`).run()
  db.prepare(`insert into users (username, created_at) values ('misty', 1)`).run()
  db.prepare(`insert into users (username, created_at) values ('erika', 1)`).run()
  assert.throws(() => db.prepare(`insert into users (username, google_sub, created_at) values ('x', 'g1', 1)`).run())
  db.close()
  fs.rmSync(file, { force: true })
})

test('a migração de traços preenche NULL sem alterar nível, XP, shiny, apelido nem favorito', () => {
  const file = path.join(os.tmpdir(), `pocket-meadow-traits-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  for (const fileName of [
    '0000_init.sql',
    '0001_auth_events.sql',
    '0002_encounter_fighters.sql',
    '0003_base_experience.sql',
    '0004_via_trade.sql',
    '0005_daycare_xp_gained.sql',
    '0006_google_login.sql',
    '0007_drop_password.sql',
  ]) {
    execMigration(db, fileName)
  }

  db.prepare(`insert into users (username, created_at) values ('oak', 1)`).run()
  db.prepare(
    `insert into species (
      id, name, display_name, type1, hp, attack, defense, sp_attack, sp_defense, speed,
      base_stat_total, base_experience, capture_rate, evolution_chain_id, evolution_stage
    ) values (1, 'bulbasaur', 'Bulbasaur', 'grass', 45, 49, 49, 65, 65, 45, 318, 64, 45, 1, 1)`,
  ).run()
  db.prepare(
    `insert into pokemon (
      user_id, species_id, level, xp, is_shiny, nickname, is_favorite, caught_at, original_species_id
    ) values (1, 1, 17, 42, 1, 'Leafy', 1, 1, 1)`,
  ).run()

  const before = db
    .prepare(
      `select level, xp, is_shiny, nickname, is_favorite from pokemon where id = 1`,
    )
    .get() as {
    level: number
    xp: number
    is_shiny: number
    nickname: string
    is_favorite: number
  }

  execMigration(db, '0008_pokemon_traits.sql')

  const afterColumns = db
    .prepare(
      `select level, xp, is_shiny, nickname, is_favorite, nature, ability_slot, fast_move, charged_move, iv_hp
       from pokemon where id = 1`,
    )
    .get() as {
    level: number
    xp: number
    is_shiny: number
    nickname: string
    is_favorite: number
    nature: string | null
    ability_slot: string | null
    fast_move: string | null
    charged_move: string | null
    iv_hp: number | null
  }
  assert.deepEqual(
    {
      level: afterColumns.level,
      xp: afterColumns.xp,
      is_shiny: afterColumns.is_shiny,
      nickname: afterColumns.nickname,
      is_favorite: afterColumns.is_favorite,
    },
    before,
  )
  assert.equal(afterColumns.nature, null)
  assert.equal(afterColumns.iv_hp, null)

  // Snapshot mínimo para o backfill (igual ao fluxo de migrate.ts).
  const snapshots = path.resolve(here, '../..', 'snapshots')
  const moves = JSON.parse(fs.readFileSync(path.join(snapshots, 'moves.json'), 'utf8')) as {
    moves: { name: string; displayName: string; type: string; power: number; damageClass: string }[]
  }
  const learnsets = JSON.parse(fs.readFileSync(path.join(snapshots, 'learnsets.json'), 'utf8')) as {
    learnsets: Record<string, { move: string; level: number }[]>
  }
  const abilities = JSON.parse(fs.readFileSync(path.join(snapshots, 'abilities.json'), 'utf8')) as {
    abilities: Record<string, { slot1: string; slot2: string | null; hidden: string | null }>
  }
  assert.ok(learnsets.learnsets['1'])
  assert.ok(abilities.abilities['1'])
  assert.ok(moves.moves.length > 0)

  const filled = backfillPokemonTraits(db)
  assert.equal(filled, 1)

  const after = db
    .prepare(
      `select level, xp, is_shiny, nickname, is_favorite, nature, ability_slot, fast_move, charged_move, iv_hp
       from pokemon where id = 1`,
    )
    .get() as {
    level: number
    xp: number
    is_shiny: number
    nickname: string
    is_favorite: number
    nature: string
    ability_slot: string
    fast_move: string
    charged_move: string
    iv_hp: number
  }
  assert.deepEqual(
    {
      level: after.level,
      xp: after.xp,
      is_shiny: after.is_shiny,
      nickname: after.nickname,
      is_favorite: after.is_favorite,
    },
    before,
  )
  assert.ok(after.nature)
  assert.ok(after.ability_slot)
  assert.ok(after.fast_move)
  assert.ok(Number.isInteger(after.iv_hp))
  // Nv 17: Bulbasaur ainda não tem carregado no pool (Solar Beam no 46).
  assert.equal(after.charged_move, null)

  const filledAgain = backfillPokemonTraits(db)
  assert.equal(filledAgain, 0)

  db.close()
  fs.rmSync(file, { force: true })
})

test('backfill com EVs e só nature NULL mantém EVs e golpes', () => {
  const file = path.join(os.tmpdir(), `pocket-meadow-traits-ev-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  for (const fileName of [
    '0000_init.sql',
    '0001_auth_events.sql',
    '0002_encounter_fighters.sql',
    '0003_base_experience.sql',
    '0004_via_trade.sql',
    '0005_daycare_xp_gained.sql',
    '0006_google_login.sql',
    '0007_drop_password.sql',
    '0008_pokemon_traits.sql',
  ]) {
    execMigration(db, fileName)
  }

  db.prepare(`insert into users (username, created_at) values ('oak', 1)`).run()
  db.prepare(
    `insert into species (
      id, name, display_name, type1, hp, attack, defense, sp_attack, sp_defense, speed,
      base_stat_total, base_experience, capture_rate, evolution_chain_id, evolution_stage
    ) values (4, 'charmander', 'Charmander', 'fire', 39, 52, 43, 60, 50, 65, 309, 62, 45, 2, 1)`,
  ).run()
  db.prepare(
    `insert into pokemon (
      user_id, species_id, level, xp, caught_at, original_species_id,
      iv_hp, iv_attack, iv_defense, iv_sp_attack, iv_sp_defense, iv_speed,
      ev_hp, ev_attack, ev_defense, ev_sp_attack, ev_sp_defense, ev_speed,
      nature, ability_slot, fast_move, charged_move
    ) values (
      1, 4, 20, 10, 1, 4,
      10, 11, 12, 13, 14, 15,
      4, 8, 0, 0, 0, 12,
      null, '1', 'scratch', null
    )`,
  ).run()

  const filled = backfillPokemonTraits(db)
  assert.equal(filled, 1)

  const row = db
    .prepare(
      `select nature, ability_slot, fast_move, charged_move,
              ev_hp, ev_attack, ev_speed, iv_hp
       from pokemon where id = 1`,
    )
    .get() as {
    nature: string
    ability_slot: string
    fast_move: string
    charged_move: string | null
    ev_hp: number
    ev_attack: number
    ev_speed: number
    iv_hp: number
  }
  assert.ok(row.nature)
  assert.equal(row.ability_slot, '1')
  assert.equal(row.fast_move, 'scratch')
  assert.equal(row.charged_move, null)
  assert.equal(row.iv_hp, 10)
  assert.deepEqual(
    { ev_hp: row.ev_hp, ev_attack: row.ev_attack, ev_speed: row.ev_speed },
    { ev_hp: 4, ev_attack: 8, ev_speed: 12 },
  )

  db.close()
  fs.rmSync(file, { force: true })
})

test('a migração battle_started_at preserva encontros e Pokémon existentes', () => {
  const file = path.join(os.tmpdir(), `pocket-meadow-battle-started-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  for (const fileName of [
    '0000_init.sql',
    '0001_auth_events.sql',
    '0002_encounter_fighters.sql',
    '0003_base_experience.sql',
    '0004_via_trade.sql',
    '0005_daycare_xp_gained.sql',
    '0006_google_login.sql',
    '0007_drop_password.sql',
    '0008_pokemon_traits.sql',
  ]) {
    execMigration(db, fileName)
  }

  db.prepare(`insert into users (username, created_at) values ('ash', 1)`).run()
  db.prepare(
    `insert into species (
      id, name, display_name, type1, hp, attack, defense, sp_attack, sp_defense, speed,
      base_stat_total, base_experience, capture_rate, evolution_chain_id, evolution_stage,
      ev_hp, ev_attack, ev_defense, ev_sp_attack, ev_sp_defense, ev_speed
    ) values (16, 'pidgey', 'Pidgey', 'normal', 40, 45, 40, 35, 35, 56, 251, 50, 255, 10, 1, 0, 0, 0, 0, 0, 1)`,
  ).run()
  db.prepare(
    `insert into pokemon (
      user_id, species_id, level, xp, caught_at, original_species_id,
      nature, ability_slot, fast_move, charged_move,
      iv_hp, iv_attack, iv_defense, iv_sp_attack, iv_sp_defense, iv_speed,
      ev_hp, ev_attack, ev_defense, ev_sp_attack, ev_sp_defense, ev_speed
    ) values (
      1, 16, 5, 0, 1, 16,
      'hardy', '1', 'tackle', 'gust',
      15, 15, 15, 15, 15, 15,
      0, 0, 0, 0, 0, 0
    )`,
  ).run()
  db.prepare(
    `insert into encounters (
      user_id, region_slug, species_id, level, is_shiny, rng_seed, status, created_at, expires_at
    ) values (1, 'kanto-route-1', 16, 3, 0, 42, 'pending', 100, 200)`,
  ).run()

  const before = db
    .prepare(`select id, status, rng_seed from encounters where id = 1`)
    .get() as { id: number; status: string; rng_seed: number }

  execMigration(db, '0009_battle_started.sql')

  const after = db
    .prepare(`select id, status, rng_seed, battle_started_at from encounters where id = 1`)
    .get() as {
    id: number
    status: string
    rng_seed: number
    battle_started_at: number | null
  }
  const mon = db.prepare(`select level from pokemon where id = 1`).get() as { level: number }

  assert.deepEqual(
    { id: after.id, status: after.status, rng_seed: after.rng_seed },
    before,
  )
  assert.equal(after.battle_started_at, null)
  assert.equal(mon.level, 5)

  db.prepare(`update encounters set battle_started_at = 150 where id = 1`).run()
  const started = db
    .prepare(`select battle_started_at from encounters where id = 1`)
    .get() as { battle_started_at: number }
  assert.equal(started.battle_started_at, 150)

  execMigration(db, '0010_battle_setup_json.sql')
  const withJson = db
    .prepare(`select battle_started_at, battle_setup_json from encounters where id = 1`)
    .get() as { battle_started_at: number; battle_setup_json: string | null }
  assert.equal(withJson.battle_started_at, 150)
  assert.equal(withJson.battle_setup_json, null)
  db.prepare(`update encounters set battle_setup_json = '{"team":[]}' where id = 1`).run()
  const saved = db
    .prepare(`select battle_setup_json from encounters where id = 1`)
    .get() as { battle_setup_json: string }
  assert.equal(saved.battle_setup_json, '{"team":[]}')

  db.close()
  fs.rmSync(file, { force: true })
})

test('a migração won_at preserva encounters e encounter_fighters', () => {
  const file = path.join(os.tmpdir(), `pocket-meadow-won-at-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  for (const fileName of [
    '0000_init.sql',
    '0001_auth_events.sql',
    '0002_encounter_fighters.sql',
    '0003_base_experience.sql',
    '0004_via_trade.sql',
    '0005_daycare_xp_gained.sql',
    '0006_google_login.sql',
    '0007_drop_password.sql',
    '0008_pokemon_traits.sql',
    '0009_battle_started.sql',
    '0010_battle_setup_json.sql',
  ]) {
    execMigration(db, fileName)
  }

  db.prepare(`insert into users (username, created_at) values ('ash', 1)`).run()
  db.prepare(
    `insert into species (
      id, name, display_name, type1, hp, attack, defense, sp_attack, sp_defense, speed,
      base_stat_total, base_experience, capture_rate, evolution_chain_id, evolution_stage,
      ev_hp, ev_attack, ev_defense, ev_sp_attack, ev_sp_defense, ev_speed
    ) values (16, 'pidgey', 'Pidgey', 'normal', 40, 45, 40, 35, 35, 56, 251, 50, 255, 10, 1, 0, 0, 0, 0, 0, 1)`,
  ).run()
  db.prepare(
    `insert into pokemon (
      user_id, species_id, level, xp, caught_at, original_species_id,
      nature, ability_slot, fast_move, charged_move,
      iv_hp, iv_attack, iv_defense, iv_sp_attack, iv_sp_defense, iv_speed,
      ev_hp, ev_attack, ev_defense, ev_sp_attack, ev_sp_defense, ev_speed
    ) values (
      1, 16, 5, 0, 1, 16,
      'hardy', '1', 'tackle', 'gust',
      15, 15, 15, 15, 15, 15,
      0, 0, 0, 0, 0, 0
    )`,
  ).run()
  db.prepare(
    `insert into encounters (
      user_id, region_slug, species_id, level, is_shiny, rng_seed, status, created_at, expires_at
    ) values (1, 'kanto-route-1', 16, 3, 0, 42, 'pending', 100, 200)`,
  ).run()
  db.prepare(
    `insert into encounter_fighters (encounter_id, slot, pokemon_id, power) values (1, 0, 1, 12.5)`,
  ).run()
  db.prepare(
    `insert into encounter_fighters (encounter_id, slot, pokemon_id, power) values (1, 1, null, 9)`,
  ).run()

  const fightersBefore = db
    .prepare(`select encounter_id, slot, pokemon_id, power from encounter_fighters order by slot`)
    .all() as { encounter_id: number; slot: number; pokemon_id: number | null; power: number }[]
  assert.equal(fightersBefore.length, 2)

  execMigration(db, '0011_won_at.sql')

  const fightersAfter = db
    .prepare(`select encounter_id, slot, pokemon_id, power from encounter_fighters order by slot`)
    .all() as { encounter_id: number; slot: number; pokemon_id: number | null; power: number }[]
  assert.deepEqual(fightersAfter, fightersBefore)

  const row = db
    .prepare(`select won_at, throw_count, status from encounters where id = 1`)
    .get() as { won_at: number | null; throw_count: number; status: string }
  assert.equal(row.won_at, null)
  assert.equal(row.throw_count, 0)
  assert.equal(row.status, 'pending')

  db.prepare(`update encounters set won_at = 150, throw_count = 2 where id = 1`).run()
  const updated = db
    .prepare(`select won_at, throw_count from encounters where id = 1`)
    .get() as { won_at: number; throw_count: number }
  assert.equal(updated.won_at, 150)
  assert.equal(updated.throw_count, 2)
  assert.equal(
    (
      db.prepare(`select count(*) as n from encounter_fighters`).get() as { n: number }
    ).n,
    2,
  )

  db.close()
  fs.rmSync(file, { force: true })
})

test('a migração battle_auto preserva trainers, pokemon e encounter_fighters', () => {
  const file = path.join(os.tmpdir(), `pocket-meadow-battle-auto-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  for (const fileName of [
    '0000_init.sql',
    '0001_auth_events.sql',
    '0002_encounter_fighters.sql',
    '0003_base_experience.sql',
    '0004_via_trade.sql',
    '0005_daycare_xp_gained.sql',
    '0006_google_login.sql',
    '0007_drop_password.sql',
    '0008_pokemon_traits.sql',
    '0009_battle_started.sql',
    '0010_battle_setup_json.sql',
    '0011_won_at.sql',
  ]) {
    execMigration(db, fileName)
  }

  db.prepare(`insert into users (username, created_at) values ('ash', 1)`).run()
  db.prepare(
    `insert into trainers (
      user_id, level, xp, energy, energy_updated_at, updated_at
    ) values (1, 3, 10, 8, 100, 100)`,
  ).run()
  db.prepare(
    `insert into species (
      id, name, display_name, type1, hp, attack, defense, sp_attack, sp_defense, speed,
      base_stat_total, base_experience, capture_rate, evolution_chain_id, evolution_stage,
      ev_hp, ev_attack, ev_defense, ev_sp_attack, ev_sp_defense, ev_speed
    ) values (16, 'pidgey', 'Pidgey', 'normal', 40, 45, 40, 35, 35, 56, 251, 50, 255, 10, 1, 0, 0, 0, 0, 0, 1)`,
  ).run()
  db.prepare(
    `insert into pokemon (
      user_id, species_id, level, xp, caught_at, original_species_id,
      nature, ability_slot, fast_move, charged_move,
      iv_hp, iv_attack, iv_defense, iv_sp_attack, iv_sp_defense, iv_speed,
      ev_hp, ev_attack, ev_defense, ev_sp_attack, ev_sp_defense, ev_speed
    ) values (
      1, 16, 5, 0, 1, 16,
      'hardy', '1', 'tackle', 'gust',
      15, 15, 15, 15, 15, 15,
      0, 0, 0, 0, 0, 0
    )`,
  ).run()
  db.prepare(
    `insert into encounters (
      user_id, region_slug, species_id, level, is_shiny, rng_seed, status, created_at, expires_at
    ) values (1, 'kanto-route-1', 16, 3, 0, 42, 'pending', 100, 200)`,
  ).run()
  db.prepare(
    `insert into encounter_fighters (encounter_id, slot, pokemon_id, power) values (1, 0, 1, 12.5)`,
  ).run()

  const before = {
    trainer: db.prepare(`select level, energy from trainers where user_id = 1`).get() as {
      level: number
      energy: number
    },
    pokemon: (db.prepare(`select count(*) as n from pokemon`).get() as { n: number }).n,
    encounters: (db.prepare(`select count(*) as n from encounters`).get() as { n: number }).n,
    fighters: (db.prepare(`select count(*) as n from encounter_fighters`).get() as { n: number }).n,
  }

  execMigration(db, '0012_battle_auto.sql')

  const after = db
    .prepare(`select level, energy, battle_auto from trainers where user_id = 1`)
    .get() as { level: number; energy: number; battle_auto: number }
  assert.equal(after.level, before.trainer.level)
  assert.equal(after.energy, before.trainer.energy)
  assert.equal(after.battle_auto, 0)
  assert.equal((db.prepare(`select count(*) as n from pokemon`).get() as { n: number }).n, before.pokemon)
  assert.equal(
    (db.prepare(`select count(*) as n from encounters`).get() as { n: number }).n,
    before.encounters,
  )
  assert.equal(
    (db.prepare(`select count(*) as n from encounter_fighters`).get() as { n: number }).n,
    before.fighters,
  )

  db.prepare(`update trainers set battle_auto = 1 where user_id = 1`).run()
  assert.equal(
    (
      db.prepare(`select battle_auto from trainers where user_id = 1`).get() as {
        battle_auto: number
      }
    ).battle_auto,
    1,
  )

  db.close()
  fs.rmSync(file, { force: true })
})
