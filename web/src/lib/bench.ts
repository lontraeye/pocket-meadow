// Bancada de bolas no jardim (PLANNING.md, seção 5.23). Arte provisória em
// pixel art, como a árvore (apricornTree.ts): uma mesa de madeira com um
// Apricorn e uma Poké Ball em cima.

import type { BenchView } from './api'
import type { Pixel } from './bubbles'

const BENCH = [
  '...K..........KK..',
  '..rRR........KRRK.',
  '..RRR........KWWK.',
  '..............KK..',
  '.OOOOOOOOOOOOOOOO.',
  '.OwwwwwwwwwwwwwwO.',
  '.OWWWWWWWWWWWWWWO.',
  '.OOOOOOOOOOOOOOOO.',
  '..OT..........TO..',
  '..OT..........TO..',
  '..OT..........TO..',
  '..OO..........OO..',
]

const COLORS: Record<string, string> = {
  O: '#3a2a14',
  w: '#c08a52',
  W: '#9a6a3a',
  T: '#7a5232',
  R: '#d83a3a',
  r: '#ff8a7a',
  K: '#2a2a2a',
}
// A bola: em cima vermelha, embaixo branca (W na fileira da bola).
const BALL_WHITE = '#f4f4f4'

export const BENCH_W = BENCH[0]!.length
export const BENCH_H = BENCH.length

export function benchPixels(): Pixel[] {
  const pixels: Pixel[] = []
  BENCH.forEach((row, y) =>
    row.split('').forEach((cell, x) => {
      const color = y < 4 && cell === 'W' ? BALL_WHITE : COLORS[cell]
      if (color) pixels.push({ x, y, color })
    }),
  )
  return pixels
}

/** Quantas do lote já ficaram prontas em `now` (igual ao servidor). */
export function benchDone(job: Pick<NonNullable<BenchView['job']>, 'quantity' | 'unitMs' | 'startedAt'>, now: number): number {
  return Math.max(0, Math.min(job.quantity, Math.floor((now - job.startedAt) / job.unitMs)))
}
