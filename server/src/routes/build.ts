import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { freezeTree, treesView } from '../db/apricorn.js'
import { benchView, storeBench } from '../db/bench.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { insertPlacement, loadPieces, ownedStructures, type PlacedRow } from '../db/gardenLayout.js'
import { clearedMilestones, gardenUnlocksOf } from '../db/milestones.js'
import { nextPlotsAt, pieceUnlockAt, type UnlockAt } from '../config/gardenUnlocks.js'
import { freezeHealMachine } from '../db/healMachine.js'
import { berryPlots, gardenPlacements, gardenStructures } from '../db/schema.js'
import {
  GARDEN_COLS,
  GARDEN_ROWS,
  STRUCTURE_PIECES,
  canPlace,
  isFlippable,
  isPieceKey,
  type PieceKey,
  type StructurePiece,
} from '../game/garden/layout.js'
import { type Failure, fail, parseId, readObject } from './http.js'

// Construção do jardim (PROGRESSAO.md 4.3, passo 1): colocar, mover e guardar
// peças. A estrutura guardada para de produzir: o que cresceu até guardar fica
// liquidado, e o relógio volta a contar ao colocar de novo.

export type LayoutView = {
  cols: number
  rows: number
  pieces: PlacedRow[]
  /** Estruturas guardadas no inventário de construção. */
  stored: StructurePiece[]
  /** Canteiros: quantos podem estar no jardim e quantos estão. */
  plotLimit: number
  plotsPlaced: number
  /** O próximo marco que sobe o limite de canteiros (null = já no máximo). */
  nextPlots: (UnlockAt & { plots: number }) | null
  /** Peças que ainda não abriram e o marco que abre cada uma (o catálogo mostra com cadeado). */
  locked: { piece: StructurePiece; unlockAt: UnlockAt }[]
}

/** Chamar dentro de immediate(), depois do catch-up e das views (que criam as estruturas abertas). */
export function layoutView(userId: number): LayoutView {
  const pieces = loadPieces(userId)
  const placed = new Set(pieces.map((row) => row.piece))
  const owned = ownedStructures(userId)
  const cleared = clearedMilestones(userId)
  return {
    cols: GARDEN_COLS,
    rows: GARDEN_ROWS,
    pieces,
    stored: STRUCTURE_PIECES.filter((piece) => owned.has(piece) && !placed.has(piece)),
    plotLimit: gardenUnlocksOf(userId).plotLimit,
    plotsPlaced: pieces.filter((row) => row.piece === 'berry_plot').length,
    nextPlots: nextPlotsAt(cleared),
    locked: STRUCTURE_PIECES.flatMap((piece) => {
      if (owned.has(piece)) return []
      const unlockAt = pieceUnlockAt(cleared, piece)
      return unlockAt ? [{ piece, unlockAt }] : []
    }),
  }
}

type Ok = { ok: true; layout: LayoutView }

function parseCell(body: Record<string, unknown> | null): { col: number; row: number } | null {
  const col = body?.col
  const row = body?.row
  if (typeof col !== 'number' || typeof row !== 'number' || !Number.isInteger(col) || !Number.isInteger(row)) return null
  return { col, row }
}

/** `flipped` é opcional: ausente = não girada (colocar) ou como está (mover). */
function parseFlipped(body: Record<string, unknown> | null): boolean | undefined | null {
  const flipped = body?.flipped
  if (flipped === undefined) return undefined
  return typeof flipped === 'boolean' ? flipped : null
}

/** O relógio da estrutura volta a contar agora (árvore e máquina de cura). */
function resume(userId: number, piece: StructurePiece, now: number): void {
  if (piece === 'ball_bench') return
  getDb()
    .update(gardenStructures)
    .set({ since: now })
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, piece)))
    .run()
}

