import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { freezeTree } from '../db/apricorn.js'
import { storeBench } from '../db/bench.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { insertPlacement, loadPieces, ownedStructures, type PlacedRow } from '../db/gardenLayout.js'
import { clearedMilestones, gardenUnlocksOf } from '../db/milestones.js'
import { BUILD_RECIPES } from '../config/buildRecipes.js'
import { floorUnlockAt, nextCapAt, nextPlotsAt, pieceUnlockAt, recipeUnlockAt, type UnlockAt } from '../config/gardenUnlocks.js'
import { evictHomeless, loadFloor } from '../db/habitat.js'
import { PAINT_FLOORS, type PaintFloor, isPaintFloor } from '../game/habitat/index.js'
import { itemQty } from '../db/inventory.js'
import { buildingOf, countOf, craftStructure } from '../db/structures.js'
import { freezeHealMachine } from '../db/healMachine.js'
import { berryPlots, gardenPlacements, gardenStructures, gardenTiles } from '../db/schema.js'
import {
  GARDEN_COLS,
  GARDEN_ROWS,
  STRUCTURE_PIECES,
  canPlace,
  inBounds,
  isFlippable,
  isPieceKey,
  type PieceKey,
  type StructurePiece,
} from '../game/garden/layout.js'
import { type Failure, fail, parseId, readObject } from './http.js'

// Construção do jardim (PROGRESSAO.md 4.3): colocar, mover e guardar peças.
// Cada estrutura é uma peça com estado próprio (duas bancadas, duas máquinas).
// A guardada para de produzir: o que cresceu até guardar fica liquidado, e o
// relógio volta a contar ao colocar de novo.

export type LayoutView = {
  cols: number
  rows: number
  pieces: PlacedRow[]
  /** Estruturas guardadas no inventário de construção (a peça e o tipo). */
  stored: { id: number; piece: StructurePiece }[]
  /** Canteiros: quantos podem estar no jardim e quantos estão. */
  plotLimit: number
  plotsPlaced: number
  /** O próximo marco que sobe o limite de canteiros (null = já no máximo). */
  nextPlots: (UnlockAt & { plots: number }) | null
  /** Peças que ainda não abriram e o marco que abre cada uma (o catálogo mostra com cadeado). */
  locked: { piece: StructurePiece; unlockAt: UnlockAt }[]
  /** Receitas de construção (passo 2c): custo, tempo, quantas tem e o teto. */
  recipes: RecipeView[]
  /** A construção em andamento (uma por vez), ou null. */
  building: { id: number; piece: StructurePiece; startedAt: number; readyAt: number } | null
  /** Chão pintado (habitats, 5.22): uma casa por linha, sem as casas de canteiro. */
  floor: { col: number; row: number; floor: string }[]
  /** Chãos da paleta, na ordem, com o marco que abre os fechados (null = aberto). */
  floors: { floor: PaintFloor; unlockAt: UnlockAt | null }[]
}

export type RecipeView = {
  piece: StructurePiece
  cost: { itemKey: string; quantity: number; have: number }[]
  ms: number
  /** Quantas tem (com a que está em construção) e quantas dá para ter. */
  count: number
  cap: number
  /** O marco que libera a receita (null = liberada). */
  unlockAt: UnlockAt | null
  /** O próximo marco que sobe o teto (null = já no máximo). */
  nextCap: (UnlockAt & { cap: number }) | null
}

/** Chamar dentro de immediate(), depois do catch-up (que cria as estruturas abertas). */
export function layoutView(userId: number): LayoutView {
  const pieces = loadPieces(userId)
  const placed = new Set(pieces.map((row) => row.structureId))
  const owned = ownedStructures(userId)
  const ownedKinds = new Set(owned.map((row) => row.piece))
  const cleared = clearedMilestones(userId)
  const unlocks = gardenUnlocksOf(userId)
  return {
    cols: GARDEN_COLS,
    rows: GARDEN_ROWS,
    pieces,
    stored: owned.filter((row) => !placed.has(row.id)),
    plotLimit: gardenUnlocksOf(userId).plotLimit,
    plotsPlaced: pieces.filter((row) => row.piece === 'berry_plot').length,
    nextPlots: nextPlotsAt(cleared),
    locked: STRUCTURE_PIECES.flatMap((piece) => {
      if (ownedKinds.has(piece)) return []
      const unlockAt = pieceUnlockAt(cleared, piece)
      return unlockAt ? [{ piece, unlockAt }] : []
    }),
    recipes: BUILD_RECIPES.map((recipe) => ({
      piece: recipe.piece,
      cost: recipe.cost.map((item) => ({ ...item, have: itemQty(userId, item.itemKey) })),
      ms: recipe.ms,
      count: countOf(userId, recipe.piece),
      cap: unlocks.capOf(recipe.piece),
      unlockAt: recipeUnlockAt(cleared, recipe.piece),
      nextCap: nextCapAt(cleared, recipe.piece),
    })),
    building: buildingOf(userId),
    floor: loadFloor(userId).map(({ col, row, floor }) => ({ col, row, floor: floor ?? '' })),
    floors: PAINT_FLOORS.map((floor) => ({ floor, unlockAt: floorUnlockAt(cleared, floor) })),
  }
}

