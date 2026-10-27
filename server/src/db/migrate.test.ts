import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { applySpeciesSnapshot, readSpeciesSnapshot } from '../seed/apply.js'

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
