import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export function databasePath(): string {
  return process.env.DATABASE_PATH ?? path.resolve(here, '../../..', 'data', 'meadow.sqlite')
}

export function openDatabase(): Database.Database {
  const file = databasePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return sqlite
}

export function createDb(sqlite: Database.Database = openDatabase()) {
  return drizzle(sqlite, { schema })
}

let sqlite: Database.Database | undefined
let database: ReturnType<typeof createDb> | undefined

export function getSqlite(): Database.Database {
  if (!sqlite) sqlite = openDatabase()
  return sqlite
}

export function getDb() {
  if (!database) database = createDb(getSqlite())
  return database
}

export function immediate<T>(fn: () => T): T {
  const connection = getSqlite()
  connection.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    connection.exec('COMMIT')
    return result
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  }
}
