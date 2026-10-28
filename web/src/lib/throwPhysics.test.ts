import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  accumulateSpin,
  agitationOffset,
  beginFlight,
  hitTest,
  isSimpleTap,
  isSpinning,
  landingPoint,
  qualityFromRing,
  ringColorFor,
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
  // Círculo pequeno longe da bola (passos de 30°, 1,25 volta), horário na tela.
  for (let i = 0; i <= 15; i += 1) {
    const a = (i / 12) * Math.PI * 2
    spin = accumulateSpin(spin, 300 + Math.cos(a) * 20, 300 + Math.sin(a) * 20)
  }
  assert.ok(isSpinning(spin))
  assert.equal(spin.direction, 1)
})

test('arrastar em linha reta não conta como giro', () => {
  let spin: import('./throwPhysics.js').SpinState = { lastAngle: null, accumulated: 0, direction: 0 }
  for (let i = 0; i <= 10; i += 1) spin = accumulateSpin(spin, 180, 500 - i * 20)
  assert.equal(isSpinning(spin), false)
})

test('peteleco que desacelera antes de soltar ainda lança com força', () => {
  const s: { t: number; x: number; y: number }[] = []
  let t = 0
  let y = 500
  for (const dy of [30, 40, 40, 35, 25, 12, 6, 3, 2, 1, 0]) {
    t += 16
    y -= dy
    s.push({ t, x: 180, y })
  }
  const v = sampleVelocity(s, t)
  assert.ok(shouldLaunch(v.vy))
  assert.ok(-v.vy > 1800)
})

test('anel: qualidade pelas faixas', () => {
  const maxR = 100
  assert.equal(qualityFromRing(5, maxR, 0.2), 'excellent')
  assert.equal(qualityFromRing(5, maxR, 0.4), 'great')
  assert.equal(qualityFromRing(5, maxR, 0.8), 'nice')
  assert.equal(qualityFromRing(90, maxR, 0.5), 'normal')
})

test('ringColorFor: faixas e limites exatos', () => {
  assert.equal(ringColorFor(0.6), THROW_PHYSICS.ringColorGreen)
  assert.equal(ringColorFor(1), THROW_PHYSICS.ringColorGreen)
  assert.equal(ringColorFor(0.59), THROW_PHYSICS.ringColorYellow)
  assert.equal(ringColorFor(0.35), THROW_PHYSICS.ringColorYellow)
  assert.equal(ringColorFor(0.34), THROW_PHYSICS.ringColorOrange)
  assert.equal(ringColorFor(0.15), THROW_PHYSICS.ringColorOrange)
  assert.equal(ringColorFor(0.149), THROW_PHYSICS.ringColorRed)
  assert.equal(ringColorFor(0), THROW_PHYSICS.ringColorRed)
})

test('ringFrac oscila entre 0 e 1', () => {
  assert.equal(ringFracAt(0), 1)
  assert.ok(ringFracAt(THROW_PHYSICS.ringPeriodMs / 2) < 0.05)
  assert.ok(Math.abs(ringFracAt(THROW_PHYSICS.ringPeriodMs) - 1) < 0.05)
})

test('voo avança depth e termina', () => {
  let f = beginFlight({ x0: 0, y0: 0, vx: 0, vy: -800, curveDir: 0, spinning: false, targetX: 0, targetY: -300 })
  for (let i = 0; i < 40; i += 1) f = stepFlight(f, 30)
  assert.equal(f.done, true)
  assert.equal(f.depth, 1)
})

/** Voa até o fim e diz se caiu no alvo (bola sai de 400 px abaixo dele). */
function lands(vx: number, vy: number, spinning = false, curveDir: -1 | 0 | 1 = 0, turns = 1): boolean {
  const target = { cx: 180, cy: 100, radius: 30 }
  let f = beginFlight({ x0: 180, y0: 500, vx, vy, curveDir, spinning, turns, targetX: target.cx, targetY: target.cy })
  while (!f.done) f = stepFlight(f, 16)
  return hitTest(f.x, f.y, target)
}

test('com o auxílio, peteleco reto acerta numa faixa bem larga de força', () => {
  const ideal = THROW_PHYSICS.idealUpSpeedPx
  for (const k of [0.45, 0.6, 1, 1.5, 1.8]) assert.equal(lands(0, -ideal * k), true, `força ×${k}`)
})

test('o auxílio perdoa um pouco de desvio para o lado', () => {
  assert.equal(lands(250, -THROW_PHYSICS.idealUpSpeedPx), true)
})

test('peteleco forte (comum no celular) ainda acerta', () => {
  const ideal = THROW_PHYSICS.idealUpSpeedPx
  for (const k of [2, 2.5]) assert.equal(lands(0, -ideal * k), true, `força ×${k}`)
})

test('o voo é um arco: sobe acima da chegada e desce nela, sem dobrar', () => {
  let f = beginFlight({ x0: 180, y0: 500, vx: 0, vy: -1300, curveDir: 0, spinning: false, targetX: 180, targetY: 100 })
  const ys: number[] = []
  while (!f.done) {
    f = stepFlight(f, 16)
    ys.push(f.y)
  }
  const top = Math.min(...ys)
  assert.ok(top < f.landY, 'passa acima da chegada')
  const peak = ys.indexOf(top)
  for (let i = 1; i <= peak; i += 1) assert.ok(ys[i]! <= ys[i - 1]!, 'só sobe até o topo')
  for (let i = peak + 1; i < ys.length; i += 1) assert.ok(ys[i]! >= ys[i - 1]!, 'só desce depois')
})

test('a bola sai da mão na velocidade do dedo', () => {
  const fast = beginFlight({ x0: 180, y0: 500, vx: 0, vy: -2000, curveDir: 0, spinning: false, targetX: 180, targetY: 100 })
  const slow = beginFlight({ x0: 180, y0: 500, vx: 0, vy: -900, curveDir: 0, spinning: false, targetX: 180, targetY: 100 })
  assert.ok(fast.durationMs < slow.durationMs)
})

test('muito fraco nem lança; muito forte ou muito torto ainda erra', () => {
  const ideal = THROW_PHYSICS.idealUpSpeedPx
  assert.equal(shouldLaunch(-ideal * 0.1), false)
  assert.equal(lands(0, -ideal * 4), false)
  assert.equal(lands(900, -ideal), false)
})

test('com giro o auxílio ainda segura o arremesso reto, e girar mais curva mais', () => {
  const ideal = THROW_PHYSICS.idealUpSpeedPx
  for (let turns = 1; turns <= THROW_PHYSICS.spinMaxTurns; turns += 1) {
    assert.equal(lands(0, -ideal, true, 1, turns), true, `${turns} volta(s)`)
  }
  const at = (turns: number) =>
    landingPoint({ x0: 180, vx: 0, vy: -ideal, curveDir: 1, turns, targetX: 180, targetY: 100 }).x
  assert.ok(at(3) > at(2) && at(2) > at(1))
  const compensate = (-THROW_PHYSICS.curveDriftPx * THROW_PHYSICS.spinMaxTurns) / THROW_PHYSICS.lateralReachS
  assert.equal(lands(compensate, -ideal, true, 1, THROW_PHYSICS.spinMaxTurns), true)
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
