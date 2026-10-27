import { regionConfigs } from '../src/config/regions.js'
import { getJson } from '../src/seed/pokeapi.js'
import {
  type LocationArea,
  type RegionsSnapshot,
  slotsFromArea,
  writeRegionsSnapshot,
} from '../src/seed/regionTable.js'

const snapshot: RegionsSnapshot = {}

for (const region of regionConfigs) {
  const area = await getJson<LocationArea>(`/location-area/${region.source.area}`)
  const slots = slotsFromArea(area, {
    version: region.source.version,
    name: region.name,
    exclude: region.exclude,
    levelOverride: region.levelOverride,
  })
  snapshot[region.slug] = {
    area: region.source.area,
    version: region.source.version,
    slots,
  }
  const min = Math.min(...slots.map((slot) => slot.minLevel))
  const max = Math.max(...slots.map((slot) => slot.maxLevel))
  console.log(`${region.slug}: ${slots.length} slots, nv ${min}–${max}`)
}

writeRegionsSnapshot(snapshot)
console.log(`wrote ${Object.keys(snapshot).length} regions`)
