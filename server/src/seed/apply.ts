import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { eq, inArray, or } from 'drizzle-orm'
import { createDb } from '../db/client.js'
import { evolutions, species } from '../db/schema.js'
import type { EvolutionRow, SpeciesRow } from './parse.js'

export type SpeciesSnapshot = {
  species: SpeciesRow[]
  evolutions: EvolutionRow[]
}

const here = path.dirname(fileURLToPath(import.meta.url))

// Versionado no git e copiado para a imagem, para que um banco novo
// tenha as espécies sem acessar a PokéAPI.
export const snapshotPath = path.resolve(here, '../..', 'snapshots', 'species.json')

export function readSpeciesSnapshot(): SpeciesSnapshot {
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as SpeciesSnapshot
}

export function writeSpeciesSnapshot(snapshot: SpeciesSnapshot): void {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true })
  // Uma linha por registro, para o diff mostrar só a espécie que mudou.
  const rows = (list: object[]) => list.map((row) => `  ${JSON.stringify(row)}`).join(',\n')
  fs.writeFileSync(
    snapshotPath,
    `{\n "species": [\n${rows(snapshot.species)}\n ],\n "evolutions": [\n${rows(snapshot.evolutions)}\n ]\n}\n`,
  )
}

// Idempotente: pode rodar a cada boot.
export function applySpeciesSnapshot(sqlite: Database.Database, snapshot: SpeciesSnapshot): void {
  const db = createDb(sqlite)
  const ids = snapshot.species.map((row) => row.id)

  const write = sqlite.transaction(() => {
    for (const row of snapshot.species) {
      db.insert(species)
        .values({ ...row, evolvesFromId: null })
        .onConflictDoUpdate({
          target: species.id,
          set: { ...row, evolvesFromId: null },
        })
        .run()
    }

    for (const row of snapshot.species) {
      if (row.evolvesFromId === null) continue
      db.update(species).set({ evolvesFromId: row.evolvesFromId }).where(eq(species.id, row.id)).run()
    }

    db.delete(evolutions)
      .where(or(inArray(evolutions.fromSpeciesId, ids), inArray(evolutions.toSpeciesId, ids)))
      .run()

    if (snapshot.evolutions.length > 0) {
      db.insert(evolutions).values(snapshot.evolutions).run()
    }
  })

  write.immediate()
}
