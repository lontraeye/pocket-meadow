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
  /** null = luta manual não iniciada; número = epoch ms do start (8.3). */
  battleStartedAt: number | null
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
  battleStartedAt?: number | null
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
    battleStartedAt: input.battleStartedAt ?? null,
  }
}
