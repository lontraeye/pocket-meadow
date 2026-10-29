import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  accumulateSpin,
  agitationOffset,
  applyThrowTuning,
  beginFlight,
  beginGuaranteedFlight,
  isSimpleTap,
  isSpinning,
  project,
  qualityFromRing,
  releaseVelocity,
  ringColorFor,
  ringFracAt,
  shouldLaunch,
  simulateFlight,
  targetInWorld,
  THROW_PHYSICS,
  throwUnit,
  type SpinState,
  type TargetCircle,
  type ThrowOutcome,
  type ThrowScene,
} from './throwPhysics.js'

applyThrowTuning({})

/** Celular em retrato: palco pequeno, dedo solta perto da base. */
const PHONE = {
  scene: { x0: 195, y0: 640, vanishX: 195, groundY: 250 } satisfies ThrowScene,
  target: { cx: 195, cy: 200, radius: 50 } satisfies TargetCircle,
}
/** PC: tudo maior, na mesma proporção (×1,6). */
const DESKTOP = {
  scene: { x0: 312, y0: 1024, vanishX: 312, groundY: 400 } satisfies ThrowScene,
  target: { cx: 312, cy: 320, radius: 80 } satisfies TargetCircle,
}

type Setup = typeof PHONE

/**
 * Arremessa com força `power` (× ideal) e ângulo `deg` (0 = reto para cima,
 * + = para a direita), opcionalmente com giro.
 */
function shoot(setup: Setup, power: number, deg = 0, spin: { dir: -1 | 1; turns: number } | null = null): ThrowOutcome {
  const U = throwUnit(setup.scene, setup.target)
  const speed = power * THROW_PHYSICS.idealSpeed * U
  const rad = (deg * Math.PI) / 180
  const flight = beginFlight({
    scene: setup.scene,
    target: setup.target,
    vx: Math.sin(rad) * speed,
    vy: -Math.cos(rad) * speed,
    curveDir: spin?.dir ?? 0,
    spinning: spin !== null,
    turns: spin?.turns,
  })
  const end = simulateFlight(flight, setup.target)
  assert.equal(end.done, true)
  assert.ok(end.outcome)
  return end.outcome
}

const hit = (o: ThrowOutcome) => o.kind === 'hit'

test('a velocidade do dedo sai de uma reta nas amostras recentes', () => {
  const samples = Array.from({ length: 8 }, (_, i) => ({ t: i * 10, x: 100 + i * 2, y: 500 - i * 15 }))
  const v = releaseVelocity(samples)
  assert.ok(Math.abs(v.vy + 1500) < 1)
  assert.ok(Math.abs(v.vx - 200) < 1)
})

test('o dedo parado ao levantar não derruba a velocidade', () => {
  const samples = Array.from({ length: 6 }, (_, i) => ({ t: i * 12, x: 100, y: 500 - i * 18 }))
  const last = samples.at(-1)!
  samples.push({ t: last.t + 8, x: last.x, y: last.y }, { t: last.t + 16, x: last.x, y: last.y })
  const v = releaseVelocity(samples, last.t + 16)
  assert.ok(-v.vy > 1400)
})

test('eventos agrupados com intervalos irregulares dão a mesma velocidade', () => {
  const times = [0, 3, 4, 20, 21, 22, 40, 52, 60]
  const v = releaseVelocity(times.map((t) => ({ t, x: 0, y: 600 - t * 1.2 })))
  assert.ok(Math.abs(v.vy + 1200) < 1)
})

test('toque curto não lança; fraco ou para baixo também não', () => {
  assert.equal(isSimpleTap(5, 120), true)
  assert.equal(isSimpleTap(40, 120), false)
  const U = 400
  assert.equal(shouldLaunch(-THROW_PHYSICS.minUpSpeed * U, U), true)
  assert.equal(shouldLaunch(-THROW_PHYSICS.minUpSpeed * U + 5, U), false)
  assert.equal(shouldLaunch(300, U), false)
})

test('força ideal e reto acerta perto do centro', () => {
  const out = shoot(PHONE, 1)
  assert.equal(out.kind, 'hit')
  if (out.kind === 'hit') assert.ok(out.distRatio < 0.15, `distRatio ${out.distRatio}`)
})

test('fraco cai antes; forte passa por cima', () => {
  assert.deepEqual(shoot(PHONE, 0.6), { kind: 'miss', why: 'short' })
  assert.deepEqual(shoot(PHONE, 1.8), { kind: 'miss', why: 'over' })
})

test('a folga da força acerta dos dois lados da ideal', () => {
  const f = THROW_PHYSICS.speedTolerance
  assert.ok(hit(shoot(PHONE, 1 - f * 0.8)))
  assert.ok(hit(shoot(PHONE, 1 + f * 0.8)))
})

test('celular e PC: o mesmo gesto proporcional dá o mesmo resultado', () => {
  for (const power of [0.6, 0.8, 0.9, 1, 1.15, 1.3, 1.8]) {
    for (const deg of [-12, -5, 0, 5, 12]) {
      const a = shoot(PHONE, power, deg)
      const b = shoot(DESKTOP, power, deg)
      assert.equal(a.kind, b.kind, `força ${power}, ${deg}°`)
      if (a.kind === 'hit' && b.kind === 'hit') assert.ok(Math.abs(a.distRatio - b.distRatio) < 0.05)
    }
  }
})

test('o ângulo do peteleco decide o lado: pouco torto acerta, muito torto erra', () => {
  assert.ok(hit(shoot(PHONE, 1, 4)))
  assert.ok(hit(shoot(PHONE, 1, -4)))
  assert.deepEqual(shoot(PHONE, 1, 30), { kind: 'miss', why: 'wide' })
  assert.deepEqual(shoot(PHONE, 1, -30), { kind: 'miss', why: 'wide' })
})

