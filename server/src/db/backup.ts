import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { databasePath, openDatabase } from './client.js'

// Backups do SQLite (PLANNING.md, seção 4.6). Sempre por VACUUM INTO: copiar o
// arquivo com o servidor rodando pode pegar o WAL pela metade.

export const backupConfig = {
  // Cópias por prefixo: as diárias cobrem duas semanas; as de antes de migrar
  // e de antes de restaurar só precisam das últimas.
  keep: { daily: 14, 'pre-migrate': 5, 'pre-restore': 5 },
} as const

export type BackupKind = keyof typeof backupConfig.keep

export function backupDir(): string {
  return path.join(path.dirname(databasePath()), 'backups')
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

/** Copia o banco aberto para `kind-<data>.sqlite`, confere a cópia e apaga as antigas. */
export function backupDatabase(sqlite: Database.Database, kind: BackupKind, now = new Date()): string {
  const dir = backupDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${kind}-${stamp(now)}.sqlite`)
  sqlite.prepare('VACUUM INTO ?').run(file)
  checkIntegrity(file)
  prune(dir, kind, backupConfig.keep[kind])
  return file
}

export function checkIntegrity(file: string): void {
  const copy = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const result = copy.pragma('integrity_check', { simple: true })
    if (result !== 'ok') throw new Error(`backup ${file} failed integrity_check: ${String(result)}`)
  } finally {
    copy.close()
  }
}

function prune(dir: string, kind: BackupKind, keep: number): void {
  // O carimbo ISO ordena por data na ordem alfabética.
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${kind}-`) && name.endsWith('.sqlite'))
    .sort()
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    fs.rmSync(path.join(dir, name), { force: true })
  }
}

/**
 * Migrações do journal que o Drizzle ainda vai aplicar: as com `when` depois do
 * último `created_at` gravado, que é a mesma regra do migrator.
 */
export function pendingMigrations(sqlite: Database.Database, migrationsFolder: string): string[] {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[]
  }
  const table = sqlite
    .prepare(`select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'`)
    .get()
  const last = table
    ? (sqlite.prepare('select max(created_at) as at from __drizzle_migrations').get() as { at: number | null }).at
    : null
  return journal.entries.filter((entry) => last === null || entry.when > last).map((entry) => entry.tag)
}

/** Banco sem nenhuma tabela de jogo: nada a proteger antes de migrar. */
export function isEmptyDatabase(sqlite: Database.Database): boolean {
  const row = sqlite.prepare(`select name from sqlite_master where type = 'table' and name = 'users'`).get()
  return row === undefined
}

/**
 * Troca o banco por um backup. Só com o servidor parado: guarda o atual como
 * pre-restore, confere o backup e apaga o WAL velho para ele não ser reaplicado.
 */
export function restoreDatabase(from: string): { restored: string; previous: string | null } {
  checkIntegrity(from)
  const target = databasePath()
  let previous: string | null = null
  if (fs.existsSync(target)) {
    const current = openDatabase()
    try {
      previous = backupDatabase(current, 'pre-restore')
    } finally {
      current.close()
    }
  }
  const staging = `${target}.restoring`
  fs.copyFileSync(from, staging)
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${target}${suffix}`, { force: true })
  fs.renameSync(staging, target)
  return { restored: target, previous }
}

// node dist/db/backup.js            → backup diário
// node dist/db/backup.js restore F  → restaura F (servidor parado)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, file] = process.argv.slice(2)
  if (command === 'restore') {
    if (!file) throw new Error('usage: backup.js restore <file>')
    const result = restoreDatabase(path.resolve(file))
    console.log(`restored ${file} → ${result.restored}`)
    if (result.previous) console.log(`previous database kept at ${result.previous}`)
  } else if (command === undefined) {
    const sqlite = openDatabase()
    try {
      console.log(`backup written: ${backupDatabase(sqlite, 'daily')}`)
    } finally {
      sqlite.close()
    }
  } else {
    throw new Error(`unknown command: ${command}`)
  }
}
