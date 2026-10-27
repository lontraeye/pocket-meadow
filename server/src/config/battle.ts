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
  k: 4,
  minChance: 0.05,
  maxChance: 0.95,
  teamWeights: [1, 0.6, 0.4] as const,
  xpDiv: BATTLE_XP_DIV,
  xpLevelExp: BATTLE_XP_LEVEL_EXP,
  catchMult: 1.2,
  catchMin: 0.03,
} as const