type Ok = { ok: true; layout: LayoutView; evicted?: number[] }

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
function resume(userId: number, structureId: number, piece: StructurePiece, now: number): void {
  if (piece === 'ball_bench') return
  getDb()
    .update(gardenStructures)
    .set({ since: now })
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.id, structureId)))
    .run()
}

/**
 * Coloca um canteiro novo (até o limite) ou uma estrutura guardada: a
 * `structureId` pedida ou, sem ela, a primeira guardada daquele tipo.
 */
export function placePiece(
  userId: number,
  piece: PieceKey,
  col: number,
  row: number,
  now: number,
  flipped = false,
  structureId?: number,
): Ok | Failure {
  // Girar só vale para quem pode (bancada, máquina); nas outras é ignorado.
  const turn = flipped && isFlippable(piece)
  persistCatchUp(userId, now)
  const pieces = loadPieces(userId)
  let slot = 0
  let structure: number | null = null
  if (piece === 'berry_plot') {
    const placedPlots = pieces.filter((row) => row.piece === 'berry_plot')
    if (placedPlots.length >= gardenUnlocksOf(userId).plotLimit) return fail('plot_limit', 400)
    const used = new Set(placedPlots.map((row) => row.slot))
    while (used.has(slot)) slot += 1
  } else {
    const mine = ownedStructures(userId).filter((owned) => owned.piece === piece)
    if (mine.length === 0) return fail('piece_locked', 400)
    const placed = new Set(pieces.map((placedRow) => placedRow.structureId))
    const stored = mine.filter((owned) => !placed.has(owned.id))
    const chosen = structureId === undefined ? stored[0] : stored.find((owned) => owned.id === structureId)
    if (!chosen) {
      return structureId !== undefined && !mine.some((owned) => owned.id === structureId)
        ? fail('piece_not_found', 404)
        : fail('already_placed', 409)
    }
    structure = chosen.id
  }
  const blocked = canPlace(pieces, piece, col, row, undefined, turn)
  if (blocked) return fail(blocked, 400)
  insertPlacement(userId, piece, slot, col, row, now, turn, structure)
  if (structure !== null && piece !== 'berry_plot') resume(userId, structure, piece, now)
  // O canteiro tem chão próprio: pôr ou tirar um muda as zonas dos habitats.
  const evicted = evictHomeless(userId)
  return { ok: true, layout: layoutView(userId), evicted }
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
  // O canteiro tem chão próprio: pôr ou tirar um muda as zonas dos habitats.
  const evicted = evictHomeless(userId)
  return { ok: true, layout: layoutView(userId), evicted }
}

export function storePiece(userId: number, id: number, now: number): Ok | Failure {
  persistCatchUp(userId, now)
  const found = loadPieces(userId).find((row) => row.id === id)
  if (!found) return fail('piece_not_found', 404)
  const db = getDb()
  const structureId = found.structureId ?? 0
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
      const out = storeBench(userId, structureId, now)
      if (!out.ok) return fail(out.error, 400)
      break
    }
    case 'heal_machine':
      freezeHealMachine(userId, structureId, now)
      break
    default:
      freezeTree(userId, structureId, now)
  }
  db.delete(gardenPlacements).where(and(eq(gardenPlacements.id, id), eq(gardenPlacements.userId, userId))).run()
  // O canteiro tem chão próprio: pôr ou tirar um muda as zonas dos habitats.
  const evicted = evictHomeless(userId)
  return { ok: true, layout: layoutView(userId), evicted }
}

