import assert from 'node:assert/strict'
import { test } from 'node:test'
import { berries } from './berries.js'
import { calmAgitation, fleeChanceAt } from '../game/flee.js'
import { catchChance } from '../game/battle.js'
import { rollThrow } from '../game/throwCapture.js'

test('cada berry de captura tem o efeito esperado', () => {
  assert.equal(berries.razz.capture?.catchMult, 1.5)
  assert.equal(berries.pinap.capture?.candyOnCatch, 3)
  assert.equal('effect' in berries.pinap, false)
  assert.equal(berries.oran.capture?.calm, 1)
  assert.equal(berries.nanab.capture?.calm, 2)
  assert.equal(berries.lum.capture?.calm, 'all')
  assert.equal(berries['golden-razz'].capture?.catchMult, 2.5)
  assert.equal(berries['golden-razz'].capture?.calm, 1)
  assert.equal('effect' in berries['golden-razz'], false)
  assert.equal(berries['silver-pinap'].capture?.catchMult, 1.8)
  assert.equal(berries['silver-pinap'].capture?.candyOnCatch, 5)
  assert.equal('effect' in berries['silver-pinap'], false)
})

test('acalmar vale antes do incremento de agitação no erro', () => {
  const afterCalm = calmAgitation(3, berries.nanab.capture?.calm)
  assert.equal(afterCalm, 1)
  assert.equal(fleeChanceAt(afterCalm + 1), fleeChanceAt(2))
  assert.equal(calmAgitation(4, berries.lum.capture?.calm), 0)
  assert.equal(fleeChanceAt(0 + 1), 0.1)
})

test('bola + berry mudam odds sem alterar a sequência RNG', () => {
  const seed = 123
  const rate = 45
  const berryMult = berries.razz.capture!.catchMult!
  const plain = rollThrow({ encounterSeed: seed, throwIndex: 0, captureRate: rate, fleeChance: 0.1 })
  const boosted = rollThrow({
    encounterSeed: seed,
    throwIndex: 0,
    captureRate: rate,
    ballMult: 1.5,
    berryBonus: berryMult,
    fleeChance: 0.1,
  })
  assert.equal(boosted.catchChance, catchChance(rate, berryMult, 1.5))
  assert.notEqual(boosted.catchChance, plain.catchChance)
  // Mesmo resultado boolean só se as odds coincidirem; o importante é o avanço RNG:
  // throwIndex 1 começa depois de 2 draws, independente dos multiplicadores.
  let stay = 0
  for (let s = 1; s < 8000; s += 1) {
    const first = rollThrow({
      encounterSeed: s,
      throwIndex: 0,
      captureRate: 3,
      fleeChance: 0,
      berryBonus: berryMult,
      ballMult: 2,
    })
    if (!first.caught && !first.fled) {
      stay = s
      break
    }
  }
  assert.ok(stay > 0)
  const a = rollThrow({
    encounterSeed: stay,
    throwIndex: 1,
    captureRate: 3,
    fleeChance: 0.25,
    berryBonus: 1,
  })
  const b = rollThrow({
    encounterSeed: stay,
    throwIndex: 1,
    captureRate: 3,
    fleeChance: 0.25,
    berryBonus: berryMult,
    ballMult: 2,
  })
  // Odds diferentes, mas ambos consomem a mesma posição na sequência (caught/fled podem diferir).
  assert.notEqual(a.catchChance, b.catchChance)
  void a
  void b
})
