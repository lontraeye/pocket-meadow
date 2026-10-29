/**
 * Física do arremesso (Fase 9.4, refeita em 2026-10-29). Funções puras; a tela
 * só mede o gesto, chama e anima.
 *
 * A bola é simulada num espaço 3D simples e projetada na tela:
 * - Z é a profundidade: 0 na mão, 1 no plano do Pokémon.
 * - X é o lado e Y a altura acima do chão, em px "do plano da mão" (no Z = 0
 *   valem px de tela; mais fundo, a perspectiva encolhe).
 * - A gravidade puxa Y para baixo; o giro empurra X para o lado (curva), com
 *   força que cresce durante o voo: sai reta e quebra perto do Pokémon.
 *
 * Tudo que vem do gesto é medido em **U** = distância vertical na tela entre o
 * ponto de soltar e o centro do alvo. Assim o mesmo peteleco, proporcional à
 * tela, faz a mesma coisa no celular e no PC. Não há ímã: acerta quem cruza o
 * plano do Pokémon dentro do círculo do alvo.
 *
 * Os números ajustáveis ficam em THROW_PHYSICS. Em dev, o painel do laboratório
 * de arremesso (ThrowLab) mexe neles ao vivo.
 */

export type ThrowTuning = {
  /** Janela (ms) antes de soltar usada para medir a velocidade do dedo. */
  velocityWindowMs: number
  /** Se a janela tem poucas amostras, alarga até isto (ms). */
  velocityMaxWindowMs: number
  /** Peteleco mais fraco que lança (U/s para cima). Abaixo disso a bola volta. */
  minUpSpeed: number
  /** Força ideal (U/s para cima): chega na altura do centro do alvo. */
  idealSpeed: number
  /**
   * Resposta da força (expoente; 1 = linear). Abaixo de 1 amacia: peteleco
   * rápido de polegar não dispara e o lento não morre. A bola voa com a força
   * já amaciada (o voo também fica menos brusco).
   */
  powerResponse: number
  /**
   * Folga da força do lado fraco (fração da ideal): com (1 − f) × ideal, reto,
   * a bola ainda pega a base do alvo; mais fraco cai antes. O lado forte sai da
   * gravidade e fica um pouco mais largo (com 0,15: até ~1,27×); mais forte
   * passa por cima.
   */
  speedTolerance: number
  /** Tempo de voo (s) com a força ideal. Mais forte chega antes. */
  flightTimeS: number
  /** Quantas vezes o alvo parece menor que a mão (perspectiva). */
  depthRatio: number
  /** 1 = a bola sai exatamente na direção do dedo na tela. */
  lateralGain: number
  /** Desvio da curva no plano do Pokémon, em raios do alvo (1 volta, força ideal). */
  curveShiftRadii: number
  /** Cada volta a mais de giro soma esta fração ao desvio (até spinMaxTurns). */
  curvePerExtraTurn: number
  /** Raio do alvo = fração da altura do corpo do Pokémon. */
  hitRadiusFrac: number
  /** Depois de passar do Pokémon, a bola segue até esta profundidade e some. */
  maxDepth: number
  /** Quique no chão: fração da velocidade vertical e da de avanço que sobra. */
  bounceKeep: number
  bounceSlide: number
  /** Tempo (ms) mostrando o quique antes de contar o erro. */
  bounceShowMs: number
  // Giro (a mão faz círculos antes de soltar).
  spinThresholdRad: number
  spinMinStepPx: number
  spinMaxTurns: number
  spinHalfLifeMs: number
  spinRestRad: number
  spinCurveMinRad: number
  spinMaxRad: number
  // Anel e qualidade.
  ringPeriodMs: number
  feedbackHoldMs: number
  ringChanceGreen: number
  ringChanceYellow: number
  ringChanceOrange: number
  ringColorGreen: string
  ringColorYellow: string
  ringColorOrange: string
  ringColorRed: string
  ringExcellentFrac: number
  ringGreatFrac: number
  ringNiceFrac: number
  /** Toque curto (sem arrastar): não lança. */
  tapMaxDragPx: number
  tapMaxMs: number
  // Agitação do selvagem (só visual; o alvo anda junto).
  agitationStrafePx: number
  agitationJumpPx: number
  agitationFreqHz: number
  agitationFreqStepHz: number
}