export function placePiece(
  userId: number,
  piece: PieceKey,
  col: number,
  row: number,
  now: number,
  flipped = false,
): Ok | Failure {
  // Girar só vale para quem pode (bancada, máquina); nas outras é ignorado.
  const turn = flipped && isFlippable(piece)
  persistCatchUp(userId, now)
  // As views criam as estruturas que os marcos já abriram.
  treesView(userId, now)
  benchView(userId, now)
  const pieces = loadPieces(userId)
  let slot = 0
  if (piece === 'berry_plot') {
    const placedPlots = pieces.filter((row) => row.piece === 'berry_plot')
    if (placedPlots.length >= gardenUnlocksOf(userId).plotLimit) return fail('plot_limit', 400)
    const used = new Set(placedPlots.map((row) => row.slot))
    while (used.has(slot)) slot += 1
  } else {
    if (!ownedStructures(userId).has(piece)) return fail('piece_locked', 400)
    if (pieces.some((row) => row.piece === piece)) return fail('already_placed', 409)
  }
  const blocked = canPlace(pieces, piece, col, row, undefined, turn)
  if (blocked) return fail(blocked, 400)
  insertPlacement(userId, piece, slot, col, row, now, turn)
  if (piece !== 'berry_plot') resume(userId, piece, now)
  return { ok: true, layout: layoutView(userId) }
}

export function movePiece(
  userId: number,
  id: number,
  col: number,
  row: number,
  now: number,
  flipped?: boolean,
): Ok | Failure {
  persistCatchUp(userId, now)
  const pieces = loadPieces(userId)
  const found = pieces.find((row) => row.id === id)
  if (!found) return fail('piece_not_found', 404)
  const turn = isFlippable(found.piece) ? (flipped ?? found.flipped) : false
  const blocked = canPlace(pieces, found.piece, col, row, id, turn)
  if (blocked) return fail(blocked, 400)
  // O operador da bancada vai junto: a casa dele sai da pegada (cellsOf).
  getDb()
    .update(gardenPlacements)
    .set({ col, row, flipped: turn })
    .where(and(eq(gardenPlacements.id, id), eq(gardenPlacements.userId, userId)))
    .run()
  return { ok: true, layout: layoutView(userId) }
}

export function storePiece(userId: number, id: number, now: number): Ok | Failure {
  persistCatchUp(userId, now)
  const found = loadPieces(userId).find((row) => row.id === id)
  if (!found) return fail('piece_not_found', 404)
  const db = getDb()
  switch (found.piece) {
    case 'berry_plot': {
      const plant = db
        .select({ slot: berryPlots.plotIndex })
        .from(berryPlots)
        .where(and(eq(berryPlots.userId, userId), eq(berryPlots.plotIndex, found.slot)))
        .get()
      if (plant) return fail('plot_not_empty', 400)
      break
    }
    case 'ball_bench': {
      const out = storeBench(userId, now)
      if (!out.ok) return fail(out.error, 400)
      break
    }
    case 'heal_machine':
      freezeHealMachine(userId, now)
      break
    default:
      freezeTree(userId, found.piece, now)
  }
  db.delete(gardenPlacements).where(and(eq(gardenPlacements.id, id), eq(gardenPlacements.userId, userId))).run()
  return { ok: true, layout: layoutView(userId) }
}

export const buildRoutes = new Hono<AuthEnv>()

buildRoutes.post('/place', requireUser, async (c) => {
  const body = await readObject(c)
  const cell = parseCell(body)
  const piece = body?.piece
  const flipped = parseFlipped(body)
  if (!cell || !isPieceKey(piece) || flipped === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => placePiece(c.get('userId'), piece, cell.col, cell.row, Date.now(), flipped))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ layout: result.layout })
})

buildRoutes.post('/:id/move', requireUser, async (c) => {
  const id = parseId(c.req.param('id'))
  const body = await readObject(c)
  const cell = parseCell(body)
  const flipped = parseFlipped(body)
  if (id === null || !cell || flipped === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => movePiece(c.get('userId'), id, cell.col, cell.row, Date.now(), flipped))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ layout: result.layout })
})

buildRoutes.post('/:id/store', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => storePiece(c.get('userId'), id, Date.now()))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ layout: result.layout })
})
