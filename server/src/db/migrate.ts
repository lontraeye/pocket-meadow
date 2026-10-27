import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { applySpeciesSnapshot, readSpeciesSnapshot } from '../seed/apply.js'
import { createDb, openDatabase } from './client.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export function migrateDatabase(): void {
  const sqlite = openDatabase()
  migrate(createDb(sqlite), {
    migrationsFolder: path.resolve(here, '../..', 'drizzle'),
  })
  applySpeciesSnapshot(sqlite, readSpeciesSnapshot())
  const blank = sqlite.prepare('select id from species where base_experience = 0 limit 1').get() as { id: number } | undefined
  if (blank) {
    throw new Error(`species ${blank.id} has base_experience 0; run npm run db:seed`)
  }
  sqlite.close()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrateDatabase()
}
