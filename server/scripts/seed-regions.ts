import { regionConfigs } from '../src/config/regions.js'
import { getJson } from '../src/seed/pokeapi.js'
import {
  type LocationArea,
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
  const slots = slotsFromSources(sources, {
    name: region.name,
    exclude: region.exclude,
    levelOverride: region.levelOverride,
  })
  snapshot[region.slug] = {
    sources: region.sources.map((source) => ({ area: source.area, version: source.version })),
    slots,
  }
  const min = Math.min(...slots.map((slot) => slot.minLevel))
  const max = Math.max(...slots.map((slot) => slot.maxLevel))
  console.log(`${region.slug}: ${slots.length} slots, nv ${min}–${max}`)
}

writeRegionsSnapshot(snapshot)
console.log(`wrote ${Object.keys(snapshot).length} regions`)
