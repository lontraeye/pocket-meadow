import assert from 'node:assert/strict'
import { test } from 'node:test'
import { benchLevelAt, gardenUnlocks, nextCapAt, nextDaycareSlotAt, nextPlotsAt, pieceUnlockAt, recipeUnlockAt } from './gardenUnlocks.js'

test('começo: bancada, árvore vermelha e máquina de cura; 4 canteiros, 1 vaga, bancada nível 1', () => {
  const start = gardenUnlocks(new Set())
  assert.deepEqual([...start.pieces].sort(), ['apricorn_tree', 'ball_bench', 'heal_machine'])
  assert.deepEqual([start.plotLimit, start.daycareSlots, start.benchMaxLevel], [4, 1, 1])
})

test('os marcos somam pela tabela do 4.3', () => {
  const mid = gardenUnlocks(new Set(['violet', 'azalea', 'goldenrod', 'ecruteak', 'cianwood']))
  assert.ok(mid.pieces.has('apricorn_tree_blue'))
  assert.ok(!mid.pieces.has('apricorn_tree_yellow'))
  assert.deepEqual([mid.plotLimit, mid.daycareSlots, mid.benchMaxLevel], [8, 3, 2])
  const all = gardenUnlocks(new Set(['azalea', 'goldenrod', 'ecruteak', 'cianwood', 'olivine', 'mahogany', 'blackthorn']))
  assert.deepEqual([all.plotLimit, all.daycareSlots, all.benchMaxLevel], [12, 4, 3])
})

test('o próximo marco de cada coisa, para o cadeado', () => {
  const none = new Set<string>()
  assert.equal(pieceUnlockAt(none, 'apricorn_tree_yellow')?.milestone, 'olivine')
  assert.equal(pieceUnlockAt(none, 'ball_bench'), null)
  assert.deepEqual(nextPlotsAt(none), { milestone: 'azalea', name: 'Marco de Azalea', plots: 6 })
  assert.equal(nextDaycareSlotAt(new Set(['azalea']))?.milestone, 'cianwood')
  assert.equal(benchLevelAt(none, 2)?.milestone, 'goldenrod')
  assert.equal(benchLevelAt(new Set(['goldenrod']), 2), null)
  assert.equal(nextPlotsAt(new Set(['blackthorn'])), null)
})

test('receitas e teto por marco', () => {
  const start = gardenUnlocks(new Set())
  assert.equal(start.recipes.size, 0)
  assert.deepEqual([start.capOf('apricorn_tree'), start.capOf('ball_bench'), start.capOf('heal_machine')], [1, 1, 1])
  const late = gardenUnlocks(new Set(['azalea', 'ecruteak', 'cianwood', 'blackthorn']))
  assert.deepEqual([...late.recipes].sort(), ['apricorn_tree', 'ball_bench', 'heal_machine'])
  assert.deepEqual([late.capOf('apricorn_tree'), late.capOf('heal_machine'), late.capOf('ball_bench')], [3, 2, 2])
  assert.equal(late.capOf('apricorn_tree_blue'), 1)
  assert.equal(recipeUnlockAt(new Set(), 'heal_machine')?.milestone, 'cianwood')
  assert.deepEqual(nextCapAt(new Set(['azalea']), 'apricorn_tree'), { milestone: 'ecruteak', name: 'Marco de Ecruteak', cap: 3 })
})