export const THROW_DEFAULTS: Readonly<ThrowTuning> = Object.freeze({
  velocityWindowMs: 80,
  velocityMaxWindowMs: 160,
  minUpSpeed: 1.2,
  idealSpeed: 3.2,
  powerResponse: 0.65,
  speedTolerance: 0.18,
  flightTimeS: 0.62,
  depthRatio: 2.6,
  lateralGain: 0.32,
  curveShiftRadii: 1.4,
  curvePerExtraTurn: 0.15,
  hitRadiusFrac: 0.6,
  maxDepth: 1.8,
  bounceKeep: 0.35,
  bounceSlide: 0.5,
  bounceShowMs: 260,
  spinThresholdRad: Math.PI * 2,
  spinMinStepPx: 4,
  spinMaxTurns: 3,
  spinHalfLifeMs: 900,
  spinRestRad: 0.4,
  spinCurveMinRad: 4,
  spinMaxRad: 28,
  ringPeriodMs: 1200,
  feedbackHoldMs: 420,
  ringChanceGreen: 0.6,
  ringChanceYellow: 0.35,
  ringChanceOrange: 0.15,
  ringColorGreen: '#3ecf5a',
  ringColorYellow: '#e8c547',
  ringColorOrange: '#ef7a2e',
  ringColorRed: '#e05a4a',
  ringExcellentFrac: 0.28,
  ringGreatFrac: 0.55,
  ringNiceFrac: 1,
  tapMaxDragPx: 14,
  tapMaxMs: 240,
  agitationStrafePx: 7,
  agitationJumpPx: 5,
  agitationFreqHz: 0.65,
  agitationFreqStepHz: 0.18,
})

/** Valores em uso. Mutável só para o laboratório de dev ajustar ao vivo. */
export const THROW_PHYSICS: ThrowTuning = { ...THROW_DEFAULTS }

export function applyThrowTuning(patch: Partial<ThrowTuning>) {
  Object.assign(THROW_PHYSICS, THROW_DEFAULTS, patch)
}

export type ThrowQuality = 'normal' | 'nice' | 'great' | 'excellent'

export type PointerSample = { t: number; x: number; y: number }

export type SpinState = {
  /** Última direção do movimento do dedo (rad, -π..π); null antes do primeiro passo. */
  lastAngle: number | null
  /** Último ponto contado (o passo seguinte parte dele). */
  lastX?: number
  lastY?: number
  /** Quanto a direção virou, com sinal (positivo = horário na tela, y para baixo). */
  accumulated: number
  /** Sentido dominante do giro recente. */
  direction: -1 | 0 | 1
}

export type TargetCircle = { cx: number; cy: number; radius: number }

/**
 * A cena do arremesso em px de tela: onde a bola sai, o ponto de fuga
 * horizontal (meio do palco) e o chão sob o Pokémon.
 */
export type ThrowScene = {
  x0: number
  y0: number
  /** X do meio do palco: para onde a perspectiva converge. */
  vanishX: number
  /** Y do chão sob o Pokémon (pés). */
  groundY: number
}

export type ThrowOutcome =
  | { kind: 'hit'; /** Distância do centro / raio do alvo (0..1). */ distRatio: number }
  | { kind: 'miss'; why: 'short' | 'over' | 'wide' }

