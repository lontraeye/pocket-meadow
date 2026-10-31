import { inArray } from 'drizzle-orm'
import { leaderByMilestone } from '../config/leaders.js'
import { placeBySlug } from '../config/places.js'
import { regionBySlug } from '../config/regions.js'
import { getDb } from '../db/client.js'
import { species } from '../db/schema.js'
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
  /** Chance base de captura (catch_boost, sem bola); null se ainda não venceu. */
  catchChance: number | null
  throwCount: number
  agitation: number
  captureRate: number
  type1: string
  type2: string | null
  /** Luta contra líder: quem é e o time dele, em ordem; null = selvagem. */
  leader: EncounterLeader | null
}

export type EncounterLeader = {
  key: string
  name: string
  foes: { speciesId: number; displayName: string; level: number; ace: boolean }[]
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
  throwCount?: number
  agitation?: number
  captureRate?: number
  type1?: string
  type2?: string | null
  leaderKey?: string | null
}): EncounterView {
  return {
    id: input.id,
    regionSlug: input.regionSlug,
    regionName: regionBySlug(input.regionSlug)?.name ?? placeBySlug(input.regionSlug)?.name ?? input.regionSlug,
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
    throwCount: input.throwCount ?? 0,
    agitation: input.agitation ?? 0,
    captureRate: input.captureRate ?? 255,
    type1: input.type1 ?? 'normal',
    type2: input.type2 ?? null,
    leader: input.leaderKey ? leaderView(input.leaderKey) : null,
  }
}

/** O líder e o time dele, com os nomes das espécies. */
function leaderView(key: string): EncounterLeader | null {
  const leader = leaderByMilestone(key)
  if (!leader) return null
  const ids = leader.foes.map((foe) => foe.speciesId)
  const names = new Map(
    getDb()
      .select({ id: species.id, displayName: species.displayName })
      .from(species)
      .where(inArray(species.id, ids))
      .all()
      .map((row) => [row.id, row.displayName] as const),
  )
  return {
    key: leader.milestoneKey,
    name: leader.name,
    foes: leader.foes.map((foe) => ({
      speciesId: foe.speciesId,
      displayName: names.get(foe.speciesId) ?? String(foe.speciesId),
      level: foe.level,
      ace: foe.ace ?? false,
    })),
  }
}
