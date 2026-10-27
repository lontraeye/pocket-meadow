import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'

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