/** Leitura de um arremesso (laboratório de dev): o que o gesto deu e no que deu. */
export type ThrowReading = {
  /** Força medida / força ideal (1 = ideal). */
  power: number
  /** Ângulo do peteleco (graus; 0 = reto para cima, + = direita). */
  angleDeg: number
  /** U do arremesso (px). */
  unitPx: number
  curve: boolean
  turns: number
  result: 'tap' | 'weak' | 'hit' | 'short' | 'over' | 'wide'
  /** No acerto: distância do centro / raio. */
  distRatio: number | null
  quality: ThrowQuality | null
}

export type FlightState = {
  elapsedMs: number
  /** Tela (px). */
  x: number
  y: number
  /** Sombra no chão, embaixo da bola (px de tela). */
  shadowX: number
  shadowY: number
  /** Escala da bola pela perspectiva (1 na mão). */
  scale: number
  /** Profundidade 0..maxDepth (1 = plano do Pokémon). */
  depth: number
  spinAngle: number
  spinSpeed: number
  curveDir: -1 | 0 | 1
  /** Preenchido quando o resultado já está decidido (acerto, erro). */
  outcome: ThrowOutcome | null
  /** Terminou a animação (acerto: no contato; erro: depois de sumir ou quicar). */
  done: boolean
  // Simulação (mundo).
  scene: ThrowScene
  X: number
  Y: number
  Z: number
  vX: number
  vY: number
  vZ: number
  aX: number
  g: number
  /** Ms desde o quique (null = ainda no ar). */
  bouncedMs: number | null
  /** Sempre acerta ao cruzar o plano (teclado / movimento reduzido). */
  guaranteed: boolean
}

// ---------------------------------------------------------------------------
// Gesto

/**
 * Velocidade do dedo ao soltar (px/s): reta de mínimos quadrados nas amostras
 * dos últimos velocityWindowMs. A regressão aguenta eventos de toque que chegam
 * agrupados (comum no celular), ao contrário de pegar o pico entre dois pontos.
 */
export function releaseVelocity(samples: readonly PointerSample[], now = samples.at(-1)?.t ?? 0): {
  vx: number
  vy: number
} {
  const { velocityWindowMs, velocityMaxWindowMs } = THROW_PHYSICS
  // Repetições do mesmo ponto no fim (o dedo levantando) não são movimento.
  const trimmed = [...samples]
  while (trimmed.length > 2) {
    const a = trimmed.at(-1)!
    const b = trimmed.at(-2)!
    if (a.x !== b.x || a.y !== b.y) break
    trimmed.pop()
  }
  let recent = trimmed.filter((s) => now - s.t <= velocityWindowMs)
  if (recent.length < 3) recent = trimmed.filter((s) => now - s.t <= velocityMaxWindowMs)
  if (recent.length < 2) return { vx: 0, vy: 0 }
  const n = recent.length
  let mt = 0
  let mx = 0
  let my = 0
  for (const s of recent) {
    mt += s.t
    mx += s.x
    my += s.y
  }
  mt /= n
  mx /= n
  my /= n
  let stt = 0
  let stx = 0
  let sty = 0
  for (const s of recent) {
    const dt = s.t - mt
    stt += dt * dt
    stx += dt * (s.x - mx)
    sty += dt * (s.y - my)
  }
  if (!(stt > 0)) return { vx: 0, vy: 0 }
  return { vx: (stx / stt) * 1000, vy: (sty / stt) * 1000 }
}

/**
 * Atualiza o giro pela trajetória do dedo: soma quanto a direção do movimento
 * vira. Fazer círculos em qualquer lugar conta (não precisa rodear a bola).
 */
export function accumulateSpin(state: SpinState, x: number, y: number): SpinState {
  if (state.lastX === undefined || state.lastY === undefined) return { ...state, lastX: x, lastY: y }
  const dx = x - state.lastX
  const dy = y - state.lastY
  if (Math.hypot(dx, dy) < THROW_PHYSICS.spinMinStepPx) return state
  const heading = Math.atan2(dy, dx)
  if (state.lastAngle === null) return { ...state, lastAngle: heading, lastX: x, lastY: y }
  let delta = heading - state.lastAngle
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  const accumulated = state.accumulated + delta
  const direction: -1 | 0 | 1 = Math.abs(accumulated) < 0.2 ? 0 : accumulated > 0 ? 1 : -1
  return { lastAngle: heading, lastX: x, lastY: y, accumulated, direction }
}

