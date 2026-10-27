import type { ProgressionRules } from './api'

export function xpToNext(level: number, rules: ProgressionRules): number {
  return Math.floor(rules.xpBase * level ** rules.xpExponent)
}

export function dosesToCap(level: number, xp: number, rules: ProgressionRules): number {
  if (level >= rules.levelCap) return 0
  let missing = xpToNext(level, rules) - xp
  for (let cursor = level + 1; cursor < rules.levelCap; cursor += 1) missing += xpToNext(cursor, rules)
  if (missing <= 0) return 0
  return Math.ceil(missing / rules.candyXp)
}

export function previewFeed(level: number, xp: number, doses: number, rules: ProgressionRules): { level: number; xp: number } {
  let nextLevel = level
  let nextXp = xp + doses * rules.candyXp
  while (nextLevel < rules.levelCap) {
    const need = xpToNext(nextLevel, rules)
    if (nextXp < need) break
    nextXp -= need
    nextLevel += 1
  }
  if (nextLevel >= rules.levelCap) return { level: rules.levelCap, xp: 0 }
  return { level: nextLevel, xp: nextXp }
}

export function releaseYield(level: number, isShiny: boolean, rules: ProgressionRules): { chain: number; generic: number } {
  const chain = rules.releaseBase + Math.floor(level / rules.releaseLevelDiv)
  return {
    chain: isShiny ? chain * rules.releaseShinyMult : chain,
    generic: rules.releaseGeneric,
  }
}
