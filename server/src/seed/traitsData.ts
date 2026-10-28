import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LearnEntry, MoveInfo, SpeciesAbilities } from '../game/traits.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const snapshotsDir = path.resolve(here, '../..', 'snapshots')

export const movesSnapshotPath = path.join(snapshotsDir, 'moves.json')
export const learnsetsSnapshotPath = path.join(snapshotsDir, 'learnsets.json')
export const abilitiesSnapshotPath = path.join(snapshotsDir, 'abilities.json')
const speciesSnapshotPath = path.join(snapshotsDir, 'species.json')

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
let evolvesFromCache: Map<number, number | null> | null = null
const lineLearnsets = new Map<number, LearnEntry[]>()

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

/**
 * Pool de golpes da espécie **e das pré-evoluções** (PLANNING.md, seção 5.18):
 * evoluir nunca tira o golpe que a linha já ensinava, e uma Ninetales sorteia
 * também entre os golpes da Vulpix. Cada golpe guarda o menor nível em que
 * alguém da linha o aprende; o nível do Pokémon continua limitando o sorteio.
 */
export function learnsetFor(speciesId: number): LearnEntry[] {
  const cached = lineLearnsets.get(speciesId)
  if (cached) return cached
  const firstLevel = new Map<string, number>()
  for (const id of evolutionLine(speciesId)) {
    for (const entry of speciesLearnset(id)) {
      const known = firstLevel.get(entry.move)
      if (known === undefined || entry.level < known) firstLevel.set(entry.move, entry.level)
    }
  }
  const merged = [...firstLevel]
    .map(([move, level]) => ({ move, level }))
    .sort((a, b) => a.level - b.level || a.move.localeCompare(b.move))
  lineLearnsets.set(speciesId, merged)
  return merged
}

/** Só a espécie, como no snapshot (lista por nível; pode repetir golpe). */
export function speciesLearnset(speciesId: number): LearnEntry[] {
  if (!learnsetsCache) learnsetsCache = readLearnsetsSnapshot()
  return learnsetsCache.learnsets[String(speciesId)] ?? []
}

/** A espécie e as pré-evoluções, da própria para a mais básica. */
function evolutionLine(speciesId: number): number[] {
  if (!evolvesFromCache) {
    const snapshot = JSON.parse(fs.readFileSync(speciesSnapshotPath, 'utf8')) as {
      species: { id: number; evolvesFromId: number | null }[]
    }
    evolvesFromCache = new Map(snapshot.species.map((row) => [row.id, row.evolvesFromId]))
  }
  const line: number[] = []
  let current: number | null | undefined = speciesId
  while (current != null && !line.includes(current)) {
    line.push(current)
    current = evolvesFromCache.get(current)
  }
  return line
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
  evolvesFromCache = null
  lineLearnsets.clear()
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