/** Voltas de giro que contam para a curva (0 até spinMaxTurns). */
export function spinTurns(state: SpinState): number {
  return Math.min(THROW_PHYSICS.spinMaxTurns, Math.abs(state.accumulated) / (Math.PI * 2))
}

export function isSpinning(state: SpinState): boolean {
  return Math.abs(state.accumulated) >= THROW_PHYSICS.spinThresholdRad
}

export function isSimpleTap(dragPx: number, durationMs: number): boolean {
  return dragPx <= THROW_PHYSICS.tapMaxDragPx && durationMs <= THROW_PHYSICS.tapMaxMs
}

/** U: distância vertical (px) do ponto de soltar ao centro do alvo. */
export function throwUnit(scene: ThrowScene, target: TargetCircle): number {
  return Math.max(60, scene.y0 - target.cy)
}

/** Força do peteleco em U/s para cima (vy de tela cresce para baixo). */
/**
 * Força do arremesso em U/s: a velocidade inteira do peteleco (não só a parte
 * vertical), para jogar na diagonal compensando a curva não virar bola fraca.
 * Para baixo ou de lado puro não conta.
 */
export function throwSpeed(vx: number, vy: number, unitPx: number): number {
  return vy < 0 ? Math.hypot(vx, vy) / unitPx : 0
}

/** Força que a bola usa: a do dedo amaciada em volta da ideal (powerResponse). */
export function effectiveSpeed(raw: number): number {
  const ideal = THROW_PHYSICS.idealSpeed
  if (!(raw > 0)) return 0
  return ideal * (raw / ideal) ** THROW_PHYSICS.powerResponse
}

export function upSpeed(vy: number, unitPx: number): number {
  return Math.max(0, -vy) / unitPx
}

/** Gesto fraco ou para baixo: não lança. */
export function shouldLaunch(vy: number, unitPx: number): boolean {
  return upSpeed(vy, unitPx) >= THROW_PHYSICS.minUpSpeed
}

// ---------------------------------------------------------------------------
// Projeção

function persp(Z: number): number {
  return 1 / (1 + Math.max(0, Z) * (THROW_PHYSICS.depthRatio - 1))
}

/** Y de tela do horizonte: faz o chão da mão (y0) chegar no chão do Pokémon em Z = 1. */
function horizonY(scene: ThrowScene): number {
  const s1 = persp(1)
  return (scene.groundY - scene.y0 * s1) / (1 - s1)
}

export function project(scene: ThrowScene, X: number, Y: number, Z: number): { x: number; y: number; s: number } {
  const s = persp(Z)
  const yh = horizonY(scene)
  return {
    x: scene.vanishX + (X - scene.vanishX) * s,
    y: yh + (scene.y0 - yh) * s - Y * s,
    s,
  }
}

/** O alvo de tela no plano do Pokémon, em coordenadas do mundo. */
export function targetInWorld(scene: ThrowScene, target: TargetCircle): { X: number; Y: number; R: number } {
  const s1 = persp(1)
  return {
    X: scene.vanishX + (target.cx - scene.vanishX) / s1,
    Y: (scene.groundY - target.cy) / s1,
    R: target.radius / s1,
  }
}

// ---------------------------------------------------------------------------
// Voo

/** Escala da curva pelas voltas: 1 volta = 1; cada volta a mais soma um pouco. */
function curveTurnFactor(turns: number): number {
  const t = Math.min(THROW_PHYSICS.spinMaxTurns, Math.max(1, turns))
  return 1 + (t - 1) * THROW_PHYSICS.curvePerExtraTurn
}

