import assert from 'node:assert/strict'
import { test } from 'node:test'
import { harvestTree, settleTree, treeReadyTimes, treeUnitMs } from './apricornTree.js'
import { nextWeatherChangeAt, weatherDay } from './weather.js'

const hourMs = 60 * 60 * 1000
const config = { unlockLevel: 2, intervalMs: 3 * hourMs, cap: 5, rainMult: 0.6, startWith: 1 }
// Meio-dia em Brasília: o dia só vira daqui a 12 h.
const noon = nextWeatherChangeAt(Date.UTC(2026, 10, 3, 12)) - 12 * hourMs

test('um Apricorn a cada 3 h, parando em 5', () => {
  const sunny = () => 'sunny' as const
  assert.equal(settleTree(0, noon, noon + 3 * hourMs, sunny, config), 1)
  assert.equal(settleTree(0.5, noon, noon + 6 * hourMs, sunny, config), 2.5)
  assert.equal(settleTree(0, noon, noon + 100 * hourMs, sunny, config), 5)
  assert.equal(settleTree(5, noon, noon + hourMs, sunny, config), 5)
})

test('chuva acelera, e cada dia conta com o próprio clima', () => {
  assert.equal(treeUnitMs('rain', config), 1.8 * hourMs)
  const today = weatherDay(noon)
  // Hoje (12 h restantes) chove; amanhã faz sol.
  const weatherOf = (day: number) => (day === today ? ('rain' as const) : ('sunny' as const))
  // 12 h de chuva = 6,67 → para em 5.
  assert.equal(settleTree(0, noon, noon + 12 * hourMs, weatherOf, config), 5)
  // 3,6 h de chuva (2) + 3 h de sol (1) atravessando a meia-noite.
  const start = noon + 12 * hourMs - 3.6 * hourMs
  assert.ok(Math.abs(settleTree(0, start, start + 6.6 * hourMs, weatherOf, config) - 3) < 1e-9)
})

test('horários dos próximos até encher, pelo clima de hoje', () => {
  assert.deepEqual(treeReadyTimes(3.5, noon, 'sunny', config), [noon + 1.5 * hourMs, noon + 4.5 * hourMs])
  assert.deepEqual(treeReadyTimes(5, noon, 'sunny', config), [])
  assert.equal(treeReadyTimes(0, noon, 'rain', config)[0], noon + 1.8 * hourMs)
})

test('colher leva os inteiros e guarda a fração', () => {
  assert.deepEqual(harvestTree(3.25), { harvested: 3, progress: 0.25 })
  assert.deepEqual(harvestTree(0.9), { harvested: 0, progress: 0.9 })
})
