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
