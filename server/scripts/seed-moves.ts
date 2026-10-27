import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiData } from '../src/config/apiData.js'
import { speciesSeed } from '../src/config/seed.js'
import { fallbackFastMove, learnVersionGroupsForDebut } from '../src/config/traits.js'
import { openDatabase } from '../src/db/client.js'
import { applySpeciesSnapshot, readSpeciesSnapshot, writeSpeciesSnapshot } from '../src/seed/apply.js'
import { idFromUrl } from '../src/seed/pokeapi.js'
import {
  writeAbilitiesSnapshot,
  writeLearnsetsSnapshot,
  writeMovesSnapshot,
  type AbilitiesSnapshot,
  type LearnsetsSnapshot,
  type MovesSnapshot,
} from '../src/seed/traitsData.js'
import type {
  LearnEntry,
  MoveAilmentName,
  MoveInfo,
  MoveStatChange,
  SpeciesAbilities,
} from '../src/game/traits.js'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pokeCache = path.join(serverRoot, speciesSeed.cacheDir)
const apiCache = path.join(serverRoot, apiData.cacheDir)

type PokemonCache = {
  id: number
  moves: {
    move: { name: string; url: string }
    version_group_details: {
      level_learned_at: number
      version_group: { name: string }
      move_learn_method: { name: string }
    }[]
  }[]
  abilities: { is_hidden: boolean; slot: number; ability: { name: string } }[]
  stats: { effort: number; base_stat: number; stat: { name: string } }[]
}

type SpeciesCache = {
  id: number
  generation: { name: string; url: string }
}

type MovePayload = {
  name: string
  power: number | null
  type: { name: string }
  damage_class: { name: string }
  names: { name: string; language: { name: string } }[]
  effect_entries: { effect: string; short_effect: string; language: { name: string } }[]
  meta: {
    ailment: { name: string }
    category: { name: string }
    drain: number
    crit_rate: number
    ailment_chance: number
    stat_chance: number
  } | null
  stat_changes: { change: number; stat: { name: string } }[]
}

async function main(): Promise<void> {
  const learnsets: Record<string, LearnEntry[]> = {}
  const abilities: Record<string, SpeciesAbilities> = {}
  const moveIds = new Map<string, number>()
  const effortBySpecies = new Map<number, Record<string, number>>()

  for (let id = speciesSeed.firstId; id <= speciesSeed.lastId; id += 1) {
    const file = path.join(pokeCache, `pokemon_${id}.json`)
    if (!fs.existsSync(file)) {
      throw new Error(`missing ${file}; run npm run db:seed first to fill the pokeapi cache`)
    }
    const pokemon = JSON.parse(fs.readFileSync(file, 'utf8')) as PokemonCache
    const debut = debutGeneration(id)
    const versions = new Set(learnVersionGroupsForDebut(debut))
    learnsets[String(id)] = parseLearnset(pokemon, versions, moveIds)
    abilities[String(id)] = parseAbilities(pokemon)
    effortBySpecies.set(id, parseEffort(pokemon))
    if ((id - speciesSeed.firstId + 1) % 50 === 0) {
      console.log(`parsed ${id - speciesSeed.firstId + 1} learnsets`)
    }
  }

  if (!moveIds.has(fallbackFastMove.name)) {
    moveIds.set(fallbackFastMove.name, fallbackFastMove.id)
  }

  const moves: MoveInfo[] = []
  const kept = new Set<string>()
  const sortedNames = [...moveIds.keys()].sort()
  for (const name of sortedNames) {
    const id = moveIds.get(name)!
    const payload = await getMove(id)
    const parsed = toMoveInfo(payload)
    if (!parsed) continue
    moves.push(parsed)
    kept.add(parsed.name)
  }

  for (const [dex, list] of Object.entries(learnsets)) {
    learnsets[dex] = list.filter((entry) => kept.has(entry.move))
  }

  const movesSnap: MovesSnapshot = { commit: apiData.commit, moves }
  const learnSnap: LearnsetsSnapshot = { commit: apiData.commit, learnsets }
  const abilitySnap: AbilitiesSnapshot = { commit: apiData.commit, abilities }
  writeMovesSnapshot(movesSnap)
  writeLearnsetsSnapshot(learnSnap)
  writeAbilitiesSnapshot(abilitySnap)

  const speciesSnap = readSpeciesSnapshot()
  for (const row of speciesSnap.species) {
    const effort = effortBySpecies.get(row.id)
    if (!effort) continue
    Object.assign(row, {
      evHp: effort.hp ?? 0,
      evAttack: effort.attack ?? 0,
      evDefense: effort.defense ?? 0,
      evSpAttack: effort['special-attack'] ?? 0,
      evSpDefense: effort['special-defense'] ?? 0,
      evSpeed: effort.speed ?? 0,
    })
  }
  writeSpeciesSnapshot(speciesSnap)
  const sqlite = openDatabase()
  applySpeciesSnapshot(sqlite, speciesSnap)
  sqlite.close()

  console.log(
    `moves seed: ${moves.length} moves, ${Object.keys(learnsets).length} learnsets, ${Object.keys(abilities).length} abilities`,
  )
}

