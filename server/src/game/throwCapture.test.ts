import assert from 'node:assert/strict'
import { test } from 'node:test'
import { battleConfig } from '../config/battle.js'
import { catchChance } from './battle.js'
import { rollThrow, throwRngAt } from './throwCapture.js'

test('mesma seed + mesmo número de lançamentos → mesmos resultados', () => {
  const seed = 42
  const rate = 45
  const first = rollThrow({ encounterSeed: seed, throwIndex: 0, captureRate: rate })
  const again = rollThrow({ encounterSeed: seed, throwIndex: 0, captureRate: rate })
  assert.deepEqual(again, first)

  const second = rollThrow({ encounterSeed: seed, throwIndex: 1, captureRate: rate })
  const secondAgain = rollThrow({ encounterSeed: seed, throwIndex: 1, captureRate: rate })
  assert.deepEqual(secondAgain, second)
})

test('errar sem fugir permite lançar de novo; fugir fecha a sequência', () => {
  // Varre seeds até achar: 1º erro sem fuga, 2º fuga (ou captura).
  let foundMissStay = false
  let foundMissFlee = false
  for (let seed = 1; seed < 5000; seed += 1) {
    const roll = rollThrow({
      encounterSeed: seed,
      throwIndex: 0,
      captureRate: 3,
      fleeChance: 0.5,
    })
    if (!roll.caught && !roll.fled) foundMissStay = true
    if (!roll.caught && roll.fled) foundMissFlee = true
    if (foundMissStay && foundMissFlee) break
  }
  assert.ok(foundMissStay, 'deveria existir erro sem fuga')
  assert.ok(foundMissFlee, 'deveria existir erro com fuga')

  // Depois de um miss-stay, o índice 1 é uma rolagem distinta.
  let seed = 0
  for (let s = 1; s < 5000; s += 1) {
    const first = rollThrow({ encounterSeed: s, throwIndex: 0, captureRate: 3, fleeChance: 0 })
    if (!first.caught && !first.fled) {
      seed = s
      break
    }
  }
  assert.ok(seed > 0)
  const first = rollThrow({ encounterSeed: seed, throwIndex: 0, captureRate: 3, fleeChance: 0 })
  const second = rollThrow({ encounterSeed: seed, throwIndex: 1, captureRate: 3, fleeChance: 0 })
  assert.equal(first.caught, false)
  assert.equal(first.fled, false)
  // A 2ª rolagem não precisa divergir sempre, mas a sequência avança (duas rng() no 1º).
  const rng0 = throwRngAt(seed, 0)
  rng0()
  rng0()
  const rng1 = throwRngAt(seed, 1)
  // Mesmo estado inicial após pular o 1º lançamento.
  assert.equal(rng1(), rng0())
  void second
})

test('catchChance da tentativa bate com a fórmula da 5.6', () => {
  const roll = rollThrow({ encounterSeed: 1, throwIndex: 0, captureRate: 45, berryBonus: 1.5 })
  assert.equal(roll.catchChance, catchChance(45, 1.5))
  assert.ok(roll.catchChance >= battleConfig.catchMin)
  assert.ok(roll.catchChance <= 1)
})

test('bola e berry mudam só a chance; a sequência RNG continua a mesma', () => {
  const seed = 99
  const rate = 45
  const plain = rollThrow({ encounterSeed: seed, throwIndex: 0, captureRate: rate })
  const withBall = rollThrow({
    encounterSeed: seed,
    throwIndex: 0,
    captureRate: rate,
    ballMult: 1.5,
  })
  assert.equal(withBall.catchChance, catchChance(rate, 1, 1.5))
  assert.notEqual(withBall.catchChance, plain.catchChance)

  // Mesmo avanço: after throwIndex 0 miss-stay, throwIndex 1 starts at the same RNG offset.
  let staySeed = 0
  for (let s = 1; s < 8000; s += 1) {
    const first = rollThrow({
      encounterSeed: s,
      throwIndex: 0,
      captureRate: 3,
      fleeChance: 0,
      ballMult: 2,
    })
    if (!first.caught && !first.fled) {
      staySeed = s
      break
    }
  }
  assert.ok(staySeed > 0)
  const rngAfterMiss = throwRngAt(staySeed, 0)
  rngAfterMiss()
  rngAfterMiss()
  const rngAt1 = throwRngAt(staySeed, 1)
  assert.equal(rngAt1(), rngAfterMiss())
})

test('Master Ball: chance 1 e ainda consome a rolagem de captura', () => {
  const roll = rollThrow({
    encounterSeed: 7,
    throwIndex: 0,
    captureRate: 3,
    guaranteed: true,
  })
  assert.equal(roll.catchChance, 1)
  assert.equal(roll.caught, true)
  assert.equal(roll.fled, false)
})

test('qualidade e curva mudam só a chance; a sequência RNG continua a mesma', () => {
  const seed = 55
  const rate = 45
  const plain = rollThrow({ encounterSeed: seed, throwIndex: 0, captureRate: rate, fleeChance: 0 })
  const great = rollThrow({
    encounterSeed: seed,
    throwIndex: 0,
    captureRate: rate,
    throwMult: 1.4,
    fleeChance: 0,
  })
  assert.equal(great.catchChance, catchChance(rate, 1, 1, false, 1.4))
  assert.notEqual(great.catchChance, plain.catchChance)

  let stay = 0
  for (let s = 1; s < 8000; s += 1) {
    const first = rollThrow({
      encounterSeed: s,
      throwIndex: 0,
      captureRate: 3,
      fleeChance: 0,
      throwMult: 1.8 * 1.3,
    })
    if (!first.caught && !first.fled) {
      stay = s
      break
    }
  }
  assert.ok(stay > 0)
  const rngAfter = throwRngAt(stay, 0)
  rngAfter()
  rngAfter()
  const rngAt1 = throwRngAt(stay, 1)
  assert.equal(rngAt1(), rngAfter())
})
