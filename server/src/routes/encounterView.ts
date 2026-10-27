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
  /** null = ainda não venceu; número = epoch ms da vitória (8.4, aguardando captura). */
  wonAt: number | null
  /** Chance atual de captura (com catch_boost se ativo); null se ainda não venceu. */
  catchChance: number | null
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
  wonAt?: number | null
  catchChance?: number | null
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
    wonAt: input.wonAt ?? null,
    catchChance: input.catchChance ?? null,
  }
}
