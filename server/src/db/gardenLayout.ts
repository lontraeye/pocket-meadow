import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  DEFAULT_LAYOUT,
  STRUCTURE_PIECES,
  canPlace,
  isPieceKey,
  type PieceKey,
  type PlacedPiece,
  type StructurePiece,
} from '../game/garden/layout.js'
import { getDb } from './client.js'
import { gardenUnlocksOf } from './milestones.js'
import { berryPlots, gardenPlacements, gardenStructures, trainers } from './schema.js'

// Peças colocadas no jardim (PROGRESSAO.md 4.3). Cada estrutura tem a linha
// dela em `garden_structures` (o estado) e, se estiver no jardim, uma aqui
// (`structure_id`); guardada, não produz. Chamar dentro de immediate().

export type PlacedRow = PlacedPiece & { slot: number; structureId: number | null }

export function loadPieces(userId: number): PlacedRow[] {
  return getDb()
    .select({
      id: gardenPlacements.id,
      piece: gardenPlacements.piece,
      structureId: gardenPlacements.structureId,
      slot: gardenPlacements.slot,
      col: gardenPlacements.col,
      row: gardenPlacements.row,
      flipped: gardenPlacements.flipped,
    })
    .from(gardenPlacements)
    .where(eq(gardenPlacements.userId, userId))
    .all()
    .filter((row): row is PlacedRow => isPieceKey(row.piece))
    .sort((a, b) => a.id - b.id)
}

/** A estrutura `structureId` está no jardim. */
export function isPlaced(structureId: number): boolean {
  return (
    getDb()
      .select({ id: gardenPlacements.id })
      .from(gardenPlacements)
      .where(eq(gardenPlacements.structureId, structureId))
      .get() !== undefined
  )
}

/** O canteiro `slot` está no jardim. */
export function plotPlaced(userId: number, slot: number): boolean {
  return (
    getDb()
      .select({ id: gardenPlacements.id })
      .from(gardenPlacements)
      .where(
        and(eq(gardenPlacements.userId, userId), eq(gardenPlacements.piece, 'berry_plot'), eq(gardenPlacements.slot, slot)),
      )
      .get() !== undefined
  )
}

/** As estruturas prontas do jogador (colocadas ou guardadas): id e tipo, na ordem em que vieram. */
export function ownedStructures(userId: number): { id: number; piece: StructurePiece }[] {
  return getDb()
    .select({ id: gardenStructures.id, key: gardenStructures.key })
    .from(gardenStructures)
    .where(and(eq(gardenStructures.userId, userId), isNull(gardenStructures.readyAt)))
    .orderBy(asc(gardenStructures.id))
    .all()
    .flatMap((row) =>
      (STRUCTURE_PIECES as readonly string[]).includes(row.key) ? [{ id: row.id, piece: row.key as StructurePiece }] : [],
    )
}

export function insertPlacement(
  userId: number,
  piece: PieceKey,
  slot: number,
  col: number,
  row: number,
  now: number,
  flipped = false,
  structureId: number | null = null,
): number {
  const inserted = getDb()
    .insert(gardenPlacements)
    .values({ userId, piece, structureId, slot, col, row, flipped, placedAt: now })
    .returning({ id: gardenPlacements.id })
    .get()
  return inserted.id
}

/**
 * Na primeira vez (conta nova ou de antes da construção), põe no jardim o que o
 * jogador já tem, nas casas de antes: os canteiros abertos (e os plantados) e
 * as estruturas que já existem. O que abrir depois vai para o inventário.
 */
export function ensureGardenLayout(userId: number, now: number): void {
  const db = getDb()
  const trainer = db
    .select({ layoutAt: trainers.gardenLayoutAt })
    .from(trainers)
    .where(eq(trainers.userId, userId))
    .get()
  if (!trainer || trainer.layoutAt !== null) return

  const planted = db
    .select({ slot: berryPlots.plotIndex })
    .from(berryPlots)
    .where(eq(berryPlots.userId, userId))
    .all()
    .map((row) => row.slot)
  const limit = Math.min(gardenUnlocksOf(userId).plotLimit, DEFAULT_LAYOUT.plots.length)
  const slots = new Set<number>(planted)
  for (let slot = 0; slot < limit; slot += 1) slots.add(slot)
  for (const slot of [...slots].sort((a, b) => a - b)) {
    const cell = DEFAULT_LAYOUT.plots[slot]
    if (cell) insertPlacement(userId, 'berry_plot', slot, cell.col, cell.row, now)
  }

  for (const owned of ownedStructures(userId)) autoPlace(userId, owned.id, owned.piece, now)

  db.update(trainers).set({ gardenLayoutAt: now }).where(eq(trainers.userId, userId)).run()
}

/**
 * Estrutura que acabou de abrir (ou a migração): vai para a casa de sempre se
 * ela estiver livre; senão fica guardada para o jogador colocar.
 */
export function autoPlace(userId: number, structureId: number, piece: StructurePiece, now: number): boolean {
  const pieces = loadPieces(userId)
  if (pieces.some((row) => row.structureId === structureId)) return true
  const cell = DEFAULT_LAYOUT.structures[piece]
  if (canPlace(pieces, piece, cell.col, cell.row)) return false
  insertPlacement(userId, piece, 0, cell.col, cell.row, now, false, structureId)
  return true
}
