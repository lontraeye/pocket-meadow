/**
 * Números da simulação de combate (5.18 / 8.2).
 * Valores iniciais propostos — calibrar depois das lutas no dev.
 */

export const simConfig = {
  /** Energia máxima da barra. */
  energyMax: 100,

  /**
   * Duração base (ms) do golpe rápido pela faixa de poder.
   * Rápido = poder ≤ 55 (traitsConfig.fastPowerMax).
   */
  fastCooldownMs: [
    { maxPower: 20, ms: 1100 },
    { maxPower: 40, ms: 1400 },
    { maxPower: 55, ms: 1700 },
  ] as const,

  /** Duração base (ms) do golpe carregado pela faixa de poder. */
  chargedCooldownMs: [
    { maxPower: 80, ms: 2800 },
    { maxPower: 100, ms: 3400 },
    { maxPower: 9999, ms: 4000 },
  ] as const,

  /** Energia gerada por golpe rápido (mesmas faixas de poder). */
  fastEnergyGain: [
    { maxPower: 20, gain: 8 },
    { maxPower: 40, gain: 10 },
    { maxPower: 55, gain: 12 },
  ] as const,

  /**
   * Custo de energia do carregado: 1/3, 1/2 ou barra inteira.
   * Faixas de poder do carregado (> 55).
   */
  chargedEnergyCost: [
    { maxPower: 80, cost: 33 },
    { maxPower: 100, cost: 50 },
    { maxPower: 9999, cost: 100 },
  ] as const,

  /**
   * Fator de Velocidade: 1 + k × (média − vel) / média, limitado.
   * Média = calcStat(base 80, IV 15, EV 0, nature neutra, mesmo nível).
   */
  speedFactorK: 4 / 10,
  speedFactorMin: 8 / 10,
  speedFactorMax: 12 / 10,
  speedRefBase: 80,
  speedRefIv: 15,

  /** Atraso sorteado (ms) depois que o cooldown do selvagem libera, antes de atacar. */
  aiFastDelayMinMs: 80,
  aiFastDelayMaxMs: 320,

  /** Chance de usar carregado quando a energia basta (por checagem). */
  aiChargedChance: 70 / 100,

  /** Intervalo após um aliado cair até o próximo entrar (ms). */
  faintSwitchDelayMs: 700,

  /** Cooldown após troca manual (ms). */
  switchCooldownMs: 2500,

  /** Tempo limite da luta (ms). */
  timeLimitMs: 60_000,

  /**
   * Multiplicador só do HP de luta (não altera os atributos guardados).
   * Proposto 3; calibrado em 2 com CDs alongados → ~6–10 s e ~8–12 golpes
   * (Rota 1, inicial Nv 5).
   */
  battleHpMultiplier: 2,

  /**
   * Folga (ms) ao validar finish: o cliente não pode enviar o fim antes do
   * tempo real desde o start alcançar a duração do log (menos esta folga).
   */
  finishEarlySlackMs: 400,

  /** Folga além do tempo limite para considerar a luta abandonada como derrota. */
  abandonSlackMs: 2000,
} as const

/** true se o tempo real ainda não alcançou a duração simulada. */
export function isFinishTooEarly(
  elapsedMs: number,
  durationMs: number,
  slackMs: number = simConfig.finishEarlySlackMs,
): boolean {
  return elapsedMs + slackMs < durationMs
}

export function bandValue(
  bands: readonly { maxPower: number; ms?: number; gain?: number; cost?: number }[],
  power: number,
  key: 'ms' | 'gain' | 'cost',
): number {
  for (const band of bands) {
    if (power <= band.maxPower) {
      const value = band[key]
      if (value === undefined) throw new Error(`band missing ${key}`)
      return value
    }
  }
  const last = bands[bands.length - 1]
  const value = last?.[key]
  if (value === undefined) throw new Error(`empty bands for ${key}`)
  return value
}