function baseFlight(
  scene: ThrowScene,
  v: { vX: number; vY: number; vZ: number; aX: number; g: number },
  extra: { curveDir: -1 | 0 | 1; spinAngle: number; spinSpeed: number; guaranteed: boolean },
): FlightState {
  return {
    elapsedMs: 0,
    x: scene.x0,
    y: scene.y0,
    shadowX: scene.x0,
    shadowY: scene.y0,
    scale: 1,
    depth: 0,
    spinAngle: extra.spinAngle,
    spinSpeed: extra.spinSpeed,
    curveDir: extra.curveDir,
    outcome: null,
    done: false,
    scene,
    X: scene.x0,
    Y: 0,
    Z: 0,
    ...v,
    bouncedMs: null,
    guaranteed: extra.guaranteed,
  }
}

/**
 * Coeficientes do lançamento para a força u (U/s), com o alvo atual.
 * A força ideal leva flightTimeS e chega na altura do centro; a gravidade é
 * escolhida para que (1 − speedTolerance) × ideal chegue um raio abaixo.
 */
function launchCoefficients(scene: ThrowScene, target: TargetCircle) {
  const P = THROW_PHYSICS
  const world = targetInWorld(scene, target)
  const kz = 1 / (P.idealSpeed * P.flightTimeS) // vZ = kz · u
  // Altura no plano do Pokémon: Y(u) = A − B/u². Y(ideal) = centro e
  // Y((1 − f)·ideal) = centro − R fixam A e B.
  const low = 1 - Math.min(0.9, Math.max(0.02, P.speedTolerance))
  const B = (world.R * P.idealSpeed ** 2) / (1 / (low * low) - 1)
  const A = world.Y + B / P.idealSpeed ** 2
  return { world, kz, kY: A * kz, g: 2 * B * kz * kz }
}

/**
 * Inicia o voo do gesto. vx/vy: velocidade do dedo ao soltar (px/s de tela).
 * A bola sai na direção do dedo na tela; a força decide quão longe e alto ela
 * vai; o giro (curveDir + turns) curva para o lado durante o voo.
 */
export function beginFlight(input: {
  scene: ThrowScene
  target: TargetCircle
  vx: number
  vy: number
  curveDir: -1 | 0 | 1
  spinning: boolean
  turns?: number
  spinAngle?: number
  spinRate?: number
}): FlightState {
  const P = THROW_PHYSICS
  const { scene, target } = input
  const U = throwUnit(scene, target)
  const u = effectiveSpeed(throwSpeed(input.vx, input.vy, U))
  const { world, kz, kY, g } = launchCoefficients(scene, target)
  const vZ = kz * u
  const vY = kY * u
  // Direção na tela: a velocidade inicial projetada segue a razão vx/vy do dedo.
  const D1 = P.depthRatio - 1
  const yh = horizonY(scene)
  const screenUp = (scene.y0 - yh) * D1 * vZ + vY
  const ratio = input.vy < 0 ? input.vx / -input.vy : 0
  const vX = ratio * screenUp * P.lateralGain + (scene.x0 - scene.vanishX) * D1 * vZ
  const curveDir = input.spinning ? input.curveDir : 0
  const shift = curveDir * P.curveShiftRadii * world.R * curveTurnFactor(input.turns ?? 1)
  // Empurrão lateral cresce com o tempo (a = aX · t / flightTimeS): o desvio
  // vai como t³, então a bola sai reta e a curva aparece no fim.
  // Efeito do giro cresce com a velocidade (como a força de Magnus): ×(u/ideal)²
  // compensa o voo mais curto, e a curva desvia o mesmo em qualquer força.
  // Junto com o ângulo (que também não depende da força), o lado em que a bola
  // chega depende só da mira e do giro; a força decide só a altura.
  const aX = ((6 * shift) / P.flightTimeS ** 2) * (u / P.idealSpeed) ** 2
  const spinSpeed = input.spinRate ?? curveDir * 10 * curveTurnFactor(input.turns ?? 1)
  return baseFlight(scene, { vX, vY, vZ, aX, g }, {
    curveDir,
    spinAngle: input.spinAngle ?? 0,
    spinSpeed,
    guaranteed: false,
  })
}

