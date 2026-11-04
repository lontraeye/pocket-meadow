// Construção do jardim (PROGRESSAO.md, 4.3 / item 6, passo 1): cada peça
// colocada ocupa casas da grade jogável (0..cols-1, 0..rows-1). Módulo puro,
// compartilhado com a tela (alias @garden), como a simulação da luta.

export const GARDEN_COLS = 12
export const GARDEN_ROWS = 12

export type StructurePiece =
  | 'ball_bench'
  | 'heal_machine'
  | 'apricorn_tree'
  | 'apricorn_tree_blue'
  | 'apricorn_tree_yellow'

export type PieceKey = 'berry_plot' | StructurePiece

export type Cell = { col: number; row: number }

export type PieceDef = {
  key: PieceKey
  name: string
  /** Casas que a peça ocupa, a partir da casa dela (a âncora). */
  footprint: readonly { dc: number; dr: number }[]
  /** Pode girar (espelhar o sprite para o outro lado). */
  flippable?: true
}

const single = [{ dc: 0, dr: 0 }] as const

export const PIECES: Record<PieceKey, PieceDef> = {
  berry_plot: { key: 'berry_plot', name: 'Canteiro', footprint: single },
  // A casa à esquerda é onde o operador fica, virado para a máquina.
  ball_bench: {
    key: 'ball_bench',
    name: 'Bancada de bolas',
    footprint: [{ dc: 0, dr: 0 }, { dc: -1, dr: 0 }],
    flippable: true,
  },
  heal_machine: { key: 'heal_machine', name: 'Máquina de cura', footprint: single, flippable: true },
  apricorn_tree: { key: 'apricorn_tree', name: 'Árvore de Apricorn', footprint: single },
  apricorn_tree_blue: { key: 'apricorn_tree_blue', name: 'Árvore de Apricorn azul', footprint: single },
  apricorn_tree_yellow: { key: 'apricorn_tree_yellow', name: 'Árvore de Apricorn amarelo', footprint: single },
}

export const STRUCTURE_PIECES: readonly StructurePiece[] = [
  'heal_machine',
  'ball_bench',
  'apricorn_tree',
  'apricorn_tree_blue',
  'apricorn_tree_yellow',
]

export function isPieceKey(value: unknown): value is PieceKey {
  return typeof value === 'string' && value in PIECES
}

export type PlacedPiece = { id: number; piece: PieceKey; col: number; row: number; flipped: boolean }

export function isFlippable(piece: PieceKey): boolean {
  return PIECES[piece].flippable === true
}

/**
 * Casas da peça com a âncora em (col, row). Espelhar na tela troca coluna por
 * linha (x = col − row), então a peça girada troca dc por dr: a casa do
 * operador da bancada sai de cima à esquerda para cima à direita.
 */
export function cellsOf(piece: PieceKey, col: number, row: number, flipped = false): Cell[] {
  return PIECES[piece].footprint.map((offset) =>
    flipped && isFlippable(piece)
      ? { col: col + offset.dr, row: row + offset.dc }
      : { col: col + offset.dc, row: row + offset.dr },
  )
}

export function inBounds(cell: Cell): boolean {
  return cell.col >= 0 && cell.col < GARDEN_COLS && cell.row >= 0 && cell.row < GARDEN_ROWS
}

export const cellKey = (col: number, row: number): string => `${col},${row}`

/** Casas ocupadas pelas peças (menos a `ignoreId`, a que está sendo movida). */
export function occupied(pieces: readonly PlacedPiece[], ignoreId?: number): Set<string> {
  const taken = new Set<string>()
  for (const placed of pieces) {
    if (placed.id === ignoreId) continue
    for (const cell of cellsOf(placed.piece, placed.col, placed.row, placed.flipped)) taken.add(cellKey(cell.col, cell.row))
  }
  return taken
}

export type PlaceError = 'out_of_bounds' | 'occupied'

/** Se a peça cabe com a âncora em (col, row). `ignoreId`: a própria peça, ao mover; `flipped`: girada. */
export function canPlace(
  pieces: readonly PlacedPiece[],
  piece: PieceKey,
  col: number,
  row: number,
  ignoreId?: number,
  flipped = false,
): PlaceError | null {
  const cells = cellsOf(piece, col, row, flipped)
  if (!cells.every(inBounds)) return 'out_of_bounds'
  const taken = occupied(pieces, ignoreId)
  if (cells.some((cell) => taken.has(cellKey(cell.col, cell.row)))) return 'occupied'
  return null
}

/**
 * O jardim de antes da construção (horta 2×2 no canto de baixo e as estruturas
 * na fileira ao lado): é onde as peças de quem já joga ficam na migração, e
 * onde as primeiras peças de uma conta nova aparecem.
 */
export const DEFAULT_LAYOUT = {
  /** Canteiros na ordem dos índices antigos (0..3). */
  plots: [
    { col: 1, row: 9 },
    { col: 2, row: 9 },
    { col: 1, row: 10 },
    { col: 2, row: 10 },
  ],
  structures: {
    apricorn_tree: { col: 4, row: 10 },
    ball_bench: { col: 6, row: 10 },
    heal_machine: { col: 7, row: 10 },
    apricorn_tree_blue: { col: 8, row: 10 },
    apricorn_tree_yellow: { col: 10, row: 10 },
  } satisfies Record<StructurePiece, Cell>,
} as const
