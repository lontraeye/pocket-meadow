import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { pokedexClaims, pokedexEntries, species } from '../db/schema.js'
import {
  albumBlocks,
  obtainableSpeciesIds,
  pokedexConfig,
  rarityBand,
  type AlbumBlockDef,
  type PokedexReward,
  type RarityBand,
} from '../config/pokedex.js'
import { loadRegions } from '../config/regions.js'
import { abilitiesFor, learnsetFor, movesByName } from '../seed/traitsData.js'
import { isFastMove, type LearnEntry, type MoveInfo, type SpeciesAbilities } from './traits.js'

/** Sobe o marco de nível da espécie (sempre o máximo). */
export function bumpMaxLevelReached(userId: number, speciesId: number, level: number): void {
  if (level <= 0) return
  const db = getDb()
  const updated = db
    .update(pokedexEntries)
    .set({
      maxLevelReached: sql`max(${pokedexEntries.maxLevelReached}, ${level})`,
    })
    .where(and(eq(pokedexEntries.userId, userId), eq(pokedexEntries.speciesId, speciesId)))
    .run()
  if (updated.changes === 1) return
  // Sem entrada ainda (ex.: só XP no daycare antes do first seen — raro): não cria.
}

export type DexLayer =
  | 'unknown'
  | 'seen'
  | 'caught'
  | 'locations'
  | 'moves'

export function dexLayer(entry: {
  seenCount: number
  caughtCount: number
  maxLevelReached: number
} | null): DexLayer {
  if (!entry || entry.seenCount <= 0) return 'unknown'
  if (entry.caughtCount <= 0) return 'seen'
  if (entry.maxLevelReached >= pokedexConfig.milestoneMoves) return 'moves'
  if (entry.maxLevelReached >= pokedexConfig.milestoneLocations) return 'locations'
  return 'caught'
}

