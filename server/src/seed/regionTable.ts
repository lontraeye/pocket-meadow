import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { speciesSeed } from '../config/seed.js'
import { idFromUrl } from './pokeapi.js'

// Pesos publicados somam 100 com 1 casa (PLANNING.md, seção 5.3).
const WEIGHT_TENTHS = 1000
const PERIODS = ['time-morning', 'time-day', 'time-night'] as const

type Period = (typeof PERIODS)[number]

export type RegionSlot = {
  speciesId: number
  minLevel: number
  maxLevel: number
  weight: number
}

export type RegionSource = {
  area: string
  version: string
}

/** Métodos fora do mato (JORNADA.md, seção 4): cada um com a tabela dele. */
export const FIELD_METHODS = ['oldRod', 'goodRod', 'superRod', 'surf', 'headbutt', 'rockSmash'] as const
export type FieldMethod = (typeof FIELD_METHODS)[number]

/** Nomes da PokéAPI de cada método; o Headbutt junta as árvores comuns e raras. */
const API_METHODS: Readonly<Record<'walk' | FieldMethod, readonly string[]>> = {
  walk: ['walk'],
  oldRod: ['old-rod'],
  goodRod: ['good-rod'],
  superRod: ['super-rod'],
  surf: ['surf'],
  headbutt: ['headbutt-low', 'headbutt-normal', 'headbutt-high'],
  rockSmash: ['rock-smash'],
}

export type RegionSnapshotEntry = {
  sources: RegionSource[]
  /** Mato; vazio em lugar só de água. */
  slots: RegionSlot[]
  methods?: Partial<Record<FieldMethod, RegionSlot[]>>
}

export type RegionsSnapshot = Record<string, RegionSnapshotEntry>

export type LocationArea = {
  pokemon_encounters: {
    pokemon: { name: string; url: string }
    version_details: {
      version: { name: string }
      encounter_details: {
        min_level: number
        max_level: number
        chance: number
        method: { name: string }
        condition_values: { name: string }[]
      }[]
    }[]
  }[]
}

export type RegionTableOptions = {
  version: string
  name: string
  /** Padrão: o mato. */
  method?: 'walk' | FieldMethod
  /** Sem encontro nenhum dá tabela vazia em vez de erro. */
  allowEmpty?: boolean
  exclude?: readonly number[]
  levelOverride?: readonly [number, number]
}

type RawSlot = {
  speciesId: number
  minLevel: number
  maxLevel: number
  chance: number
}

const here = path.dirname(fileURLToPath(import.meta.url))

export const regionsSnapshotPath = path.resolve(here, '../..', 'snapshots', 'regions.json')

function isPeriod(name: string): name is Period {
  return (PERIODS as readonly string[]).includes(name)
}

function slotKey(speciesId: number, minLevel: number, maxLevel: number): string {
  return `${speciesId}:${minLevel}:${maxLevel}`
}

function addChance(table: Map<string, RawSlot>, speciesId: number, minLevel: number, maxLevel: number, chance: number): void {
  const key = slotKey(speciesId, minLevel, maxLevel)
  const existing = table.get(key)
  if (existing) {
    existing.chance += chance
    return
  }
  table.set(key, { speciesId, minLevel, maxLevel, chance })
}

function compareSlots(a: RegionSlot, b: RegionSlot): number {
  return a.speciesId - b.speciesId || a.minLevel - b.minLevel || a.maxLevel - b.maxLevel
}

function largestIndex(tenths: readonly number[], slots: readonly RawSlot[]): number {
  return tenths.reduce((best, tenth, index) => {
    const current = slots[best]
    const candidate = slots[index]
    if (!current || !candidate) return best
    if (tenth > tenths[best]!) return index
    if (tenth < tenths[best]!) return best
    if (candidate.speciesId !== current.speciesId) return candidate.speciesId < current.speciesId ? index : best
    if (candidate.minLevel !== current.minLevel) return candidate.minLevel < current.minLevel ? index : best
    return candidate.maxLevel < current.maxLevel ? index : best
  }, 0)
}

function weightFromTenths(tenths: number): number {
  return Number((tenths / 10).toFixed(1))
}

function normalizeWeights(slots: RawSlot[], name: string): RegionSlot[] {
  let current = slots.filter((slot) => slot.chance > 0)
  for (let pass = 0; pass < 5; pass += 1) {
    if (current.length === 0) break
    const total = current.reduce((sum, slot) => sum + slot.chance, 0)
    const tenths = current.map((slot) => Math.round((slot.chance / total) * WEIGHT_TENTHS))
    if (tenths.some((tenth) => tenth <= 0)) {
      current = current.filter((_, index) => tenths[index]! > 0)
      continue
    }
    const drift = WEIGHT_TENTHS - tenths.reduce((sum, tenth) => sum + tenth, 0)
    const index = largestIndex(tenths, current)
    if (tenths[index]! + drift <= 0) break
    tenths[index]! += drift
    return current
      .map((slot, slotIndex) => ({
        speciesId: slot.speciesId,
        minLevel: slot.minLevel,
        maxLevel: slot.maxLevel,
        weight: weightFromTenths(tenths[slotIndex]!),
      }))
      .sort(compareSlots)
  }
  throw new Error(`${name} could not normalize encounter weights`)
}

// Passos 1 a 6 da seção 5.3. exclude e levelOverride entram antes da
// normalização final, para a tabela publicada continuar somando 100.
export function slotsFromArea(area: LocationArea, options: RegionTableOptions): RegionSlot[] {
  return normalizeWeights([...rawSlotsFromArea(area, options).values()], options.name)
}

/**
 * Área com várias fontes (andares, versões): a média das tabelas, cada fonte
 * com o mesmo peso (JORNADA.md, seção 3). Com uma fonte só, dá o mesmo que
 * slotsFromArea.
 */
