// Habitats no banco (PLANNING 5.22, redesenhado em 2026-11-04): o chão pintado
// (garden_tiles), os habitats com área e tipo escolhidos (habitats e
// habitat_tiles, uma casa por habitat) e onde cada Pokémon mora
// (pokemon.habitat_id). Habitat é bônus: sem casa, o Pokémon segue no jardim.
// Chamar dentro de immediate().

import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { type CellLook, type HabitatCheck, type HabitatKind, canLiveInKind, checkHabitat, kindBonus } from '../game/habitat/index.js'
import { getDb } from './client.js'
import { loadPieces } from './gardenLayout.js'
import { gardenTiles, habitatTiles, habitats, pokemon, species } from './schema.js'

/** O chão pintado; as casas com canteiro ficam de fora (o canteiro tem chão próprio). */
export function loadFloor(userId: number): { col: number; row: number; floor: string }[] {
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
}

/** O que tem em cada casa, para o motor (móveis entram com os decorativos). */
export function floorLook(userId: number): CellLook {
  const byCell = new Map(loadFloor(userId).map((tile) => [`${tile.col},${tile.row}`, tile.floor]))
  return (col, row) => {
    const floor = byCell.get(`${col},${row}`) ?? null
    return floor === null ? null : { floor, object: null }
  }
}

export type HabitatRow = { id: number; kind: HabitatKind; tiles: { col: number; row: number }[] }

export function loadHabitats(userId: number): HabitatRow[] {
  const db = getDb()
  const rows = db
    .select({ id: habitats.id, kind: habitats.kind })
    .from(habitats)
    .where(eq(habitats.userId, userId))
    .orderBy(habitats.id)
    .all()
  const tiles = db
    .select({ habitatId: habitatTiles.habitatId, col: habitatTiles.col, row: habitatTiles.row })
    .from(habitatTiles)
    .where(eq(habitatTiles.userId, userId))
    .orderBy(habitatTiles.row, habitatTiles.col)
    .all()
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as HabitatKind,
    tiles: tiles.filter((tile) => tile.habitatId === row.id).map(({ col, row: r }) => ({ col, row: r })),
  }))
}

type Resident = { id: number; habitatId: number; types: string[] }

function residents(userId: number): Resident[] {
  return getDb()
    .select({ id: pokemon.id, habitatId: pokemon.habitatId, type1: species.type1, type2: species.type2 })
    .from(pokemon)
    .innerJoin(species, eq(species.id, pokemon.speciesId))
    .where(and(eq(pokemon.userId, userId), isNotNull(pokemon.habitatId)))
    .orderBy(pokemon.id)
    .all()
    .map((row) => ({ id: row.id, habitatId: row.habitatId!, types: row.type2 ? [row.type1, row.type2] : [row.type1] }))
}

/** Cada habitat com a conta do motor (pontos, pronto, vagas). */
export function checkedHabitats(userId: number): (HabitatRow & { check: HabitatCheck })[] {
  const look = floorLook(userId)
  return loadHabitats(userId).map((row) => ({ ...row, check: checkHabitat(row.kind, row.tiles, look) }))
}

/**
 * Tira a casa de quem não cabe mais: o tipo não aceita, o habitat não está
 * pronto ou ficou com menos vagas. Fica quem chegou primeiro (menor id).
 */
export function evictHomeless(userId: number): number[] {
  const byId = new Map(checkedHabitats(userId).map((row) => [row.id, row]))
  const used = new Map<number, number>()
  const out: number[] = []
  for (const mon of residents(userId)) {
    const home = byId.get(mon.habitatId)
    const taken = used.get(mon.habitatId) ?? 0
    if (!home || !canLiveInKind(mon.types, home.kind) || taken >= home.check.capacity) {
      out.push(mon.id)
      continue
    }
    used.set(mon.habitatId, taken + 1)
  }
  if (out.length > 0) getDb().update(pokemon).set({ habitatId: null }).where(inArray(pokemon.id, out)).run()
  return out
}

/** Quem mora num habitat pronto do próprio tipo (ganha o bônus no jardim). */
export function habitatBonusIds(userId: number): Set<number> {
  const byId = new Map(checkedHabitats(userId).map((row) => [row.id, row]))
  const ids = new Set<number>()
  for (const mon of residents(userId)) {
    const home = byId.get(mon.habitatId)
    if (home && kindBonus(mon.types, home.kind, home.check.ready)) ids.add(mon.id)
  }
  return ids
}

/** Quantos moram no habitat (sem contar `exceptId`). */
export function residentsOf(userId: number, habitatId: number, exceptId?: number): number {
  return residents(userId).filter((mon) => mon.habitatId === habitatId && mon.id !== exceptId).length
}
