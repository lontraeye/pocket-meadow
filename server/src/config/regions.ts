import { readRegionsSnapshot, type RegionSlot } from '../seed/regionTable.js'

export type GameRegion = 'kanto' | 'johto'

export type RegionSource = {
  area: string
  version: string
}

export type RegionConfig = {
  slug: string
  name: string
  gameRegion: GameRegion
  minTrainerLevel: number
  source: RegionSource
  levelOverride?: readonly [number, number]
  exclude?: readonly number[]
}

export type Region = {
  slug: string
  name: string
  gameRegion: GameRegion
  minTrainerLevel: number
  source: RegionSource
  slots: readonly RegionSlot[]
  wildLevelRange: readonly [number, number]
}

export type RegionStatus = {
  slug: string
  name: string
  gameRegion: GameRegion
  minTrainerLevel: number
  wildLevelRange: readonly [number, number]
  unlocked: boolean
}

// Áreas jogáveis. Kanto e Johto são gameRegion. A tabela de slots fica no
// snapshot e não sai na API. Padrão: Yellow em Kanto, Crystal em Johto.
export const regionConfigs = [
  {
    slug: 'route-1',
    name: 'Rota 1',
    gameRegion: 'kanto',
    minTrainerLevel: 1,
    source: { area: 'kanto-route-1-area', version: 'yellow' },
  },
  {
    slug: 'viridian-forest',
    name: 'Floresta Verde',
    gameRegion: 'kanto',
    minTrainerLevel: 3,
    // Yellow não tem Pikachu na Floresta Verde; no Red ele sai a 5%.
    source: { area: 'viridian-forest-area', version: 'red' },
  },
  {
    slug: 'mt-moon',
    name: 'Mt. Moon',
    gameRegion: 'kanto',
    minTrainerLevel: 6,
    source: { area: 'mt-moon-1f', version: 'yellow' },
  },
  {
    slug: 'route-29',
    name: 'Rota 29',
    gameRegion: 'johto',
    minTrainerLevel: 1,
    source: { area: 'johto-route-29-area', version: 'crystal' },
  },
  {
    slug: 'route-30',
    name: 'Rota 30',
    gameRegion: 'johto',
    minTrainerLevel: 3,
    source: { area: 'johto-route-30-area', version: 'crystal' },
  },
  {
    slug: 'union-cave',
    name: 'Union Cave',
    gameRegion: 'johto',
    minTrainerLevel: 6,
    source: { area: 'union-cave-1f', version: 'crystal' },
  },
] satisfies readonly RegionConfig[]

let cached: readonly Region[] | undefined

function wildLevelRange(slots: readonly RegionSlot[]): readonly [number, number] {
  const first = slots[0]
  if (!first) throw new Error('region has no slots')
  let min = first.minLevel
  let max = first.maxLevel
  for (const slot of slots) {
    if (slot.minLevel < min) min = slot.minLevel
    if (slot.maxLevel > max) max = slot.maxLevel
  }
  return [min, max]
}

function assembleRegions(): readonly Region[] {
  const snapshot = readRegionsSnapshot()
  return regionConfigs.map((config) => {
    const entry = snapshot[config.slug]
    if (!entry || !Array.isArray(entry.slots) || entry.slots.length === 0) {
      throw new Error(`region ${config.slug} is missing from snapshots/regions.json; run npm run seed:regions`)
    }
    if (entry.area !== config.source.area || entry.version !== config.source.version) {
      throw new Error(
        `region ${config.slug} snapshot is ${entry.area}/${entry.version}, config wants ${config.source.area}/${config.source.version}; run npm run seed:regions`,
      )
    }
    return {
      slug: config.slug,
      name: config.name,
      gameRegion: config.gameRegion,
      minTrainerLevel: config.minTrainerLevel,
      source: config.source,
      slots: entry.slots,
      wildLevelRange: wildLevelRange(entry.slots),
    }
  })
}

// Falha no boot se o snapshot não cobrir o config.
export function loadRegions(): readonly Region[] {
  if (!cached) cached = assembleRegions()
  return cached
}

export function regionBySlug(slug: string): Region | undefined {
  return loadRegions().find((region) => region.slug === slug)
}

export function regionStatus(region: Region, trainerLevel: number): RegionStatus {
  return {
    slug: region.slug,
    name: region.name,
    gameRegion: region.gameRegion,
    minTrainerLevel: region.minTrainerLevel,
    wildLevelRange: region.wildLevelRange,
    unlocked: trainerLevel >= region.minTrainerLevel,
  }
}