/** Voo com a força ideal até o centro (teclado / movimento reduzido). Sempre acerta. */
export function beginGuaranteedFlight(input: { scene: ThrowScene; target: TargetCircle }): FlightState {
  const P = THROW_PHYSICS
  const { scene, target } = input
  const { world, kz, kY, g } = launchCoefficients(scene, target)
  const vZ = kz * P.idealSpeed
  const vY = kY * P.idealSpeed
  const vX = (world.X - scene.x0) / P.flightTimeS
  return baseFlight(scene, { vX, vY, vZ, aX: 0, g }, { curveDir: 0, spinAngle: 0, spinSpeed: 0, guaranteed: true })
}

const SUBSTEP_MS = 4

/**
 * Avança o voo (dt em ms). `target` é o alvo vivo (anda com a agitação):
 * o acerto é testado no instante em que a bola cruza o plano do Pokémon.
 */
export function stepFlight(state: FlightState, dtMs: number, target: TargetCircle): FlightState {
  if (state.done) return state
  const P = THROW_PHYSICS
  let { X, Y, Z, vX, vY, vZ, outcome, bouncedMs, elapsedMs } = state
  let done = false
  let remaining = Math.max(0, dtMs)
  while (remaining > 0 && !done) {
    const h = Math.min(SUBSTEP_MS, remaining) / 1000
    remaining -= h * 1000
    elapsedMs += h * 1000
    const prevZ = Z
    const prevX = X
    const prevY = Y
    vX += state.aX * (elapsedMs / 1000 / P.flightTimeS) * h
    vY -= state.g * h
    X += vX * h
    Y += vY * h
    Z += vZ * h

    if (outcome === null && prevZ < 1 && Z >= 1) {
      // Cruzou o plano do Pokémon neste passo: interpola o ponto exato.
      const f = (1 - prevZ) / (Z - prevZ)
      const cX = prevX + (X - prevX) * f
      const cY = prevY + (Y - prevY) * f
      const world = targetInWorld(state.scene, target)
      const dist = Math.hypot(cX - world.X, cY - world.Y)
      if (state.guaranteed || dist <= world.R) {
        X = cX
        Y = cY
        Z = 1
        outcome = { kind: 'hit', distRatio: state.guaranteed ? 0 : dist / world.R }
        done = true
        break
      }
      // O erro é para onde a bola mais saiu do círculo: lado, cima ou baixo.
      const offX = Math.abs(cX - world.X)
      const offY = cY - world.Y
      outcome = { kind: 'miss', why: offX >= Math.abs(offY) ? 'wide' : offY > 0 ? 'over' : 'short' }
    }

    if (Y <= 0 && vY < 0) {
      Y = 0
      if (bouncedMs === null) {
        bouncedMs = 0
        if (outcome === null) outcome = { kind: 'miss', why: 'short' }
      }
      vY = -vY * P.bounceKeep
      vZ *= P.bounceSlide
      vX *= P.bounceSlide
    }
    if (bouncedMs !== null) {
      bouncedMs += h * 1000
      if (bouncedMs >= P.bounceShowMs) done = true
    }
    if (Z >= P.maxDepth) done = true
  }
  if (done && outcome === null) outcome = { kind: 'miss', why: 'over' }
  const screen = project(state.scene, X, Y, Z)
  const ground = project(state.scene, X, 0, Z)
  return {
    ...state,
    elapsedMs,
    X,
    Y,
    Z,
    vX,
    vY,
    vZ,
    x: screen.x,
    y: screen.y,
    shadowX: ground.x,
    shadowY: ground.y,
    scale: screen.s,
    depth: Z,
    spinAngle: state.spinAngle + state.spinSpeed * (dtMs / 1000),
    outcome,
    bouncedMs,
    done,
  }
}

