// Constantes da seção 5.5 e 5.6 do PLANNING.md.
// SHINY_RATE, ENCOUNTER_TTL_MS, BATTLE_K, BATTLE_MIN, BATTLE_MAX,
// BATTLE_TEAM_WEIGHTS, BATTLE_XP = wildLevel * xpPerWildLevel, CATCH_MULT, CATCH_MIN.
export const battleConfig = {
  shinyRate: 1 / 512,
  encounterTtlMs: 30 * 60 * 1000,
  k: 4,
  minChance: 0.05,
  maxChance: 0.95,
  teamWeights: [1, 0.6, 0.4] as const,
  xpPerWildLevel: 5,
  catchMult: 1.2,
  catchMin: 0.03,
} as const
