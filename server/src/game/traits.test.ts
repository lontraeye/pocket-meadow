import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mulberry32 } from './rng.js'
import {
  applyLearnedMoves,
  canLearnMove,
  isFastMove,
  moveLearnOffers,
  resolveAbilityKey,
  rollTraits,
  traitsRngSeed,
} from './traits.js'

const moves = new Map([
  ['scratch', { name: 'scratch', displayName: 'Scratch', type: 'normal', power: 40, damageClass: 'physical' as const }],
  ['ember', { name: 'ember', displayName: 'Ember', type: 'fire', power: 40, damageClass: 'special' as const }],
  ['flamethrower', { name: 'flamethrower', displayName: 'Flamethrower', type: 'fire', power: 90, damageClass: 'special' as const }],
  ['slash', { name: 'slash', displayName: 'Slash', type: 'normal', power: 70, damageClass: 'physical' as const }],
  ['fire-spin', { name: 'fire-spin', displayName: 'Fire Spin', type: 'fire', power: 35, damageClass: 'special' as const }],
  ['tackle', { name: 'tackle', displayName: 'Tackle', type: 'normal', power: 40, damageClass: 'physical' as const }],
])

const learnset = [
  { move: 'scratch', level: 1 },
  { move: 'ember', level: 7 },
  { move: 'slash', level: 20 },
  { move: 'flamethrower', level: 31 },
]

test('isFastMove corta em 55', () => {
  assert.equal(isFastMove(55), true)
  assert.equal(isFastMove(56), false)
})

test('rollTraits é determinístico pela seed derivada', () => {
  const seed = traitsRngSeed(42)
  const input = {
    level: 5,
    learnset,
    abilities: { slot1: 'blaze', slot2: null, hidden: 'solar-power' },
    moves,
  }
  const a = rollTraits(mulberry32(seed), input)
  const b = rollTraits(mulberry32(seed), input)
  assert.deepEqual(a, b)
  assert.equal(a.evs.attack, 0)
  assert.ok(a.ivs.hp >= 0 && a.ivs.hp <= 31)
  assert.equal(a.chargedMove, null)
  assert.equal(a.fastMove, 'scratch')
})

test('sem rápido no nível usa o primeiro da espécie ou tackle', () => {
  const rolled = rollTraits(mulberry32(1), {
    level: 1,
    learnset: [{ move: 'flamethrower', level: 1 }],
    abilities: { slot1: 'blaze', slot2: null, hidden: null },
    moves,
  })
  assert.equal(rolled.fastMove, 'tackle')
  assert.equal(rolled.chargedMove, 'flamethrower')
})

test('resolveAbilityKey cai na 1ª sem segunda ou oculta', () => {
  assert.equal(resolveAbilityKey({ slot1: 'blaze', slot2: null, hidden: 'solar-power' }, '2'), 'blaze')
  assert.equal(resolveAbilityKey({ slot1: 'blaze', slot2: null, hidden: 'solar-power' }, 'hidden'), 'solar-power')
})

test('canLearnMove aceita só o pool até o nível', () => {
  assert.equal(canLearnMove(learnset, 5, 'scratch', moves), true)
  assert.equal(canLearnMove(learnset, 5, 'flamethrower', moves), false)
  assert.equal(canLearnMove(learnset, 31, 'flamethrower', moves), true)
})

test('slot de carregado vazio é preenchido sozinho ao aprender carregado', () => {
  const result = applyLearnedMoves({
    fromLevel: 19,
    toLevel: 20,
    learnset,
    moves,
    fastMove: 'scratch',
    chargedMove: null,
  })
  assert.equal(result.chargedMove, 'slash')
  assert.deepEqual(result.offers, [])
})

test('troca só é oferecida quando já há golpe no slot', () => {
  const result = applyLearnedMoves({
    fromLevel: 19,
    toLevel: 31,
    learnset,
    moves,
    fastMove: 'scratch',
    chargedMove: 'slash',
  })
  assert.equal(result.chargedMove, 'slash')
  assert.deepEqual(
    result.offers.map((entry) => entry.move),
    ['flamethrower'],
  )
})

test('daycare subindo vários níveis: primeiro carregado entra, o resto oferece', () => {
  const result = applyLearnedMoves({
    fromLevel: 5,
    toLevel: 31,
    learnset,
    moves,
    fastMove: 'scratch',
    chargedMove: null,
  })
  assert.equal(result.chargedMove, 'slash')
  assert.deepEqual(
    result.offers.map((entry) => entry.move),
    ['ember', 'flamethrower'],
  )
})

test('moveLearnOffers no estado já atualizado bate com o pós-apply', () => {
  const applied = applyLearnedMoves({
    fromLevel: 5,
    toLevel: 31,
    learnset,
    moves,
    fastMove: 'scratch',
    chargedMove: null,
  })
  const offers = moveLearnOffers({
    fromLevel: 5,
    toLevel: 31,
    learnset,
    moves,
    fastMove: 'scratch',
    chargedMove: applied.chargedMove,
  })
  assert.deepEqual(
    offers.map((entry) => entry.move),
    applied.offers.map((entry) => entry.move),
  )
})
