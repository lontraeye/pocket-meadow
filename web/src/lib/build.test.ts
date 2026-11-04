import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GardenLayout } from './api.ts'
import { pickedCells, pieceAtCell, validAnchors } from './build.ts'

const layout: GardenLayout = {
  cols: 12,
  rows: 12,
  pieces: [
    { id: 1, piece: 'ball_bench', slot: 0, col: 6, row: 10 },
    { id: 2, piece: 'berry_plot', slot: 0, col: 1, row: 9 },
  ],
  stored: ['apricorn_tree'],
  plotLimit: 2,
  plotsPlaced: 1,
}

test('a casa do operador também é da bancada', () => {
  assert.equal(pieceAtCell(layout, 5, 10)?.id, 1)
  assert.equal(pieceAtCell(layout, 6, 10)?.id, 1)
  assert.equal(pieceAtCell(layout, 7, 10), null)
})

test('casas válidas: livres, dentro da grade, pela pegada', () => {
  const tree = validAnchors(layout, { kind: 'new', piece: 'apricorn_tree' })
  assert.equal(tree.size, 144 - 3)
  const bench = validAnchors(layout, { kind: 'move', id: 1, piece: 'ball_bench' })
  assert.ok(!bench.has('0,0'), 'a casa do operador sairia da grade')
  assert.ok(bench.has('6,10'), 'pode ficar onde está')
  assert.ok(!bench.has('2,9'), 'o operador cairia no canteiro')
  assert.deepEqual([...pickedCells(layout, { kind: 'selected', id: 1, piece: 'ball_bench' })].sort(), ['5,10', '6,10'])
})