test('curva: reto com giro erra; jogar para o lado oposto compensa', () => {
  const spin = { dir: 1 as const, turns: 1 }
  assert.equal(shoot(PHONE, 1, 0, spin).kind, 'miss')
  // Giro horário curva para a direita: jogar para a esquerda volta para o alvo.
  const compensations = Array.from({ length: 25 }, (_, i) => -4 - i * 2)
  assert.ok(compensations.some((deg) => hit(shoot(PHONE, 1, deg, spin))))
  // E para o mesmo lado da curva erra feio.
  assert.equal(shoot(PHONE, 1, 10, spin).kind, 'miss')
})

test('a bola sai na direção do dedo: começa reta e só depois curva', () => {
  const U = throwUnit(PHONE.scene, PHONE.target)
  const speed = THROW_PHYSICS.idealSpeed * U
  let f = beginFlight({ ...PHONE, vx: 0, vy: -speed, curveDir: 1, spinning: true, turns: 1 })
  const xs: number[] = []
  for (let i = 0; i < 40 && !f.done; i += 1) {
    f = simulateFlight({ ...f }, PHONE.target, 16)
    xs.push(f.x)
  }
  // Começo quase reto; o desvio cresce com o tempo.
  assert.ok(Math.abs(xs[1]! - PHONE.scene.x0) < 3)
  assert.ok(xs.at(-1)! - PHONE.scene.x0 > 10)
})

test('a bola encolhe com a profundidade e a sombra fica embaixo dela', () => {
  const U = throwUnit(PHONE.scene, PHONE.target)
  let f = beginFlight({ ...PHONE, vx: 0, vy: -THROW_PHYSICS.idealSpeed * U, curveDir: 0, spinning: false })
  f = simulateFlight(f, PHONE.target, 300)
  assert.ok(f.scale < 1 && f.scale > 1 / THROW_PHYSICS.depthRatio)
  assert.ok(f.shadowY >= f.y)
})

test('projeção: o chão do Pokémon cai no groundY e o alvo volta ao mesmo lugar', () => {
  const world = targetInWorld(PHONE.scene, PHONE.target)
  const p = project(PHONE.scene, world.X, world.Y, 1)
  assert.ok(Math.abs(p.x - PHONE.target.cx) < 1e-6)
  assert.ok(Math.abs(p.y - PHONE.target.cy) < 1e-6)
  const ground = project(PHONE.scene, PHONE.scene.vanishX, 0, 1)
  assert.ok(Math.abs(ground.y - PHONE.scene.groundY) < 1e-6)
})

test('o lançamento garantido acerta o centro, mesmo saindo de lado', () => {
  const scene = { ...PHONE.scene, x0: 300 }
  const end = simulateFlight(beginGuaranteedFlight({ scene, target: PHONE.target }), PHONE.target)
  assert.deepEqual(end.outcome, { kind: 'hit', distRatio: 0 })
})

test('o alvo que anda é testado onde está quando a bola chega', () => {
  const U = throwUnit(PHONE.scene, PHONE.target)
  const flight = beginFlight({ ...PHONE, vx: 0, vy: -THROW_PHYSICS.idealSpeed * U, curveDir: 0, spinning: false })
  const moved = { ...PHONE.target, cx: PHONE.target.cx + PHONE.target.radius * 3 }
  assert.equal(simulateFlight(flight, moved).outcome?.kind, 'miss')
})

test('giro de uma volta marca spinning; linha reta não', () => {
  let spin: SpinState = { lastAngle: null, accumulated: 0, direction: 0 }
  for (let i = 0; i <= 15; i += 1) {
    const a = (i / 12) * Math.PI * 2
    spin = accumulateSpin(spin, 300 + Math.cos(a) * 20, 300 + Math.sin(a) * 20)
  }
  assert.ok(isSpinning(spin))
  assert.equal(spin.direction, 1)
  let line: SpinState = { lastAngle: null, accumulated: 0, direction: 0 }
  for (let i = 0; i <= 10; i += 1) line = accumulateSpin(line, 180, 500 - i * 20)
  assert.equal(isSpinning(line), false)
})

test('anel: qualidade pela distância do centro e o tamanho do anel', () => {
  assert.equal(qualityFromRing(0.05, 0.2), 'excellent')
  assert.equal(qualityFromRing(0.05, 0.4), 'great')
  assert.equal(qualityFromRing(0.05, 0.8), 'nice')
  assert.equal(qualityFromRing(0.9, 0.5), 'normal')
})

test('ringColorFor: faixas e limites exatos', () => {
  assert.equal(ringColorFor(0.6), THROW_PHYSICS.ringColorGreen)
  assert.equal(ringColorFor(0.59), THROW_PHYSICS.ringColorYellow)
  assert.equal(ringColorFor(0.35), THROW_PHYSICS.ringColorYellow)
  assert.equal(ringColorFor(0.34), THROW_PHYSICS.ringColorOrange)
  assert.equal(ringColorFor(0.15), THROW_PHYSICS.ringColorOrange)
  assert.equal(ringColorFor(0.149), THROW_PHYSICS.ringColorRed)
})

test('ringFrac oscila entre 0 e 1', () => {
  assert.equal(ringFracAt(0), 1)
  assert.ok(ringFracAt(THROW_PHYSICS.ringPeriodMs / 2) < 0.05)
  assert.ok(Math.abs(ringFracAt(THROW_PHYSICS.ringPeriodMs) - 1) < 0.05)
})

test('agitação 0 fica parada', () => {
  assert.deepEqual(agitationOffset(0, 1234), { x: 0, y: 0 })
})
