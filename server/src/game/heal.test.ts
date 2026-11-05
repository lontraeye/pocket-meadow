import assert from 'node:assert/strict'
import test from 'node:test'
import { healConfig } from '../config/heal.js'
import { clampRatio, nextHealChargeAt, restHpRatio, settleHealCharges, settleHp } from './heal.js'

const hourMs = 60 * 60 * 1000

test('descanso: do 0 ao cheio em restFullMs', () => {
  assert.equal(restHpRatio(0, 0), 0)
  const full = healConfig.restFullMs
  assert.equal(restHpRatio(0, full), 1)
  assert.equal(restHpRatio(0, full / 2), 0.5)
  assert.equal(restHpRatio(0.25, full / 2), 0.75)
  assert.equal(restHpRatio(0.9, full), 1)
})

test('cargas da máquina: uma de cada vez pelo timestamp', () => {
  const t0 = 1_000_000
  assert.equal(settleHealCharges(0, t0, t0), 0)
  const recharge = healConfig.machine.rechargeMs
  assert.equal(settleHealCharges(0, t0, t0 + recharge), 1)
  assert.equal(settleHealCharges(0, t0, t0 + 2 * recharge), 2)
  assert.equal(settleHealCharges(3.5, t0, t0 + 3 * hourMs, 4, 3 * hourMs), 4)
  assert.equal(settleHealCharges(4, t0, t0 + 100 * hourMs), 4)
})

test('desmaiado não descansa; depois de 2 h volta com 0,1 e o jardim segue', () => {
  const t0 = 1_000_000
  const wake = t0 + healConfig.faintRecoverMs
  const hour = 60 * 60 * 1000
  const still = settleHp(0, t0, t0, t0 + hour, true)
  assert.equal(still.hpRatio, 0)
  assert.equal(still.faintedAt, t0)

  const outside = settleHp(0, t0, t0, wake + healConfig.restFullMs, false)
  assert.equal(outside.hpRatio, healConfig.faintRecoverRatio)
  assert.equal(outside.faintedAt, null)
  assert.equal(outside.hpUpdatedAt, null)
  // Fora do jardim o HP fica parado depois de acordar.
  const later = settleHp(outside.hpRatio, null, null, wake + 2 * healConfig.restFullMs, false)
  assert.equal(later.hpRatio, healConfig.faintRecoverRatio)

  const half = settleHp(0, t0, t0, wake + healConfig.restFullMs / 2, true)
  assert.equal(half.faintedAt, null)
  assert.equal(half.hpRatio, healConfig.faintRecoverRatio + 0.5)
  const full = settleHp(0, t0, t0, wake + healConfig.restFullMs, true)
  assert.equal(full.hpRatio, 1)
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
