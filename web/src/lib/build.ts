// Caminho relativo (não o alias @garden) para os testes rodarem com o tsx puro.
import {
  BASE_BOUNDS,
  canPlace,
  cellsOf,
  type GardenBounds,
  isFlippable,
  type PieceKey,
} from '../../../server/src/game/garden/layout'
import type { PaintFloor } from '../../../server/src/game/habitat/config'
import type { GardenLayout } from './api'

// Modo Construir do jardim (PROGRESSAO.md 4.3): o que está escolhido e onde dá
// para pôr. As casas são as da grade jogável (os limites do jogador, `bounds`), como no servidor.
// Peça nova ou sendo movida tem uma prévia (col, row, flipped): ela é desenhada
// lá no lugar da de verdade até o jogador confirmar.

export type BuildGhost = { col: number; row: number; flipped: boolean }

/** Pincel do chão (habitats, 5.22): um chão da paleta ou a borracha (volta ao gramado). */
export type PaintTool = PaintFloor | 'erase'

export type BuildPick =
  /** Peça nova: um canteiro ou uma estrutura guardada (`structureId`). */
  | ({ kind: 'new'; piece: PieceKey; structureId: number | null } & BuildGhost)
  | { kind: 'selected'; id: number; piece: PieceKey }
  | ({ kind: 'move'; id: number; piece: PieceKey } & BuildGhost)

export type PlacedView = GardenLayout['pieces'][number]

/** A prévia ganha este id (peça nova) e este slot (canteiro novo). */
export const GHOST_ID = -1

/** Limites do jardim do layout (resposta antiga sem `bounds`: o 12×12). */
export function boundsOf(layout: Pick<GardenLayout, 'bounds'>): GardenBounds {
  return layout.bounds ?? BASE_BOUNDS
}

/** A peça colocada que ocupa a casa (pela pegada inteira). */
export function pieceAtCell(pieces: readonly PlacedView[], col: number, row: number): PlacedView | null {
  return (
    pieces.find((placed) =>
      cellsOf(placed.piece, placed.col, placed.row, placed.flipped).some((cell) => cell.col === col && cell.row === row),
    ) ?? null
  )
}

/** Casas onde a peça escolhida pode ficar (a âncora): `${col},${row}`. */
export function validAnchors(layout: GardenLayout, pick: BuildPick | null): Set<string> {
  const out = new Set<string>()
  if (!pick || pick.kind === 'selected') return out
  const ignoreId = pick.kind === 'move' ? pick.id : undefined
  const bounds = boundsOf(layout)
  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    for (let col = bounds.minCol; col <= bounds.maxCol; col += 1) {
      if (canPlace(layout.pieces, pick.piece, col, row, ignoreId, pick.flipped, bounds) === null) out.add(`${col},${row}`)
    }
  }
  return out
}

/** A prévia cabe onde está. */
export function ghostFits(layout: GardenLayout, pick: BuildPick | null): boolean {
  if (!pick || pick.kind === 'selected') return false
  return (
    canPlace(layout.pieces, pick.piece, pick.col, pick.row, pick.kind === 'move' ? pick.id : undefined, pick.flipped, boundsOf(layout)) ===
    null
  )
}

/** Casas da peça selecionada, ou da prévia, para destacar. */
export function pickedCells(layout: GardenLayout, pick: BuildPick | null): Set<string> {
  if (!pick) return new Set()
  if (pick.kind !== 'selected') {
    return new Set(cellsOf(pick.piece, pick.col, pick.row, pick.flipped).map((cell) => `${cell.col},${cell.row}`))
  }
  const placed = layout.pieces.find((row) => row.id === pick.id)
  if (!placed) return new Set()
  return new Set(cellsOf(placed.piece, placed.col, placed.row, placed.flipped).map((cell) => `${cell.col},${cell.row}`))
}

/**
 * As peças como a tela desenha: a que está sendo movida no lugar da prévia, e a
 * nova (id e slot GHOST_ID) junto das outras.
 */
export function viewPieces(layout: GardenLayout, pick: BuildPick | null): PlacedView[] {
  if (!pick || pick.kind === 'selected') return layout.pieces
  const { col, row, flipped } = pick
  if (pick.kind === 'move') {
    return layout.pieces.map((placed) => (placed.id === pick.id ? { ...placed, col, row, flipped } : placed))
  }
  return [...layout.pieces, { id: GHOST_ID, piece: pick.piece, structureId: pick.structureId, slot: GHOST_ID, col, row, flipped }]
}

/** Prévia nova: a casa livre mais perto do meio do jardim (ou o meio, se nada couber). */
export function startGhost(layout: GardenLayout, piece: PieceKey): BuildGhost {
  const bounds = boundsOf(layout)
  const midCol = (bounds.minCol + bounds.maxCol) / 2
  const midRow = (bounds.minRow + bounds.maxRow) / 2
  let best: BuildGhost | null = null
  let bestDistance = Infinity
  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    for (let col = bounds.minCol; col <= bounds.maxCol; col += 1) {
      if (canPlace(layout.pieces, piece, col, row, undefined, false, bounds) !== null) continue
      const distance = Math.abs(col - midCol) + Math.abs(row - midRow)
      if (distance < bestDistance) {
        bestDistance = distance
        best = { col, row, flipped: false }
      }
    }
  }
  return best ?? { col: Math.floor(midCol), row: Math.floor(midRow), flipped: false }
}

/** Leva a prévia para (col, row), sem sair da grade. */
export function ghostAt<T extends BuildPick>(pick: T, col: number, row: number, bounds: GardenBounds = BASE_BOUNDS): T {
  if (pick.kind === 'selected') return pick
  return {
    ...pick,
    col: Math.min(bounds.maxCol, Math.max(bounds.minCol, col)),
    row: Math.min(bounds.maxRow, Math.max(bounds.minRow, row)),
  }
}

/** Gira a prévia (só bancada e máquina de cura). */
export function turnGhost<T extends BuildPick>(pick: T): T {
  if (pick.kind === 'selected' || !isFlippable(pick.piece)) return pick
  return { ...pick, flipped: !pick.flipped }
}
