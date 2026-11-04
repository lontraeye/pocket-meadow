// Caminho relativo (não o alias @garden) para os testes rodarem com o tsx puro.
import { canPlace, cellsOf, GARDEN_COLS, GARDEN_ROWS, type PieceKey } from '../../../server/src/game/garden/layout'
import type { GardenLayout } from './api'

// Modo Construir do jardim (PROGRESSAO.md 4.3): o que está escolhido e onde dá
// para pôr. As casas são as da grade jogável (0..11), como no servidor.

export type BuildPick =
  | { kind: 'new'; piece: PieceKey }
  | { kind: 'selected'; id: number; piece: PieceKey }
  | { kind: 'move'; id: number; piece: PieceKey }

/** A peça colocada que ocupa a casa (pela pegada inteira). */
export function pieceAtCell(layout: GardenLayout, col: number, row: number): GardenLayout['pieces'][number] | null {
  return (
    layout.pieces.find((placed) =>
      cellsOf(placed.piece, placed.col, placed.row).some((cell) => cell.col === col && cell.row === row),
    ) ?? null
  )
}

/** Casas onde a peça escolhida pode ficar (a âncora): `${col},${row}`. */
export function validAnchors(layout: GardenLayout, pick: BuildPick | null): Set<string> {
  const out = new Set<string>()
  if (!pick || pick.kind === 'selected') return out
  const ignoreId = pick.kind === 'move' ? pick.id : undefined
  for (let row = 0; row < GARDEN_ROWS; row += 1) {
    for (let col = 0; col < GARDEN_COLS; col += 1) {
      if (canPlace(layout.pieces, pick.piece, col, row, ignoreId) === null) out.add(`${col},${row}`)
    }
  }
  return out
}

/** Casas da peça selecionada (ou sendo movida), para destacar. */
export function pickedCells(layout: GardenLayout, pick: BuildPick | null): Set<string> {
  if (!pick || pick.kind === 'new') return new Set()
  const placed = layout.pieces.find((row) => row.id === pick.id)
  if (!placed) return new Set()
  return new Set(cellsOf(placed.piece, placed.col, placed.row).map((cell) => `${cell.col},${cell.row}`))
}
