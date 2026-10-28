/**
 * Física do arremesso (Fase 9.4). Funções puras; a tela só chama e anima.
 * Todos os números ajustáveis ficam em THROW_PHYSICS — revisar no celular.
 */

export const THROW_PHYSICS = {
  /**
   * Janela (ms) antes de soltar em que se procura o trecho mais rápido do gesto:
   * o dedo costuma desacelerar antes de sair da tela, e a média só do fim
   * transformava um bom peteleco num arremesso fraco.
   */
  velocitySampleMs: 160,
  /** Trecho mínimo (ms) para medir a velocidade sem pegar ruído de um evento só. */
  velocityMinSpanMs: 32,
  /**
   * Velocidade mínima para cima (px/s, eixo Y da tela cresce para baixo).
   * Soltar mais fraco ou para baixo → bola volta, sem gastar.
   */
  minUpSpeedPx: 420,
  /**
   * Giro: soma de quanto a direção do dedo vira (rad), em qualquer lugar da tela.
   * Uma volta completa (2π) no mesmo sentido = girando.
   */
  spinThresholdRad: Math.PI * 2,
  /** Passo mínimo do dedo (px) para contar a direção (ignora tremidas). */
  spinMinStepPx: 4,
  /** Acima disto (voltas), girar mais não aumenta a curva. */
  spinMaxTurns: 3,
  /**
   * Força ideal do gesto (px/s para cima): com ela a bola chega na altura do alvo.
   * O ponto de chegada sai direto do gesto (não de uma parábola na tela), para
   * a faixa que acerta ser larga o bastante para o dedo no celular.
   */
  idealUpSpeedPx: 1300,
  /** Folga em volta da força ideal (fração): dentro dela, a altura é a do alvo. */
  powerTolerance: 0.45,
  /**
   * Auxílio de mira (como no GO, errar é difícil): chegando a menos de
   * assistRadiusPx do centro do alvo, a bola é puxada esta fração do caminho
   * até ele. Bem torto, fraco ou forte demais (mais longe que o raio) ainda erra.
   */
  assistRadiusPx: 200,
  assistStrength: 0.8,
  /**
   * Fora da folga: px de erro na altura por unidade de força a mais ou a menos.
   * Baixo de propósito: peteleco forte (comum no celular) ainda cai no auxílio.
   */
  overshootPxPerPower: 110,
  /** Desvio lateral na chegada: segundos × velocidade horizontal do gesto (px/s). */
  lateralReachS: 0.22,
  /**
   * Desvio da curva na chegada por volta de giro (px), antes do auxílio:
   * mais voltas, mais curva (até spinMaxTurns). Mire compensando.
   */
  curveDriftPx: 40,
  /**
   * Forma do voo (só visual): um arco de arremesso, que sobe na direção do gesto,
   * passa arcHeightPx acima da chegada e desce nela.
   */
  arcHeightPx: 60,
  /**
   * Duração do voo: a bola sai da mão na velocidade do dedo (sem "parar" ao
   * soltar), entre estes limites (ms).
   */
  flightFastMs: 300,
  flightSlowMs: 620,
  /** Com giro, a saída abre para o lado oposto à curva: este ângulo (rad) por volta. */
  curveLaunchRad: 0.16,
  /**
   * Inércia do giro: depois que o dedo para de girar, a bola continua rodando e
   * a velocidade cai pela metade a cada spinHalfLifeMs. Abaixo de spinRestRad/s, para.
   */
  spinHalfLifeMs: 900,
  spinRestRad: 0.4,
  /**
   * A curva (e o brilho de "pronta") só vale com a bola girando pelo menos isto
   * (rad/s). Girou e esperou demais: ela desacelera, perde a curva e o brilho.
   */
  spinCurveMinRad: 4,
  /** Teto da velocidade de rotação (rad/s), para um giro frenético não virar borrão. */
  spinMaxRad: 28,
  /** Ciclo completo do anel encolher→expandir (ms). */
  ringPeriodMs: 1200,
  /**
   * Tempo (ms) mostrando Nice / Great / Excellent / Curva no alvo antes da
   * cena de captura (hit → absorver → chão). Curto de propósito.
   */
  feedbackHoldMs: 420,
  /**
   * Cor do anel pela chance de captura mostrada (qualidade normal).
   * Limites inclusivos no teto de cada faixa (ex.: 0,60 = verde).
   */
  ringChanceGreen: 0.6,
  ringChanceYellow: 0.35,
  ringChanceOrange: 0.15,
  /** Cores fortes, legíveis no card claro e no sprite (tema pixel). */
  ringColorGreen: '#3ecf5a',
  ringColorYellow: '#e8c547',
  ringColorOrange: '#ef7a2e',
  ringColorRed: '#e05a4a',
  /**
   * Frações do raio máximo do anel no instante do acerto:
   * dentro de excellent → Excellent; great → Great; nice → Nice; senão normal.
   */
  ringExcellentFrac: 0.28,
  ringGreatFrac: 0.55,
  ringNiceFrac: 1,
  /** Raio do alvo = esta fração da menor dimensão do stage (fallback). */
  targetRadiusFrac: 0.3,
  /** Escala da bola: mão → alvo. */
  ballScaleHand: 1,
  ballScaleTarget: 0.38,
  /** Arrasto (px) e duração (ms) máximos para contar como toque simples (sempre acerta). */
  tapMaxDragPx: 14,
  tapMaxMs: 240,
  /** Agitação: amplitude lateral/vertical (px) por nível; freq base + passo (Hz). */
  agitationStrafePx: 7,
  agitationJumpPx: 5,
  agitationFreqHz: 0.65,
  agitationFreqStepHz: 0.18,
} as const

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

