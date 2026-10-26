import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createDb, openDatabase } from './client.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export function migrateDatabase(): void {
  const sqlite = openDatabase()
  migrate(createDb(sqlite), {
    migrationsFolder: path.resolve(here, '../..', 'drizzle'),
  })
  sqlite.close()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrateDatabase()
}
