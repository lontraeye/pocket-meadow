// Doces, alimentação e XP de evolução (PLANNING.md, seções 5.7 e 5.8).
export const RELEASE_BASE = 3
export const RELEASE_LEVEL_DIV = 5
export const RELEASE_SHINY_MULT = 3
export const RELEASE_GENERIC = 1
export const RELEASE_MAX_PER_REQUEST = 50
export const CANDY_XP = 25
export const GENERIC_PER_CANDY = 3
export const FEED_MAX_PER_REQUEST = 999
export const EVOLVE_XP_BY_STAGE = { 2: 30, 3: 60 } as const
export const NICKNAME_MAX = 12

export const progressionConfig = {
  releaseBase: RELEASE_BASE,
  releaseLevelDiv: RELEASE_LEVEL_DIV,
  releaseShinyMult: RELEASE_SHINY_MULT,
  releaseGeneric: RELEASE_GENERIC,
  releaseMaxPerRequest: RELEASE_MAX_PER_REQUEST,
  candyXp: CANDY_XP,
  genericPerCandy: GENERIC_PER_CANDY,
  feedMaxPerRequest: FEED_MAX_PER_REQUEST,
  evolveXpByStage: EVOLVE_XP_BY_STAGE,
  nicknameMax: NICKNAME_MAX,
} as const

export function evolveTrainerXp(stage: number): number {
  if (stage === 2) return EVOLVE_XP_BY_STAGE[2]
  if (stage === 3) return EVOLVE_XP_BY_STAGE[3]
  return 0
}