function debutGeneration(speciesId: number): number {
  const file = path.join(pokeCache, `pokemon-species_${speciesId}.json`)
  if (!fs.existsSync(file)) {
    throw new Error(`missing ${file}; run npm run db:seed first to fill the pokeapi cache`)
  }
  const species = JSON.parse(fs.readFileSync(file, 'utf8')) as SpeciesCache
  const fromUrl = species.generation.url.match(/\/generation\/(\d+)\/?$/)
  if (fromUrl) return Number(fromUrl[1])
  throw new Error(`species ${speciesId} has no generation id`)
}

function parseLearnset(
  pokemon: PokemonCache,
  versions: Set<string>,
  moveIds: Map<string, number>,
): LearnEntry[] {
  const best = new Map<string, number>()
  for (const entry of pokemon.moves) {
    const name = entry.move.name
    let minLevel = Infinity
    for (const detail of entry.version_group_details) {
      if (!versions.has(detail.version_group.name)) continue
      if (detail.move_learn_method.name !== 'level-up') continue
      if (detail.level_learned_at <= 0) continue
      minLevel = Math.min(minLevel, detail.level_learned_at)
    }
    if (!Number.isFinite(minLevel)) continue
    const prev = best.get(name)
    if (prev === undefined || minLevel < prev) best.set(name, minLevel)
    moveIds.set(name, idFromUrl(entry.move.url))
  }
  return [...best.entries()]
    .map(([move, level]) => ({ move, level }))
    .sort((a, b) => a.level - b.level || a.move.localeCompare(b.move))
}

function parseAbilities(pokemon: PokemonCache): SpeciesAbilities {
  let slot1: string | null = null
  let slot2: string | null = null
  let hidden: string | null = null
  for (const entry of pokemon.abilities) {
    if (entry.is_hidden || entry.slot === 3) {
      hidden = entry.ability.name
      continue
    }
    if (entry.slot === 1) slot1 = entry.ability.name
    if (entry.slot === 2) slot2 = entry.ability.name
  }
  if (!slot1) throw new Error(`species ${pokemon.id} has no ability slot 1`)
  return { slot1, slot2, hidden }
}

function parseEffort(pokemon: PokemonCache): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of pokemon.stats) out[row.stat.name] = row.effort
  return out
}

const AILMENTS = new Set<MoveAilmentName>([
  'burn',
  'poison',
  'paralysis',
  'sleep',
  'freeze',
  'confusion',
])

const STAT_MAP: Record<string, MoveStatChange['stat']> = {
  attack: 'attack',
  defense: 'defense',
  'special-attack': 'spAttack',
  'special-defense': 'spDefense',
  speed: 'speed',
}

function toMoveInfo(payload: MovePayload): MoveInfo | null {
  // Sem power = status ou dano fixo. User faints = Self-Destruct etc.
  if (payload.power === null || payload.power <= 0) return null
  if (payload.damage_class.name === 'status') return null
  if (moveCausesUserFaint(payload)) return null
  const displayName = payload.names.find((row) => row.language.name === 'en')?.name
  if (!displayName) throw new Error(`move ${payload.name} has no English name`)
  if (payload.damage_class.name !== 'physical' && payload.damage_class.name !== 'special') {
    return null
  }
  const meta = payload.meta
  const ailmentRaw = meta?.ailment.name ?? 'none'
  const ailment =
    ailmentRaw !== 'none' && AILMENTS.has(ailmentRaw as MoveAilmentName)
      ? (ailmentRaw as MoveAilmentName)
      : null
  const statChanges: MoveStatChange[] = []
  for (const row of payload.stat_changes ?? []) {
    const stat = STAT_MAP[row.stat.name]
    if (!stat || row.change === 0) continue
    statChanges.push({ stat, stages: row.change })
  }
  return {
    name: payload.name,
    displayName,
    type: payload.type.name,
    power: payload.power,
    damageClass: payload.damage_class.name,
    ailment,
    ailmentChance: meta?.ailment_chance ?? 0,
    statChanges,
    statChance: meta?.stat_chance ?? 0,
    statOnSelf: meta?.category.name === 'damage-raise',
    drain: meta?.drain ?? 0,
    critRate: meta?.crit_rate ?? 0,
  }
}

function moveCausesUserFaint(payload: MovePayload): boolean {
  const entry = payload.effect_entries.find((row) => row.language.name === 'en')
  if (!entry) return false
  const text = `${entry.short_effect}\n${entry.effect}`.toLowerCase()
  return text.includes('user faints')
}

async function getMove(id: number): Promise<MovePayload> {
  const file = path.join(apiCache, 'move', `${id}.json`)
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) as MovePayload
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const url = `${apiData.rawBase}/move/${id}/index.json`
  let lastError: unknown
  for (let attempt = 1; attempt <= apiData.maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'pocket-meadow-seed' } })
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      const text = await response.text()
      fs.writeFileSync(file, text)
      await wait(apiData.requestDelayMs)
      return JSON.parse(text) as MovePayload
    } catch (error) {
      lastError = error
      await wait(apiData.requestDelayMs * attempt)
    }
  }
  throw lastError
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

await main()
