import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  accumulateSpin,
  agitationOffset,
  beginFlight,
  hitTest,
  isSimpleTap,
  isSpinning,
  qualityFromRing,
  ringFracAt,
  sampleVelocity,
  shouldLaunch,
  stepFlight,
  THROW_PHYSICS,
} from './throwPhysics.js'

test('sampleVelocity usa a janela recente', () => {
  const v = sampleVelocity([
    { t: 0, x: 0, y: 100 },
    { t: 40, x: 0, y: 60 },
    { t: 80, x: 0, y: 20 },
  ])
  assert.ok(-v.vy > 900)
})

test('shouldLaunch exige velocidade para cima', () => {
  assert.equal(shouldLaunch(-THROW_PHYSICS.minUpSpeedPx), true)
  assert.equal(shouldLaunch(-THROW_PHYSICS.minUpSpeedPx + 1), false)
  assert.equal(shouldLaunch(100), false)
})

test('giro de uma volta marca spinning', () => {
  let spin: import('./throwPhysics.js').SpinState = {
    lastAngle: null,
    accumulated: 0,
    direction: 0,
  }
  const cx = 0
  const cy = 0
  // 8 passos de 45° no sentido anti-horário.
  for (let i = 0; i <= 8; i += 1) {
    const a = (i / 8) * Math.PI * 2
    spin = accumulateSpin(spin, cx, cy, Math.cos(a) * 10, Math.sin(a) * 10)
  }
  assert.ok(isSpinning(spin))
  assert.equal(spin.direction, 1)
})

test('anel: qualidade pelas faixas', () => {
  const maxR = 100
  assert.equal(qualityFromRing(5, maxR, 0.2), 'excellent')
  assert.equal(qualityFromRing(5, maxR, 0.4), 'great')
  assert.equal(qualityFromRing(5, maxR, 0.8), 'nice')
  assert.equal(qualityFromRing(90, maxR, 0.5), 'normal')
})

test('ringFrac oscila entre 0 e 1', () => {
  assert.equal(ringFracAt(0), 1)
  assert.ok(ringFracAt(THROW_PHYSICS.ringPeriodMs / 2) < 0.05)
  assert.ok(Math.abs(ringFracAt(THROW_PHYSICS.ringPeriodMs) - 1) < 0.05)
})

test('voo avança depth e termina', () => {
  let f = beginFlight({ x0: 0, y0: 0, vx: 0, vy: -800, curveDir: 0, spinning: false })
  for (let i = 0; i < 40; i += 1) f = stepFlight(f, 30)
  assert.equal(f.done, true)
  assert.equal(f.depth, 1)
})

test('hitTest e agitação 0 parada', () => {
  assert.equal(hitTest(10, 10, { cx: 10, cy: 10, radius: 5 }), true)
  assert.equal(hitTest(20, 10, { cx: 10, cy: 10, radius: 5 }), false)
  assert.deepEqual(agitationOffset(0, 1000), { x: 0, y: 0 })
  const moved = agitationOffset(3, 250)
  assert.ok(Math.abs(moved.x) + Math.abs(moved.y) > 0)
})

test('toque simples', () => {
  assert.equal(isSimpleTap(5, 100), true)
  assert.equal(isSimpleTap(40, 100), false)
})