/** Simula o voo inteiro de uma vez (testes e laboratório). */
export function simulateFlight(start: FlightState, target: TargetCircle, maxMs = 4000): FlightState {
  let state = start
  for (let t = 0; t < maxMs && !state.done; t += 16) state = stepFlight(state, 16, target)
  return state
}

// ---------------------------------------------------------------------------
// Anel, qualidade, agitação

/**
 * Raio atual do anel (0..1 relativo ao raio máximo).
 * Triângulo: 1 → 0 → 1 no período.
 */
export function ringFracAt(timeMs: number): number {
  const p = THROW_PHYSICS.ringPeriodMs
  const phase = ((timeMs % p) + p) % p
  const half = p / 2
  if (phase <= half) return 1 - phase / half
  return (phase - half) / half
}

/**
 * Cor do anel pela chance de captura (0..1), mesma da UI com qualidade normal.
 * Faixas: ≥60% verde, ≥35% amarelo, ≥15% laranja, senão vermelho.
 */
export function ringColorFor(chance: number): string {
  const c = Number.isFinite(chance) ? chance : 0
  if (c >= THROW_PHYSICS.ringChanceGreen) return THROW_PHYSICS.ringColorGreen
  if (c >= THROW_PHYSICS.ringChanceYellow) return THROW_PHYSICS.ringColorYellow
  if (c >= THROW_PHYSICS.ringChanceOrange) return THROW_PHYSICS.ringColorOrange
  return THROW_PHYSICS.ringColorRed
}

/** Qualidade pelo ponto de contato (distância / raio) e o tamanho do anel na hora. */
export function qualityFromRing(distRatio: number, ringFrac: number): ThrowQuality {
  if (distRatio > ringFrac) return 'normal'
  const { ringExcellentFrac, ringGreatFrac, ringNiceFrac } = THROW_PHYSICS
  if (ringFrac <= ringExcellentFrac) return 'excellent'
  if (ringFrac <= ringGreatFrac) return 'great'
  if (ringFrac <= ringNiceFrac) return 'nice'
  return 'normal'
}

/** Deslocamento visual do alvo pela agitação (só front). */
export function agitationOffset(agitation: number, timeMs: number): { x: number; y: number } {
  const level = Math.max(0, agitation)
  if (level === 0) return { x: 0, y: 0 }
  const freq = THROW_PHYSICS.agitationFreqHz + THROW_PHYSICS.agitationFreqStepHz * (level - 1)
  const w = (Math.PI * 2 * freq * timeMs) / 1000
  return {
    x: Math.sin(w) * THROW_PHYSICS.agitationStrafePx * level,
    y: -Math.abs(Math.sin(w * 1.3)) * THROW_PHYSICS.agitationJumpPx * level,
  }
}

export function throwAimMult(
  quality: ThrowQuality,
  curve: boolean,
  qualityMult: Record<ThrowQuality, number>,
  curveMult: number,
): number {
  return qualityMult[quality] * (curve ? curveMult : 1)
}

/**
 * Inércia do giro (só visual): a velocidade de rotação cai pela metade a cada
 * spinHalfLifeMs; perto de parar, zera.
 */
export function decaySpinRate(rate: number, dtMs: number): number {
  const next = rate * Math.pow(0.5, dtMs / THROW_PHYSICS.spinHalfLifeMs)
  return Math.abs(next) < THROW_PHYSICS.spinRestRad ? 0 : next
}

/** Junta a rotação medida do dedo com a que a bola já tinha (sem passar do teto). */
export function blendSpinRate(current: number, measured: number): number {
  const mixed = Math.abs(measured) > Math.abs(current) ? measured : current * 0.7 + measured * 0.3
  return Math.max(-THROW_PHYSICS.spinMaxRad, Math.min(THROW_PHYSICS.spinMaxRad, mixed))
}
