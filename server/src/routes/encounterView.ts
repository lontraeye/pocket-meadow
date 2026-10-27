import { regionBySlug } from '../config/regions.js'
import { power } from '../game/battle.js'

export type EncounterView = {
  id: number
  regionSlug: string
  regionName: string
  speciesId: number
  name: string
  displayName: string
  level: number
  isShiny: boolean
  expiresAt: number
  wildPower: number
}

export function toEncounterView(input: {
  id: number
  regionSlug: string
  speciesId: number
  name: string
  displayName: string
  level: number
  isShiny: boolean
  expiresAt: number
  baseStatTotal: number
}): EncounterView {
  return {
    id: input.id,
    regionSlug: input.regionSlug,
    regionName: regionBySlug(input.regionSlug)?.name ?? input.regionSlug,
    speciesId: input.speciesId,
    name: input.name,
    displayName: input.displayName,
    level: input.level,
    isShiny: input.isShiny,
    expiresAt: input.expiresAt,
    wildPower: power(input.baseStatTotal, input.level),
  }
}
