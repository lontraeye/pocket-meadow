import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GardenLayout } from './api.ts'
import { GHOST_ID, ghostAt, ghostFits, pickedCells, pieceAtCell, startGhost, turnGhost, validAnchors, viewPieces } from './build.ts'

const layout: GardenLayout = {
  cols: 12,
  rows: 12,
  pieces: [
    { id: 1, piece: 'ball_bench', slot: 0, col: 6, row: 10, flipped: false },
    { id: 2, piece: 'berry_plot', slot: 0, col: 1, row: 9, flipped: false },
  ],
  stored: ['apricorn_tree'],
  plotLimit: 2,
  plotsPlaced: 1,
}

test('a casa do operador também é da bancada', () => {
  assert.equal(pieceAtCell(layout.pieces, 5, 10)?.id, 1)
  assert.equal(pieceAtCell(layout.pieces, 6, 10)?.id, 1)
  assert.equal(pieceAtCell(layout.pieces, 7, 10), null)
})

test('casas válidas: livres, dentro da grade, pela pegada', () => {
  const tree = validAnchors(layout, { kind: 'new', piece: 'apricorn_tree', col: 0, row: 0, flipped: false })
  assert.equal(tree.size, 144 - 3)
  const bench = validAnchors(layout, { kind: 'move', id: 1, piece: 'ball_bench', col: 6, row: 10, flipped: false })
  assert.ok(!bench.has('0,0'), 'a casa do operador sairia da grade')
  assert.ok(bench.has('6,10'), 'pode ficar onde está')
  assert.ok(!bench.has('2,9'), 'o operador cairia no canteiro')
  assert.deepEqual([...pickedCells(layout, { kind: 'selected', id: 1, piece: 'ball_bench' })].sort(), ['5,10', '6,10'])
})

test('girada, a bancada põe o operador em cima à direita (col, row − 1)', () => {
  const move = { kind: 'move', id: 1, piece: 'ball_bench', col: 6, row: 10, flipped: false } as const
  const turned = turnGhost(move)
  assert.equal(turned.flipped, true)
  assert.deepEqual([...pickedCells(layout, turned)].sort(), ['6,10', '6,9'].sort())
  const turnedBench = validAnchors(layout, turned)
  assert.ok(!turnedBench.has('3,0'), 'o operador sairia por cima')
  assert.ok(turnedBench.has('0,5'), 'na beira esquerda cabe')
  // Árvore não gira.
  const tree = { kind: 'new', piece: 'apricorn_tree', col: 3, row: 3, flipped: false } as const
  assert.equal(turnGhost(tree).flipped, false)
})

test('prévia: desenhada no lugar da peça, presa à grade, e diz se cabe', () => {
  const move = ghostAt({ kind: 'move', id: 1, piece: 'ball_bench', col: 6, row: 10, flipped: false } as const, 20, -3)
  assert.deepEqual([move.col, move.row], [11, 0])
  assert.deepEqual(
    viewPieces(layout, move).find((row) => row.id === 1),
    { id: 1, piece: 'ball_bench', slot: 0, col: 11, row: 0, flipped: false },
  )
  assert.equal(ghostFits(layout, move), true)
  assert.equal(ghostFits(layout, ghostAt(move, 2, 9)), false, 'o operador cairia no canteiro')

  const plot = { kind: 'new', piece: 'berry_plot', ...startGhost(layout, 'berry_plot') } as const
  assert.equal(ghostFits(layout, plot), true)
  assert.equal(viewPieces(layout, plot).at(-1)?.id, GHOST_ID)
  assert.equal(viewPieces(layout, null), layout.pieces)
})
