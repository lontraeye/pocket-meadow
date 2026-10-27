import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LearnEntry, MoveInfo, SpeciesAbilities } from '../game/traits.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const snapshotsDir = path.resolve(here, '../..', 'snapshots')

export const movesSnapshotPath = path.join(snapshotsDir, 'moves.json')
export const learnsetsSnapshotPath = path.join(snapshotsDir, 'learnsets.json')
export const abilitiesSnapshotPath = path.join(snapshotsDir, 'abilities.json')

export type MovesSnapshot = {
  commit: string
  moves: MoveInfo[]
}

export type LearnsetsSnapshot = {
  commit: string
  /** dex string → lista ordenada por nível, depois nome */
  learnsets: Record<string, LearnEntry[]>
}

export type AbilitiesSnapshot = {
  commit: string
  abilities: Record<string, SpeciesAbilities>
}

let movesCache: Map<string, MoveInfo> | null = null
let learnsetsCache: LearnsetsSnapshot | null = null
let abilitiesCache: AbilitiesSnapshot | null = null

export function readMovesSnapshot(): MovesSnapshot {
  return JSON.parse(fs.readFileSync(movesSnapshotPath, 'utf8')) as MovesSnapshot
}

export function readLearnsetsSnapshot(): LearnsetsSnapshot {
  return JSON.parse(fs.readFileSync(learnsetsSnapshotPath, 'utf8')) as LearnsetsSnapshot
}

export function readAbilitiesSnapshot(): AbilitiesSnapshot {
  return JSON.parse(fs.readFileSync(abilitiesSnapshotPath, 'utf8')) as AbilitiesSnapshot
}

export function writeMovesSnapshot(snapshot: MovesSnapshot): void {
  writeJson(movesSnapshotPath, snapshot)
}

export function writeLearnsetsSnapshot(snapshot: LearnsetsSnapshot): void {
  writeJson(learnsetsSnapshotPath, snapshot)
}

export function writeAbilitiesSnapshot(snapshot: AbilitiesSnapshot): void {
  writeJson(abilitiesSnapshotPath, snapshot)
}

export function movesByName(): Map<string, MoveInfo> {
  if (!movesCache) {
    movesCache = new Map(readMovesSnapshot().moves.map((move) => [move.name, move]))
  }
  return movesCache
}

export function learnsetFor(speciesId: number): LearnEntry[] {
  if (!learnsetsCache) learnsetsCache = readLearnsetsSnapshot()
  return learnsetsCache.learnsets[String(speciesId)] ?? []
}

export function abilitiesFor(speciesId: number): SpeciesAbilities {
  if (!abilitiesCache) abilitiesCache = readAbilitiesSnapshot()
  const row = abilitiesCache.abilities[String(speciesId)]
  if (!row) throw new Error(`abilities missing for species ${speciesId}`)
  return row
}

export function reloadTraitsCaches(): void {
  movesCache = null
  learnsetsCache = null
  abilitiesCache = null
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