/** Constrói uma peça pela receita (passo 2c): fica pronta depois do tempo dela, guardada. */
export function craftPiece(userId: number, piece: StructurePiece, now: number): Ok | Failure {
  persistCatchUp(userId, now)
  const out = craftStructure(userId, piece, now)
  if (!out.ok) return fail(out.error, 400)
  return { ok: true, layout: layoutView(userId) }
}

export type FloorPaint = { col: number; row: number; floor: PaintFloor | null }

/**
 * Pinta o chão (habitats, 5.22): sem custo nem limite, só os chãos abertos
 * pelos marcos; `null` volta ao gramado. Quem perde a casa sai dela (`evicted`).
 */
export function paintFloor(userId: number, cells: readonly FloorPaint[], now: number): Ok | Failure {
  persistCatchUp(userId, now)
  const open = gardenUnlocksOf(userId).floors
  for (const cell of cells) {
    if (!inBounds(cell)) return fail('out_of_bounds', 400)
    if (cell.floor !== null && !open.has(cell.floor)) return fail('floor_locked', 400)
  }
  const db = getDb()
  for (const cell of cells) {
    const where = and(eq(gardenTiles.userId, userId), eq(gardenTiles.col, cell.col), eq(gardenTiles.row, cell.row))
    if (cell.floor === null) db.delete(gardenTiles).where(where).run()
    else {
      db.insert(gardenTiles)
        .values({ userId, col: cell.col, row: cell.row, floor: cell.floor })
        .onConflictDoUpdate({ target: [gardenTiles.userId, gardenTiles.col, gardenTiles.row], set: { floor: cell.floor } })
        .run()
    }
  }
  const evicted = evictHomeless(userId)
  return { ok: true, layout: layoutView(userId), evicted }
}

function parsePaint(body: Record<string, unknown> | null): FloorPaint[] | null {
  const cells = body?.cells
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > GARDEN_COLS * GARDEN_ROWS) return null
  const out: FloorPaint[] = []
  for (const raw of cells) {
    const cell = parseCell(raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null)
    const floor = (raw as { floor?: unknown }).floor
    if (!cell || (floor !== null && !isPaintFloor(floor))) return null
    out.push({ ...cell, floor: floor as PaintFloor | null })
  }
  return out
}

export const buildRoutes = new Hono<AuthEnv>()

buildRoutes.post('/floor', requireUser, async (c) => {
  const cells = parsePaint(await readObject(c))
  if (!cells) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => paintFloor(c.get('userId'), cells, Date.now()))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ layout: result.layout, evicted: result.evicted ?? [] })
})

buildRoutes.post('/craft', requireUser, async (c) => {
  const piece = (await readObject(c))?.piece
  if (typeof piece !== 'string' || !(STRUCTURE_PIECES as readonly string[]).includes(piece)) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const result = immediate(() => craftPiece(c.get('userId'), piece as StructurePiece, Date.now()))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ layout: result.layout, evicted: result.evicted ?? [] })
})

buildRoutes.post('/place', requireUser, async (c) => {
  const body = await readObject(c)
  const cell = parseCell(body)
  const piece = body?.piece
  const flipped = parseFlipped(body)
  // `structureId` (opcional): qual das guardadas daquele tipo.
  const structureId = body?.structureId
  const badStructure = structureId !== undefined && (typeof structureId !== 'number' || !Number.isInteger(structureId))
  if (!cell || !isPieceKey(piece) || flipped === null || badStructure) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() =>
    placePiece(c.get('userId'), piece, cell.col, cell.row, Date.now(), flipped, structureId as number | undefined),
  )
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ layout: result.layout, evicted: result.evicted ?? [] })
})

buildRoutes.post('/:id/move', requireUser, async (c) => {
  const id = parseId(c.req.param('id'))
  const body = await readObject(c)
  const cell = parseCell(body)
  const flipped = parseFlipped(body)
  if (id === null || !cell || flipped === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => movePiece(c.get('userId'), id, cell.col, cell.row, Date.now(), flipped))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ layout: result.layout, evicted: result.evicted ?? [] })
})

buildRoutes.post('/:id/store', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => storePiece(c.get('userId'), id, Date.now()))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ layout: result.layout, evicted: result.evicted ?? [] })
})
