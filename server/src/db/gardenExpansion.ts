// Expansão do jardim: os limites de cada jogador e a obra que abre uma faixa
// (config/gardenExpansion). A obra divide a fila com as construções: uma por
// vez. Chamar dentro de immediate().

import { eq, sql } from 'drizzle-orm'
import { expansionCost, expansionsUnlocked, gardenExpansionConfig, nextExpansionMilestone } from '../config/gardenExpansion.js'
import { milestoneByKey } from '../config/milestones.js'
import {
  BASE_BOUNDS,
  EXPAND_SIDES,
  type ExpandSide,
  type GardenBounds,
  canExpandSide,
  expandBounds,
  isExpandSide,
} from '../game/garden/layout.js'
import { getDb } from './client.js'
import { debitItem, itemQty } from './inventory.js'
import { clearedMilestones } from './milestones.js'
import { trainers } from './schema.js'
import { buildingOf } from './structures.js'

type ExpansionRow = {
  minCol: number
  minRow: number
  maxCol: number
  maxRow: number
  done: number
  side: string | null
  startedAt: number | null
  readyAt: number | null
  candies: number
}

function rowOf(userId: number): ExpansionRow {
  const row = getDb()
    .select({
      minCol: trainers.gardenMinCol,
      minRow: trainers.gardenMinRow,
      maxCol: trainers.gardenMaxCol,
      maxRow: trainers.gardenMaxRow,
      done: trainers.gardenExpansions,
      side: trainers.gardenExpandSide,
      startedAt: trainers.gardenExpandStartedAt,
      readyAt: trainers.gardenExpandReadyAt,
      candies: trainers.genericCandies,
    })
    .from(trainers)
    .where(eq(trainers.userId, userId))
    .get()
  if (!row) throw new Error(`trainer missing for user ${userId}`)
  return row
}

const boundsOfRow = (row: ExpansionRow): GardenBounds => ({
  minCol: row.minCol,
  minRow: row.minRow,
  maxCol: row.maxCol,
  maxRow: row.maxRow,
})

/** Os limites do jardim do jogador agora. */
export function gardenBoundsOf(userId: number): GardenBounds {
  const row = getDb()
    .select({
      minCol: trainers.gardenMinCol,
      minRow: trainers.gardenMinRow,
      maxCol: trainers.gardenMaxCol,
      maxRow: trainers.gardenMaxRow,
    })
    .from(trainers)
    .where(eq(trainers.userId, userId))
    .get()
  return row ?? BASE_BOUNDS
}

/** Obra de expansão em andamento, para a fila única das construções. */
export function expansionBuilding(userId: number): { side: ExpandSide; startedAt: number; readyAt: number } | null {
  const row = rowOf(userId)
  if (row.readyAt === null || row.startedAt === null || !isExpandSide(row.side)) return null
  return { side: row.side, startedAt: row.startedAt, readyAt: row.readyAt }
}

/** No catch-up: a obra que já terminou abre a faixa. */
export function finishExpansion(userId: number, now: number): void {
  const row = rowOf(userId)
  if (row.readyAt === null || row.readyAt > now || !isExpandSide(row.side)) return
  const next = expandBounds(boundsOfRow(row), row.side, gardenExpansionConfig.strip)
  getDb()
    .update(trainers)
    .set({
      gardenMinCol: next.minCol,
      gardenMinRow: next.minRow,
      gardenMaxCol: next.maxCol,
      gardenMaxRow: next.maxRow,
      gardenExpansions: row.done + 1,
      gardenExpandSide: null,
      gardenExpandStartedAt: null,
      gardenExpandReadyAt: null,
      updatedAt: now,
    })
    .where(eq(trainers.userId, userId))
    .run()
}

