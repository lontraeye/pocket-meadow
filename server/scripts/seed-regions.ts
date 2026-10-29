import { regionConfigs } from '../src/config/regions.js'
import { getJson } from '../src/seed/pokeapi.js'
import {
  FIELD_METHODS,
  type LocationArea,
  type RegionSlot,
  type RegionsSnapshot,
  slotsFromSources,
  writeRegionsSnapshot,
} from '../src/seed/regionTable.js'

const snapshot: RegionsSnapshot = {}

for (const region of regionConfigs) {
  const sources = []
  for (const source of region.sources) {
    sources.push({ area: await getJson<LocationArea>(`/location-area/${source.area}`), version: source.version })
  }
  const options = { name: region.name, exclude: region.exclude, allowEmpty: true }
  // O levelOverride vale só para o mato.
  const slots = slotsFromSources(sources, { ...options, levelOverride: region.levelOverride })
  const methods: Partial<Record<(typeof FIELD_METHODS)[number], RegionSlot[]>> = {}
  for (const method of FIELD_METHODS) {
    const table = slotsFromSources(sources, { ...options, method })
    if (table.length > 0) methods[method] = table
  }
  if (slots.length === 0 && Object.keys(methods).length === 0) throw new Error(`${region.slug} has no encounters`)
  snapshot[region.slug] = {
    sources: region.sources.map((source) => ({ area: source.area, version: source.version })),
    slots,
    ...(Object.keys(methods).length > 0 ? { methods } : {}),
  }
  const extra = Object.entries(methods).map(([method, table]) => `${method} ${table.length}`)
  console.log(`${region.slug}: ${slots.length} no mato${extra.length > 0 ? ` · ${extra.join(' · ')}` : ''}`)
}

writeRegionsSnapshot(snapshot)
console.log(`wrote ${Object.keys(snapshot).length} regions`)
