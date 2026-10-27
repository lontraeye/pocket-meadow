import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { applySpeciesSnapshot, readSpeciesSnapshot } from '../seed/apply.js'
import { backupDatabase, isEmptyDatabase, pendingMigrations } from './backup.js'
import { createDb, openDatabase } from './client.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export function migrateDatabase(): void {
  const sqlite = openDatabase()
  try {
    const migrationsFolder = path.resolve(here, '../..', 'drizzle')
    // Migração com erro não pode levar o save junto: copia antes de aplicar.
    const pending = pendingMigrations(sqlite, migrationsFolder)
    if (pending.length > 0 && !isEmptyDatabase(sqlite)) {
      const file = backupDatabase(sqlite, 'pre-migrate')
      console.log(`backup before migrating (${pending.join(', ')}): ${file}`)
    }
    migrate(createDb(sqlite), { migrationsFolder })
    applySpeciesSnapshot(sqlite, readSpeciesSnapshot())
    const blank = sqlite.prepare('select id from species where base_experience = 0 limit 1').get() as { id: number } | undefined
    if (blank) {
      throw new Error(`species ${blank.id} has base_experience 0; run npm run db:seed`)
    }
  } finally {
    sqlite.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrateDatabase()
}