export type ExpansionView = {
  bounds: GardenBounds
  strip: number
  maxSize: number
  /** Expansões terminadas, quantas os marcos já liberaram e o total. */
  done: number
  unlocked: number
  total: number
  /** A próxima: custo (com o que o jogador tem) e tempo; null = acabaram. */
  next: {
    n: number
    items: { itemKey: string; quantity: number; have: number }[]
    genericCandies: { quantity: number; have: number }
    ms: number
  } | null
  /** Marco que libera a próxima, quando ainda não liberou. */
  nextAt: { milestone: string; name: string } | null
  /** Lados que ainda cabem (sem passar do teto). */
  sides: Record<ExpandSide, boolean>
  building: { side: ExpandSide; startedAt: number; readyAt: number } | null
}

export function expansionView(userId: number): ExpansionView {
  const row = rowOf(userId)
  const bounds = boundsOfRow(row)
  const cleared = clearedMilestones(userId)
  const building = expansionBuilding(userId)
  // A em andamento já conta como feita para o custo e para o limite dos marcos.
  const taken = row.done + (building ? 1 : 0)
  const total = gardenExpansionConfig.milestones.length
  const atKey = nextExpansionMilestone(cleared, taken)
  const cost = taken < total ? expansionCost(taken + 1) : null
  const sides = Object.fromEntries(
    EXPAND_SIDES.map((side) => [side, canExpandSide(bounds, side, gardenExpansionConfig.strip, gardenExpansionConfig.maxSize)]),
  ) as Record<ExpandSide, boolean>
  return {
    bounds,
    strip: gardenExpansionConfig.strip,
    maxSize: gardenExpansionConfig.maxSize,
    done: row.done,
    unlocked: expansionsUnlocked(cleared),
    total,
    next: cost
      ? {
          n: taken + 1,
          items: cost.items.map((item) => ({ ...item, have: itemQty(userId, item.itemKey) })),
          genericCandies: { quantity: cost.genericCandies, have: row.candies },
          ms: cost.ms,
        }
      : null,
    nextAt: atKey ? { milestone: atKey, name: milestoneByKey(atKey)?.name ?? atKey } : null,
    sides,
    building,
  }
}

export type ExpandError =
  | 'expansion_locked'
  | 'expansion_max'
  | 'expansion_side_full'
  | 'build_busy'
  | 'missing_items'
  | 'not_enough_candies'

/** Começa a obra de expansão para o lado: confere marco, teto, fila e custo; gasta tudo agora. */
export function startExpansion(
  userId: number,
  side: ExpandSide,
  now: number,
): { ok: true; readyAt: number } | { ok: false; error: ExpandError } {
  const row = rowOf(userId)
  const total = gardenExpansionConfig.milestones.length
  if (row.done >= total) return { ok: false, error: 'expansion_max' }
  if (expansionBuilding(userId) || buildingOf(userId)) return { ok: false, error: 'build_busy' }
  if (row.done >= expansionsUnlocked(clearedMilestones(userId))) return { ok: false, error: 'expansion_locked' }
  if (!canExpandSide(boundsOfRow(row), side, gardenExpansionConfig.strip, gardenExpansionConfig.maxSize)) {
    return { ok: false, error: 'expansion_side_full' }
  }
  const cost = expansionCost(row.done + 1)
  if (cost.items.some((item) => itemQty(userId, item.itemKey) < item.quantity)) return { ok: false, error: 'missing_items' }
  if (row.candies < cost.genericCandies) return { ok: false, error: 'not_enough_candies' }
  for (const item of cost.items) {
    if (!debitItem(userId, item.itemKey, item.quantity)) throw new Error(`debit failed: ${item.itemKey}`)
  }
  const readyAt = now + cost.ms
  getDb()
    .update(trainers)
    .set({
      genericCandies: sql`${trainers.genericCandies} - ${cost.genericCandies}`,
      gardenExpandSide: side,
      gardenExpandStartedAt: now,
      gardenExpandReadyAt: readyAt,
      updatedAt: now,
    })
    .where(eq(trainers.userId, userId))
    .run()
  return { ok: true, readyAt }
}
