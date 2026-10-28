// Constantes da seção 5.5 e 5.6 do PLANNING.md.
// SHINY_RATE, ENCOUNTER_TTL_MS, BATTLE_K, BATTLE_MIN, BATTLE_MAX,
// BATTLE_TEAM_WEIGHTS, BATTLE_XP_DIV, BATTLE_XP_LEVEL_EXP, CATCH_MULT, CATCH_MIN.
// Raro = peso até este valor na escala normalizada para 100 (seção 5.3).
export const RARE_WEIGHT_MAX = 10
export const BATTLE_XP_DIV = 5
export const BATTLE_XP_LEVEL_EXP = 2.5

export const battleConfig = {
  shinyRate: 1 / 512,
  encounterTtlMs: 30 * 60 * 1000,
  /** Prazo para decidir a captura depois da vitória (8.4). */
  decisionTtlMs: 10 * 60 * 1000,
  /**
   * Fuga crescente (Fase 9.2): depois do erro, agitação já somou 1.
   * chance = min(fleeMax, fleeBase + fleeStep × (agitation − 1)).
   * `throwFleeChance` fica só como fallback legado em testes antigos.
   */
  throwFleeChance: 0.25,
  fleeBase: 0.1,
  fleeStep: 0.15,
  fleeMax: 0.9,
  k: 4,
  minChance: 0.05,
  maxChance: 0.95,
  teamWeights: [1, 0.6, 0.4] as const,
  xpDiv: BATTLE_XP_DIV,
  xpLevelExp: BATTLE_XP_LEVEL_EXP,
  catchMult: 1.2,
  catchMin: 0.03,
  /** Qualidade do arremesso (Fase 9.4). Multiplica a chance junto da bola/berry. */
  throwQualityMult: {
    normal: 1,
    nice: 1.15,
    great: 1.4,
    excellent: 1.8,
  },
  /** Bônus de curva (independente da qualidade). */
  throwCurveMult: 1.3,
} as const

export type ThrowQuality = keyof typeof battleConfig.throwQualityMult

export const THROW_QUALITIES = Object.keys(battleConfig.throwQualityMult) as ThrowQuality[]

/** Multiplicador total do arremesso: qualidade × (curva ou 1). */
export function throwAimMult(quality: ThrowQuality, curve: boolean): number {
  const q = battleConfig.throwQualityMult[quality]
  return q * (curve ? battleConfig.throwCurveMult : 1)
}

export function parseThrowQuality(value: unknown): ThrowQuality | null {
  if (typeof value !== 'string') return null
  return (THROW_QUALITIES as readonly string[]).includes(value) ? (value as ThrowQuality) : null
}