export type FlightState = {
  elapsedMs: number
  durationMs: number
  x: number
  y: number
  depth: number
  scale: number
  spinAngle: number
  done: boolean
  // internos: curva de Bézier quadrática da mão (p0) ao ponto de chegada (p2).
  x0: number
  y0: number
  cx: number
  cy: number
  landX: number
  landY: number
  curveDir: -1 | 0 | 1
  spinSpeed: number
}

/**
 * Velocidade do arremesso (px/s): o trecho mais rápido para cima dentro de
 * velocitySampleMs antes de soltar (com pelo menos velocityMinSpanMs).
 */
export function sampleVelocity(samples: readonly PointerSample[], now = samples.at(-1)?.t ?? 0): {
  vx: number
  vy: number
} {
  const { velocitySampleMs, velocityMinSpanMs } = THROW_PHYSICS
  const recent = samples.filter((s) => now - s.t <= velocitySampleMs)
  let best = { vx: 0, vy: 0 }
  for (let i = 0; i < recent.length; i += 1) {
    for (let j = i + 1; j < recent.length; j += 1) {
      const a = recent[i]!
      const b = recent[j]!
      const dtMs = b.t - a.t
      if (dtMs < velocityMinSpanMs) continue
      const vy = ((b.y - a.y) / dtMs) * 1000
      if (vy < best.vy) best = { vx: ((b.x - a.x) / dtMs) * 1000, vy }
    }
  }
  return best
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

/** Gesto fraco ou para baixo: não lança. vy positivo = para baixo na tela. */
export function shouldLaunch(vy: number): boolean {
  return -vy >= THROW_PHYSICS.minUpSpeedPx
}

export function isSimpleTap(dragPx: number, durationMs: number): boolean {
  return dragPx <= THROW_PHYSICS.tapMaxDragPx && durationMs <= THROW_PHYSICS.tapMaxMs
}

/**
 * Onde a bola chega (px de tela) a partir do gesto. A altura depende só da força:
 * dentro da folga em volta da ideal ela chega na altura do alvo; fraco demais
 * fica curto (mais embaixo), forte demais passa por cima. O lado vem da
 * velocidade horizontal e, com giro, do desvio da curva.
 */
export function landingPoint(input: {
  x0: number
  vx: number
  vy: number
  curveDir: -1 | 0 | 1
  /** Voltas de giro (spinTurns): a curva cresce com elas. */
  turns?: number
  targetX: number
  targetY: number
}): { x: number; y: number } {
  const { idealUpSpeedPx, powerTolerance, overshootPxPerPower, lateralReachS, curveDriftPx, assistRadiusPx, assistStrength } =
    THROW_PHYSICS
  const power = Math.max(0, -input.vy) / idealUpSpeedPx
  const off = power - 1
  const excess = Math.sign(off) * Math.max(0, Math.abs(off) - powerTolerance)
  const raw = {
    x: input.x0 + input.vx * lateralReachS + input.curveDir * curveDriftPx * Math.max(1, input.turns ?? 1),
    y: input.targetY - excess * overshootPxPerPower,
  }
  // Auxílio de mira: perto do alvo, puxa a bola boa parte do caminho até o centro.
  const dx = raw.x - input.targetX
  const dy = raw.y - input.targetY
  if (Math.hypot(dx, dy) > assistRadiusPx) return raw
  return { x: input.targetX + dx * (1 - assistStrength), y: input.targetY + dy * (1 - assistStrength) }
}

/**
 * Um arco de arremesso só (Bézier quadrática, nunca com dobra): sai na direção
 * do gesto, sobe até um pouco acima da chegada e desce nela, já com o auxílio.
 * Com giro, a saída abre para o lado oposto à curva e o arco volta para ela.
 * A duração faz a bola sair da mão na velocidade do dedo.
 */
function flightFrom(
  x0: number,
  y0: number,
  land: { x: number; y: number },
  curveDir: -1 | 0 | 1,
  spinSpeed: number,
  /** Direção da saída (gesto); sem ela, reto para a chegada. */
  launchDir?: { x: number; y: number },
  /** Voltas de giro: quanto a saída abre para o lado (só visual). */
  turns = 0,
  /** Velocidade do dedo ao soltar (px/s). */
  releaseSpeed: number = THROW_PHYSICS.idealUpSpeedPx,
): FlightState {
  const dist = Math.hypot(land.x - x0, land.y - y0) || 1
  let dirX = launchDir ? launchDir.x : (land.x - x0) / dist
  let dirY = launchDir ? launchDir.y : (land.y - y0) / dist
  const norm = Math.hypot(dirX, dirY) || 1
  dirX /= norm
  dirY /= norm
  if (curveDir !== 0) {
    // Gira a saída para o lado oposto à curva (horário na tela = curva para a direita).
    const a = -curveDir * THROW_PHYSICS.curveLaunchRad * Math.max(1, turns)
    const rx = dirX * Math.cos(a) - dirY * Math.sin(a)
    const ry = dirX * Math.sin(a) + dirY * Math.cos(a)
    dirX = rx
    dirY = ry
  }
  // Topo do arco: acima da chegada. O lado é onde a linha do gesto chega nessa
  // altura (limitado, para um peteleco quase deitado não sair da tela).
  const cy = Math.min(y0, land.y) - THROW_PHYSICS.arcHeightPx
  const rise = y0 - cy
  const lineX = dirY < -0.2 ? x0 + (dirX / -dirY) * rise : (x0 + land.x) / 2
  const spread = Math.max(120, rise * 0.6)
  const cx = Math.max(Math.min(x0, land.x) - spread, Math.min(Math.max(x0, land.x) + spread, lineX))
  const { flightFastMs, flightSlowMs } = THROW_PHYSICS
  const startLen = Math.hypot(cx - x0, cy - y0)
  const durationMs = Math.min(flightSlowMs, Math.max(flightFastMs, ((2 * startLen) / Math.max(1, releaseSpeed)) * 1000))
  return {
    elapsedMs: 0,
    durationMs,
    x: x0,
    y: y0,
    depth: 0,
    scale: THROW_PHYSICS.ballScaleHand,
    spinAngle: 0,
    done: false,
    x0,
    y0,
    cx,
    cy,
    landX: land.x,
    landY: land.y,
    curveDir,
    spinSpeed,
  }
}

/**
 * Inicia o voo em coordenadas de tela (px).
 * curveDir: -1 esquerda, +1 direita, 0 reto (sem giro).
 */
export function beginFlight(input: {
  x0: number
  y0: number
  vx: number
  vy: number
  curveDir: -1 | 0 | 1
  spinning: boolean
  /** Voltas de giro (spinTurns); mais voltas, mais curva. */
  turns?: number
  /** Centro do alvo na tela (px): a força ideal chega na altura dele, e o auxílio puxa para ele. */
  targetX: number
  targetY: number
  /** Rotação da bola na mão ao soltar (rad e rad/s): o voo continua dela. */
  spinAngle?: number
  spinRate?: number
}): FlightState {
  const curveDir = input.spinning ? input.curveDir : 0
  const turns = input.spinning ? Math.max(1, input.turns ?? 1) : 0
  const land = landingPoint({
    x0: input.x0,
    vx: input.vx,
    vy: input.vy,
    curveDir,
    turns,
    targetX: input.targetX,
    targetY: input.targetY,
  })
  const spinRate = input.spinRate ?? curveDir * 10 * Math.max(1, turns)
  const releaseSpeed = Math.hypot(input.vx, input.vy)
  const flight = flightFrom(input.x0, input.y0, land, curveDir, spinRate, { x: input.vx, y: input.vy }, turns, releaseSpeed)
  return { ...flight, spinAngle: input.spinAngle ?? 0 }
}

/** Voo reto até o centro do alvo (a11y / toque simples). Sempre acerta. */
export function beginGuaranteedFlight(input: {
  x0: number
  y0: number
  targetX: number
  targetY: number
}): FlightState {
  return flightFrom(input.x0, input.y0, { x: input.targetX, y: input.targetY }, 0, 0)
}

/** Avança o voo; dt em ms. */
export function stepFlight(state: FlightState, dtMs: number): FlightState {
  if (state.done) return state
  const elapsedMs = Math.min(state.durationMs, state.elapsedMs + dtMs)
  const t = elapsedMs / state.durationMs
  // Bézier quadrática: termina exatamente no ponto de chegada.
  const u = 1 - t
  const x = u * u * state.x0 + 2 * u * t * state.cx + t * t * state.landX
  const y = u * u * state.y0 + 2 * u * t * state.cy + t * t * state.landY
  const depth = t
  const scale =
    THROW_PHYSICS.ballScaleHand +
    (THROW_PHYSICS.ballScaleTarget - THROW_PHYSICS.ballScaleHand) * depth
  const spinAngle = state.spinAngle + state.spinSpeed * (dtMs / 1000)
  return {
    ...state,
    elapsedMs,
    x,
    y,
    depth,
    scale,
    spinAngle,
    done: elapsedMs >= state.durationMs,
  }
}

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

export function qualityFromRing(distFromCenter: number, maxRingRadius: number, ringFrac: number): ThrowQuality {
  if (!(maxRingRadius > 0)) return 'normal'
  const ringR = maxRingRadius * ringFrac
  if (distFromCenter > ringR) return 'normal'
  const { ringExcellentFrac, ringGreatFrac, ringNiceFrac } = THROW_PHYSICS
  if (ringFrac <= ringExcellentFrac) return 'excellent'
  if (ringFrac <= ringGreatFrac) return 'great'
  if (ringFrac <= ringNiceFrac) return 'nice'
  return 'normal'
}

export function hitTest(x: number, y: number, target: TargetCircle): boolean {
  const dx = x - target.cx
  const dy = y - target.cy
  return dx * dx + dy * dy <= target.radius * target.radius
}

/** Deslocamento visual do alvo pela agitação (só front). */
export function agitationOffset(agitation: number, timeMs: number): { x: number; y: number } {
  const level = Math.max(0, agitation)
  if (level === 0) return { x: 0, y: 0 }
  const freq =
    THROW_PHYSICS.agitationFreqHz + THROW_PHYSICS.agitationFreqStepHz * (level - 1)
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