function titleAbility(key: string): string {
  return key
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export type DexLocation = {
  regionSlug: string
  regionName: string
  minLevel: number
  maxLevel: number
  rarity: RarityBand
}

export type DexMoveRow = {
  name: string
  displayName: string
  type: string
  power: number
  damageClass: 'physical' | 'special'
  kind: 'fast' | 'charged'
  level: number
}

export type DexSpeciesView = {
  id: number
  layer: DexLayer
  displayName?: string
  type1?: string
  type2?: string | null
  /** Nome só se o jogador já viu a espécie; senão só o número. */
  evolution?: { id: number; displayName?: string; stage: number }[]
  abilities?: { slot1: string; slot2: string | null; hidden: string | null }
  locations?: DexLocation[]
  moves?: DexMoveRow[]
  baseStats?: {
    hp: number
    attack: number
    defense: number
    spAttack: number
    spDefense: number
    speed: number
  }
  maxLevelReached?: number
  caughtCount?: number
  seenCount?: number
  shinyCaught?: boolean
  nextUnlock?: { needLevel: number; unlocks: 'locations' | 'moves' } | null
}

function locationsFor(speciesId: number): DexLocation[] {
  const out: DexLocation[] = []
  for (const region of loadRegions()) {
    const total = region.slots.reduce((sum, slot) => sum + slot.weight, 0)
    if (total <= 0) continue
    const mine = region.slots.filter((slot) => slot.speciesId === speciesId)
    if (mine.length === 0) continue
    const weight = mine.reduce((sum, slot) => sum + slot.weight, 0)
    const fraction = weight / total
    let minLevel = mine[0]!.minLevel
    let maxLevel = mine[0]!.maxLevel
    for (const slot of mine) {
      if (slot.minLevel < minLevel) minLevel = slot.minLevel
      if (slot.maxLevel > maxLevel) maxLevel = slot.maxLevel
    }
    out.push({
      regionSlug: region.slug,
      regionName: region.name,
      minLevel,
      maxLevel,
      rarity: rarityBand(fraction),
    })
  }
  return out
}

function moveKind(info: MoveInfo): 'fast' | 'charged' {
  return isFastMove(info.power) ? 'fast' : 'charged'
}

function movesFor(speciesId: number): DexMoveRow[] {
  const catalog = movesByName()
  const rows: DexMoveRow[] = []
  for (const entry of learnsetFor(speciesId)) {
    const info = catalog.get(entry.move)
    if (!info) continue
    rows.push({
      name: info.name,
      displayName: info.displayName,
      type: info.type,
      power: info.power,
      damageClass: info.damageClass,
      kind: moveKind(info),
      level: entry.level,
    })
  }
  return rows
}

function abilitiesView(abilities: SpeciesAbilities): DexSpeciesView['abilities'] {
  return {
    slot1: titleAbility(abilities.slot1),
    slot2: abilities.slot2 ? titleAbility(abilities.slot2) : null,
    hidden: abilities.hidden ? titleAbility(abilities.hidden) : null,
  }
}

type SpeciesRow = {
  id: number
  displayName: string
  type1: string
  type2: string | null
  hp: number
  attack: number
  defense: number
  spAttack: number
  spDefense: number
  speed: number
  evolutionChainId: number
  evolutionStage: number
}

type EntryRow = {
  speciesId: number
  seenCount: number
  caughtCount: number
  maxLevelReached: number
  shinyCaught: boolean
}

/** Monta a visão de uma espécie sem vazar camadas bloqueadas. */
export function speciesDexView(
  sp: SpeciesRow,
  entry: EntryRow | null,
  evoLine: SpeciesRow[],
  seenIds: ReadonlySet<number> = new Set(),
): DexSpeciesView {
  const layer = dexLayer(entry)
  const view: DexSpeciesView = { id: sp.id, layer }
  if (layer === 'unknown') return view

  view.displayName = sp.displayName
  view.seenCount = entry?.seenCount ?? 0
  if (layer === 'seen') return view

  view.type1 = sp.type1
  view.type2 = sp.type2
  view.caughtCount = entry?.caughtCount ?? 0
  view.shinyCaught = entry?.shinyCaught ?? false
  view.maxLevelReached = entry?.maxLevelReached ?? 0
  view.evolution = evoLine.map((row) => {
    if (seenIds.has(row.id)) {
      return { id: row.id, displayName: row.displayName, stage: row.evolutionStage }
    }
    return { id: row.id, stage: row.evolutionStage }
  })
  view.abilities = abilitiesView(abilitiesFor(sp.id))
  if (layer === 'caught') {
    view.nextUnlock = { needLevel: pokedexConfig.milestoneLocations, unlocks: 'locations' }
    return view
  }

  view.locations = locationsFor(sp.id)
  if (layer === 'locations') {
    view.nextUnlock = { needLevel: pokedexConfig.milestoneMoves, unlocks: 'moves' }
    return view
  }

  view.moves = movesFor(sp.id)
  view.baseStats = {
    hp: sp.hp,
    attack: sp.attack,
    defense: sp.defense,
    spAttack: sp.spAttack,
    spDefense: sp.spDefense,
    speed: sp.speed,
  }
  view.nextUnlock = null
  return view
}

export function loadSpeciesRows(): SpeciesRow[] {
  return getDb()
    .select({
      id: species.id,
      displayName: species.displayName,
      type1: species.type1,
      type2: species.type2,
      hp: species.hp,
      attack: species.attack,
      defense: species.defense,
      spAttack: species.spAttack,
      spDefense: species.spDefense,
      speed: species.speed,
      evolutionChainId: species.evolutionChainId,
      evolutionStage: species.evolutionStage,
    })
    .from(species)
    .where(and(gte(species.id, pokedexConfig.firstId), lte(species.id, pokedexConfig.lastId)))
    .all()
    .sort((a, b) => a.id - b.id)
}

export function buildAlbumBlockDefs(allSpecies: SpeciesRow[]): readonly AlbumBlockDef[] {
  const obtainable = obtainableSpeciesIds()
  const byChain = new Map<number, SpeciesRow[]>()
  for (const sp of allSpecies) {
    const list = byChain.get(sp.evolutionChainId) ?? []
    list.push(sp)
    byChain.set(sp.evolutionChainId, list)
  }
  const chains = [...byChain.entries()]
    .map(([chainId, list]) => {
      const sorted = [...list].sort((a, b) => a.evolutionStage - b.evolutionStage || a.id - b.id)
      const base = sorted[0]
      return {
        chainId,
        speciesIds: sorted.map((row) => row.id),
        title: base ? `Linha do ${base.displayName}` : `Linha ${chainId}`,
      }
    })
    .filter((chain) => chain.speciesIds.length >= 2)
  return albumBlocks({ chains, obtainable })
}

/** Blocos do álbum completos e ainda não resgatados (para o badge do HUD). */
export function countClaimableBlocks(userId: number): number {
  const defs = buildAlbumBlockDefs(loadSpeciesRows())
  const db = getDb()
  const caught = new Set(
    db
      .select({ speciesId: pokedexEntries.speciesId })
      .from(pokedexEntries)
      .where(and(eq(pokedexEntries.userId, userId), sql`${pokedexEntries.caughtCount} > 0`))
      .all()
      .map((row) => row.speciesId),
  )
  const claimed = new Set(
    db
      .select({ blockKey: pokedexClaims.blockKey })
      .from(pokedexClaims)
      .where(eq(pokedexClaims.userId, userId))
      .all()
      .map((row) => row.blockKey),
  )
  let n = 0
  for (const block of defs) {
    if (claimed.has(block.key)) continue
    if (block.speciesIds.length === 0) continue
    if (block.speciesIds.every((id) => caught.has(id))) n += 1
  }
  return n
}

export function rewardPayload(reward: PokedexReward): {
  items: { itemKey: string; quantity: number }[]
  genericCandies: number
  energy: number
} {
  return {
    items: reward.items.map((item) => ({ itemKey: item.itemKey, quantity: item.quantity })),
    genericCandies: reward.genericCandies,
    energy: reward.energy,
  }
}

export type { LearnEntry }
