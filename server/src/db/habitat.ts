// Habitats no banco (PLANNING 5.22, decidido em 2026-11-04): o chão pintado
// (garden_tiles), as zonas que o motor reconhece e a casa de cada Pokémon
// (pokemon.home_col/home_row). Habitat é bônus: sem casa, o Pokémon segue no
// jardim como sempre. Chamar dentro de immediate().

import { and, eq, isNotNull } from 'drizzle-orm'
import { type GardenCell, type Zone, biomeBonus, canLiveIn, recognizeHabitats, zoneAt } from '../game/habitat/index.js'
import { getDb } from './client.js'
import { loadPieces } from './gardenLayout.js'
import { gardenTiles, pokemon, species } from './schema.js'

/** O chão pintado; as casas com canteiro ficam de fora (o canteiro tem chão próprio). */
export function loadFloor(userId: number): GardenCell[] {
  const plots = new Set(
    loadPieces(userId)
      .filter((row) => row.piece === 'berry_plot')
      .map((row) => `${row.col},${row.row}`),
  )
  return getDb()
    .select({ col: gardenTiles.col, row: gardenTiles.row, floor: gardenTiles.floor })
    .from(gardenTiles)
    .where(eq(gardenTiles.userId, userId))
    .all()
    .filter((tile) => !plots.has(`${tile.col},${tile.row}`))
    .map((tile) => ({ ...tile, object: null }))
}

export function loadZones(userId: number): Zone[] {
  return recognizeHabitats(loadFloor(userId))
}

type Resident = { id: number; homeCol: number; homeRow: number; types: string[] }

function residents(userId: number): Resident[] {
  return getDb()
    .select({
      id: pokemon.id,
      homeCol: pokemon.homeCol,
      homeRow: pokemon.homeRow,
      type1: species.type1,
      type2: species.type2,
    })
    .from(pokemon)
    .innerJoin(species, eq(species.id, pokemon.speciesId))
    .where(and(eq(pokemon.userId, userId), isNotNull(pokemon.homeCol), isNotNull(pokemon.homeRow)))
    .orderBy(pokemon.id)
    .all()
    .map((row) => ({
      id: row.id,
      homeCol: row.homeCol!,
      homeRow: row.homeRow!,
      types: row.type2 ? [row.type1, row.type2] : [row.type1],
    }))
}

/**
 * Tira a casa de quem não cabe mais (a zona sumiu, virou outro bioma ou ficou
 * com menos vagas). Fica quem chegou primeiro (menor id). Devolve os ids.
 */
export function evictHomeless(userId: number, zones: readonly Zone[] = loadZones(userId)): number[] {
  const used = new Map<Zone, number>()
  const out: number[] = []
  for (const mon of residents(userId)) {
    const zone = zoneAt(zones, mon.homeCol, mon.homeRow)
    const taken = zone ? (used.get(zone) ?? 0) : 0
    if (!zone || !zone.biome || !canLiveIn(mon.types, zone.biome) || taken >= zone.capacity) {
      out.push(mon.id)
      continue
    }
    used.set(zone, taken + 1)
  }
  if (out.length > 0) {
    for (const id of out) {
      getDb().update(pokemon).set({ homeCol: null, homeRow: null }).where(eq(pokemon.id, id)).run()
    }
  }
  return out
}

/** Quem mora no bioma do próprio tipo (ganha o bônus no jardim). */
export function habitatBonusIds(userId: number, zones: readonly Zone[] = loadZones(userId)): Set<number> {
  const ids = new Set<number>()
  for (const mon of residents(userId)) {
    if (biomeBonus(mon.types, zoneAt(zones, mon.homeCol, mon.homeRow)?.biome ?? null)) ids.add(mon.id)
  }
  return ids
}

/** Quantos moram na zona agora (sem contar `exceptId`). */
export function residentsOf(userId: number, zone: Zone, exceptId?: number): number {
  return residents(userId).filter(
    (mon) => mon.id !== exceptId && zone.tiles.some((tile) => tile.col === mon.homeCol && tile.row === mon.homeRow),
  ).length
}
