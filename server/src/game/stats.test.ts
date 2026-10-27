import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcStats, ivRating } from './stats.js'

test('Garchomp Nv 78 Adamant bate o exemplo do Bulbapedia', () => {
  const stats = calcStats({
    base: { hp: 108, attack: 130, defense: 95, spAttack: 80, spDefense: 85, speed: 102 },
    ivs: { hp: 24, attack: 12, defense: 30, spAttack: 16, spDefense: 23, speed: 5 },
    evs: { hp: 74, attack: 190, defense: 91, spAttack: 48, spDefense: 84, speed: 23 },
    level: 78,
    nature: 'adamant',
  })
  assert.deepEqual(stats, {
    hp: 289,
    attack: 278,
    defense: 193,
    spAttack: 135,
    spDefense: 171,
    speed: 171,
  })
})

test('ivRating usa o máximo 186', () => {
  const perfect = ivRating({ hp: 31, attack: 31, defense: 31, spAttack: 31, spDefense: 31, speed: 31 })
  assert.equal(perfect.total, 186)
  assert.equal(perfect.percent, 100)
  assert.equal(perfect.stars, 5)

  const zero = ivRating({ hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 })
  assert.equal(zero.percent, 0)
  assert.equal(zero.stars, 0)
})
