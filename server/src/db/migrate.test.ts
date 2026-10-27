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
