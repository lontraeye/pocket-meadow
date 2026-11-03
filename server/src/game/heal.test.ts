import assert from 'node:assert/strict'
import test from 'node:test'
import { clampRatio, nextHealChargeAt, restHpRatio, settleHealCharges } from './heal.js'

const hourMs = 60 * 60 * 1000

test('descanso: do 0 ao cheio em restFullMs', () => {
  assert.equal(restHpRatio(0, 0), 0)
  assert.equal(restHpRatio(0, 2 * hourMs), 1)
  assert.equal(restHpRatio(0, hourMs), 0.5)
  assert.equal(restHpRatio(0.25, hourMs), 0.75)
  assert.equal(restHpRatio(0.9, 2 * hourMs), 1)
})

test('cargas da máquina: uma de cada vez pelo timestamp', () => {
  const t0 = 1_000_000
  assert.equal(settleHealCharges(0, t0, t0), 0)
  assert.equal(settleHealCharges(0, t0, t0 + 3 * hourMs), 1)
  assert.equal(settleHealCharges(0, t0, t0 + 6 * hourMs), 2)
  assert.equal(settleHealCharges(3.5, t0, t0 + 3 * hourMs, 4, 3 * hourMs), 4)
  assert.equal(settleHealCharges(4, t0, t0 + 100 * hourMs), 4)
})

test('próxima carga e clamp', () => {
  const now = 5_000_000
  assert.equal(nextHealChargeAt(4, now), null)
  assert.equal(nextHealChargeAt(3, now, 4, 3 * hourMs), now + 3 * hourMs)
  assert.equal(nextHealChargeAt(2.5, now, 4, 3 * hourMs), Math.ceil(now + 0.5 * 3 * hourMs))
  assert.equal(clampRatio(-1), 0)
  assert.equal(clampRatio(2), 1)
  assert.equal(clampRatio(0.4), 0.4)
})
