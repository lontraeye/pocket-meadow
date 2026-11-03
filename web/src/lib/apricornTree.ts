// Árvore de Apricorn no jardim (PLANNING.md, seção 5.23). Arte provisória em
// pixel art, como os balões (bubbles.ts): uma grade de letras, cada letra uma
// cor, '.' transparente. Os frutos entram em 5 lugares fixos da copa.

import type { Pixel } from './bubbles'

const TREE = [
  '.......GGGGGG.......',
  '.....GGLLLLLLGG.....',
  '....GLLLHHLLLLLG....',
  '...GLLHHLLLLLLLLG...',
  '..GLLHLLLLLLLLLLLG..',
  '..GLLLLLLLLLLLLLLG..',
  '.GLLLLLLLLLLLLLLLLG.',
  '.GLLLLLLLLLLLLLLLLG.',
  '.GLLLLLLLLLLLLLLLDG.',
  '.GLLLLLLLLLLLLLLDDG.',
  '..GLLLLLLLLLLLLDDG..',
  '..GDLLLLLLLLLLDDDG..',
  '...GDDLLLLLLDDDDG...',
  '....GGDDDDDDDDGG....',
  '......GGTTTTGG......',
  '........TTWT........',
  '........TTWT........',
  '........TTWT........',
  '.......TTTTTT.......',
  '......BTTBBTTB......',
]

const FRUIT = ['.K.', 'rRR', 'RRR']

/** Canto de cima de cada fruto, na ordem em que aparecem. */
const FRUIT_SPOTS: { x: number; y: number }[] = [
  { x: 5, y: 5 },
  { x: 12, y: 3 },
  { x: 9, y: 8 },
  { x: 14, y: 8 },
  { x: 4, y: 10 },
]

const COLORS: Record<string, string> = {
  G: '#2f5a2a',
  L: '#5aa040',
  H: '#8ccf5a',
  D: '#3f7a32',
  T: '#7a5232',
  W: '#5a3a22',
  B: '#5a3a22',
  R: '#d83a3a',
  r: '#ff8a7a',
  K: '#3a2a14',
}

export const TREE_W = TREE[0]!.length
export const TREE_H = TREE.length

/** A árvore com `fruits` Apricorns pendurados (0 a 5). */
export function treePixels(fruits: number): Pixel[] {
  const grid = TREE.map((row) => row.split(''))
  for (const spot of FRUIT_SPOTS.slice(0, Math.max(0, fruits))) {
    FRUIT.forEach((row, dy) =>
      row.split('').forEach((cell, dx) => {
        if (cell !== '.') grid[spot.y + dy]![spot.x + dx] = cell
      }),
    )
  }
  const pixels: Pixel[] = []
  grid.forEach((row, y) =>
    row.forEach((cell, x) => {
      const color = COLORS[cell]
      if (color) pixels.push({ x, y, color })
    }),
  )
  return pixels
}
