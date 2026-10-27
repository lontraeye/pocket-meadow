import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { backupConfig, backupDatabase, backupDir, pendingMigrations, restoreDatabase } from './backup.js'
import { openDatabase } from './client.js'
import { migrateDatabase } from './migrate.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = path.resolve(here, '../..', 'drizzle')

let dir: string
const previousPath = process.env.DATABASE_PATH

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-backup-'))
  process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
})

afterEach(() => {
  if (previousPath === undefined) delete process.env.DATABASE_PATH
  else process.env.DATABASE_PATH = previousPath
  fs.rmSync(dir, { recursive: true, force: true })
})

function backups(prefix: string): string[] {
  const where = backupDir()
  if (!fs.existsSync(where)) return []
  return fs.readdirSync(where).filter((name) => name.startsWith(`${prefix}-`)).sort()
}

function addUser(username: string): void {
  const db = openDatabase()
  db.prepare(`insert into users (username, password_hash, created_at) values (?, 'hash', 1)`).run(username)
  db.close()
}

function usernames(file = process.env.DATABASE_PATH as string): string[] {
  const db = new Database(file, { readonly: true })
  const rows = db.prepare('select username from users order by id').all() as { username: string }[]
  db.close()
  return rows.map((row) => row.username)
}

describe('backup', () => {
  test('a cópia tem os dados, inclusive os que ainda estão só no WAL', () => {
    migrateDatabase()
    const db = openDatabase()
    db.prepare(`insert into users (username, password_hash, created_at) values ('ash', 'hash', 1)`).run()
    const file = backupDatabase(db, 'daily')
    db.close()
    assert.deepEqual(usernames(file), ['ash'])
  })

  test('guarda só as últimas cópias de cada tipo', () => {
    migrateDatabase()
    const db = openDatabase()
    const keep = backupConfig.keep.daily
    for (let day = 1; day <= keep + 3; day += 1) {
      backupDatabase(db, 'daily', new Date(Date.UTC(2026, 0, day)))
    }
    backupDatabase(db, 'pre-migrate', new Date(Date.UTC(2026, 0, 1)))
    db.close()
    const daily = backups('daily')
    assert.equal(daily.length, keep)
    assert.ok(daily[0]?.startsWith('daily-2026-01-04'))
    assert.equal(backups('pre-migrate').length, 1)
  })
})

describe('migração', () => {
  test('banco vazio: tudo pendente e nenhum backup', () => {
    const db = openDatabase()
    assert.ok(pendingMigrations(db, migrationsFolder).length > 0)
    db.close()
    migrateDatabase()
    assert.deepEqual(backups('pre-migrate'), [])
  })

  test('banco em dia: nada pendente e nenhum backup', () => {
    migrateDatabase()
    addUser('ash')
    migrateDatabase()
    const db = openDatabase()
    assert.deepEqual(pendingMigrations(db, migrationsFolder), [])
    db.close()
    assert.deepEqual(backups('pre-migrate'), [])
  })

  test('com migração pendente e dados, copia antes de aplicar', () => {
    migrateDatabase()
    addUser('ash')
    // Finge que a última migração ainda não rodou.
    const db = openDatabase()
    db.prepare('delete from __drizzle_migrations where created_at = (select max(created_at) from __drizzle_migrations)').run()
    const pending = pendingMigrations(db, migrationsFolder)
    db.close()
    assert.equal(pending.length, 1)

    // A última migração adiciona uma coluna; desfazer isso não é o ponto aqui,
    // então a migração vai falhar ao recriar a coluna. O backup tem que existir
    // mesmo assim, e é justamente para isso que ele serve.
    assert.throws(() => migrateDatabase())
    const copies = backups('pre-migrate')
    assert.equal(copies.length, 1)
    assert.deepEqual(usernames(path.join(backupDir(), copies[0] as string)), ['ash'])
  })
})

describe('restore', () => {
  test('volta ao backup e guarda o banco que estava antes', () => {
    migrateDatabase()
    addUser('ash')
    const db = openDatabase()
    const file = backupDatabase(db, 'daily')
    db.close()
    addUser('gary')
    assert.deepEqual(usernames(), ['ash', 'gary'])

    const result = restoreDatabase(file)
    assert.deepEqual(usernames(), ['ash'])
    assert.ok(result.previous)
    assert.deepEqual(usernames(result.previous), ['ash', 'gary'])
  })

  test('recusa um arquivo que não é um banco', () => {
    migrateDatabase()
    addUser('ash')
    const junk = path.join(dir, 'junk.sqlite')
    fs.writeFileSync(junk, 'not a database')
    assert.throws(() => restoreDatabase(junk))
    assert.deepEqual(usernames(), ['ash'])
  })
})
