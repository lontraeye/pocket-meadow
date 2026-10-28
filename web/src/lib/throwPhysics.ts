/**
 * Física do arremesso (Fase 9.4). Funções puras; a tela só chama e anima.
 * Todos os números ajustáveis ficam em THROW_PHYSICS — revisar no celular.
 */

export const THROW_PHYSICS = {
  /** Janela (ms) para estimar a velocidade ao soltar. */
  velocitySampleMs: 80,
  /**
   * Velocidade mínima para cima (px/s, eixo Y da tela cresce para baixo).
   * Soltar mais fraco ou para baixo → bola volta, sem gastar.
   */
  minUpSpeedPx: 420,
  /** Ângulo acumulado (rad) no mesmo sentido para contar como "girando". */
  spinThresholdRad: Math.PI * 2,
  /** Duração do voo (ms), interpolada pela força do gesto. */
  flightMinMs: 620,
  flightMaxMs: 880,
  /**
   * Quão forte o gesto precisa ser (px/s para cima) para atingir flightMinMs.
   * Acima disso encurta até flightMax… na verdade: mais rápido → voo um pouco mais curto.
   */
  flightSpeedForMinMs: 1200,
  /** Gravidade em px/s² durante o voo (puxa para baixo na tela). */
  gravityPx: 1600,
  /** Aceleração lateral da curva (px/s²), sinal = sentido do giro. */
  curveAccelPx: 900,
  /** Ciclo completo do anel encolher→expandir (ms). */
  ringPeriodMs: 1200,
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
  /** Último ângulo do dedo em relação ao centro (rad, -π..π). */
  lastAngle: number | null
  /** Ângulo acumulado com sinal (positivo = anti-horário na tela). */
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
  // internos
  x0: number
  y0: number
  vx: number
  vy: number
  curveDir: -1 | 0 | 1
  spinSpeed: number
}

/** Velocidade média (px/s) nos últimos velocitySampleMs. */
export function sampleVelocity(samples: readonly PointerSample[], now = samples.at(-1)?.t ?? 0): {
  vx: number
  vy: number
} {
  const windowMs = THROW_PHYSICS.velocitySampleMs
  const recent = samples.filter((s) => now - s.t <= windowMs)
  if (recent.length < 2) return { vx: 0, vy: 0 }
  const a = recent[0]!
  const b = recent[recent.length - 1]!
  const dt = (b.t - a.t) / 1000
  if (!(dt > 0)) return { vx: 0, vy: 0 }
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt }
}

/** Atualiza o giro a partir da posição do dedo em relação ao centro da bola. */
export function accumulateSpin(state: SpinState, centerX: number, centerY: number, x: number, y: number): SpinState {
  const angle = Math.atan2(y - centerY, x - centerX)
  if (state.lastAngle === null) {
    return { lastAngle: angle, accumulated: 0, direction: 0 }
  }
  let delta = angle - state.lastAngle
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  const accumulated = state.accumulated + delta
  const direction: -1 | 0 | 1 =
    Math.abs(accumulated) < 0.2 ? 0 : accumulated > 0 ? 1 : -1
  return { lastAngle: angle, accumulated, direction }
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

export function flightDurationMs(upSpeedPx: number): number {
  const { flightMinMs, flightMaxMs, flightSpeedForMinMs, minUpSpeedPx } = THROW_PHYSICS
  const span = Math.max(1, flightSpeedForMinMs - minUpSpeedPx)
  const t = Math.min(1, Math.max(0, (upSpeedPx - minUpSpeedPx) / span))
  // Mais forte → um pouco mais rápido (menor duração).
  return flightMaxMs - t * (flightMaxMs - flightMinMs)
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
}): FlightState {
  const up = Math.max(0, -input.vy)
  const durationMs = flightDurationMs(up)
  return {
    elapsedMs: 0,
    durationMs,
    x: input.x0,
    y: input.y0,
    depth: 0,
    scale: THROW_PHYSICS.ballScaleHand,
    spinAngle: 0,
    done: false,
    x0: input.x0,
    y0: input.y0,
    vx: input.vx,
    vy: input.vy,
    curveDir: input.spinning ? input.curveDir : 0,
    spinSpeed: input.spinning ? input.curveDir * 14 : 0,
  }
}

/** Voo reto até o centro do alvo (a11y / toque simples). Sempre acerta. */
export function beginGuaranteedFlight(input: {
  x0: number
  y0: number
  targetX: number
  targetY: number
}): FlightState {
  const durationMs = THROW_PHYSICS.flightMinMs
  const dx = input.targetX - input.x0
  const dy = input.targetY - input.y0
  // Sem gravidade efetiva: vx/vy constantes levam ao alvo em durationMs.
  const vx = (dx / durationMs) * 1000
  const vy = (dy / durationMs) * 1000
  return {
    elapsedMs: 0,
    durationMs,
    x: input.x0,
    y: input.y0,
    depth: 0,
    scale: THROW_PHYSICS.ballScaleHand,
    spinAngle: 0,
    done: false,
    x0: input.x0,
    y0: input.y0,
    vx,
    vy,
    curveDir: 0,
    spinSpeed: 0,
  }
}

/** Avança o voo; dt em ms. */
export function stepFlight(state: FlightState, dtMs: number): FlightState {
  if (state.done) return state
  const elapsedMs = Math.min(state.durationMs, state.elapsedMs + dtMs)
  const t = elapsedMs / state.durationMs
  const sec = elapsedMs / 1000
  const g = THROW_PHYSICS.gravityPx
  const curve = THROW_PHYSICS.curveAccelPx * state.curveDir
  // Posição cinemática clássica + aceleração lateral da curva.
  const x = state.x0 + state.vx * sec + 0.5 * curve * sec * sec
  const y = state.y0 + state.vy * sec + 0.5 * g * sec * sec
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
