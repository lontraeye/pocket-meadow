import assert from 'node:assert/strict'
import { test } from 'node:test'
import { battleConfig, parseThrowQuality, throwAimMult } from './battle.js'
import { catchChance } from '../game/battle.js'

test('multiplicadores de qualidade e curva', () => {
  assert.equal(throwAimMult('normal', false), 1)
  assert.equal(throwAimMult('nice', false), 1.15)
  assert.equal(throwAimMult('great', false), 1.4)
  assert.equal(throwAimMult('excellent', false), 1.8)
  assert.equal(throwAimMult('normal', true), battleConfig.throwCurveMult)
  assert.equal(throwAimMult('excellent', true), 1.8 * 1.3)
})

test('parseThrowQuality aceita só os quatro valores', () => {
  assert.equal(parseThrowQuality('nice'), 'nice')
  assert.equal(parseThrowQuality('bad'), null)
  assert.equal(parseThrowQuality(1), null)
  assert.equal(parseThrowQuality(undefined), null)
})

test('catchChance aplica throwMult depois da bola/berry', () => {
  const base = catchChance(45, 1, 1.5, false, 1)
  const great = catchChance(45, 1, 1.5, false, throwAimMult('great', false))
  assert.ok(great > base)
  assert.equal(great, catchChance(45, 1, 1.5, false, 1.4))
})