export function slotsFromSources(
  sources: readonly { area: LocationArea; version: string }[],
  options: Omit<RegionTableOptions, 'version'>,
): RegionSlot[] {
  if (sources.length === 0) throw new Error(`${options.name} has no sources`)
  // Média só entre as fontes que têm o método (um andar sem água não dilui a pesca).
  const tables = sources
    .map((source) => [...rawSlotsFromArea(source.area, { ...options, version: source.version, allowEmpty: true }).values()])
    .filter((raw) => raw.length > 0)
  if (tables.length === 0) {
    if (options.allowEmpty) return []
    throw new Error(`${options.name} has no ${options.method ?? 'walk'} encounters`)
  }
  const merged = new Map<string, RawSlot>()
  for (const raw of tables) {
    const total = raw.reduce((sum, slot) => sum + slot.chance, 0)
    for (const slot of raw) {
      addChance(merged, slot.speciesId, slot.minLevel, slot.maxLevel, slot.chance / total / tables.length)
    }
  }
  return normalizeWeights([...merged.values()], options.name)
}

function rawSlotsFromArea(area: LocationArea, options: RegionTableOptions): Map<string, RawSlot> {
  const exclude = new Set(options.exclude ?? [])
  const override = options.levelOverride
  if (override && override[1] < override[0]) {
    throw new Error(`${options.name} levelOverride is inverted`)
  }

  const periodTables = PERIODS.map(() => new Map<string, RawSlot>())
  const methods = API_METHODS[options.method ?? 'walk']

  for (const encounter of area.pokemon_encounters) {
    const speciesId = idFromUrl(encounter.pokemon.url)
    if (speciesId < speciesSeed.firstId || speciesId > speciesSeed.lastId) continue
    for (const version of encounter.version_details) {
      if (version.version.name !== options.version) continue
      for (const detail of version.encounter_details) {
        if (!methods.includes(detail.method.name)) continue
        if (!(detail.chance > 0)) continue
        if (detail.max_level < detail.min_level) {
          throw new Error(`${options.name} has an inverted level range for species ${speciesId}`)
        }
        // "Sem enxame" é o mato normal; enxame, rádio e o resto não entram.
        const names = detail.condition_values.map((condition) => condition.name).filter((name) => name !== 'swarm-no')
        const periods = names.filter(isPeriod)
        if (periods.length !== names.length) continue
        const targets = periods.length === 0 ? PERIODS : [...new Set(periods)]
        for (const period of targets) {
          addChance(periodTables[PERIODS.indexOf(period)]!, speciesId, detail.min_level, detail.max_level, detail.chance)
        }
      }
    }
  }

  const keys = new Set<string>()
  for (const table of periodTables) {
    for (const key of table.keys()) keys.add(key)
  }

  const merged = new Map<string, RawSlot>()
  for (const key of keys) {
    let chance = 0
    let sample: RawSlot | undefined
    for (const table of periodTables) {
      const slot = table.get(key)
      if (!slot) continue
      chance += slot.chance
      sample = slot
    }
    if (!sample || !(chance > 0) || exclude.has(sample.speciesId)) continue
    const minLevel = override ? override[0] : sample.minLevel
    const maxLevel = override ? override[1] : sample.maxLevel
    addChance(merged, sample.speciesId, minLevel, maxLevel, chance / PERIODS.length)
  }

  if (merged.size === 0 && !options.allowEmpty) {
    throw new Error(`${options.name} has no ${options.method ?? 'walk'} encounters in ${options.version}`)
  }

  return merged
}

export function readRegionsSnapshot(): RegionsSnapshot {
  if (!fs.existsSync(regionsSnapshotPath)) {
    throw new Error(`regions snapshot not found at ${regionsSnapshotPath}; run npm run seed:regions`)
  }
  const snapshot = JSON.parse(fs.readFileSync(regionsSnapshotPath, 'utf8')) as RegionsSnapshot
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error(`regions snapshot at ${regionsSnapshotPath} is not an object; run npm run seed:regions`)
  }
  return snapshot
}

export function writeRegionsSnapshot(snapshot: RegionsSnapshot): void {
  const blocks = Object.keys(snapshot)
    .sort()
    .map((slug) => {
      const entry = snapshot[slug]
      if (!entry) throw new Error(`missing snapshot entry ${slug}`)
      const table = (slots: readonly RegionSlot[], indent: string) =>
        slots.length === 0
          ? '[]'
          : [
              '[',
              [...slots]
                .sort(compareSlots)
                .map((slot) => `${indent}  ${JSON.stringify(slot)}`)
                .join(',\n'),
              `${indent}]`,
            ].join('\n')
      const methods = FIELD_METHODS.filter((method) => (entry.methods?.[method]?.length ?? 0) > 0)
      const lines = [`  ${JSON.stringify(slug)}: {`, `    "sources": ${JSON.stringify(entry.sources)},`]
      if (methods.length === 0) {
        lines.push(`    "slots": ${table(entry.slots, '    ')}`)
      } else {
        lines.push(`    "slots": ${table(entry.slots, '    ')},`, `    "methods": {`)
        methods.forEach((method, index) => {
          const comma = index < methods.length - 1 ? ',' : ''
          lines.push(`      ${JSON.stringify(method)}: ${table(entry.methods![method]!, '      ')}${comma}`)
        })
        lines.push(`    }`)
      }
      lines.push(`  }`)
      return lines.join('\n')
    })
  fs.mkdirSync(path.dirname(regionsSnapshotPath), { recursive: true })
  fs.writeFileSync(regionsSnapshotPath, `{\n${blocks.join(',\n')}\n}\n`)
}
