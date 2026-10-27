import { progressConfig, xpToNext } from '../config/progress.js'

export function grantXp(
  level: number,
  xp: number,
  gain: number,
  toNext: (level: number) => number = xpToNext,
  cap = progressConfig.levelCap,
): { level: number; xp: number; levelsGained: number } {
  if (gain < 0) throw new Error('xp gain must be >= 0')
  let nextLevel = level
  let nextXp = xp + gain
  let levelsGained = 0
  while (nextLevel < cap) {
    const need = toNext(nextLevel)
    if (need <= 0) throw new Error(`xp curve returned ${need} at level ${nextLevel}`)
    if (nextXp < need) break
    nextXp -= need
    nextLevel += 1
    levelsGained += 1
  }
  if (nextLevel >= cap) return { level: cap, xp: 0, levelsGained }
  return { level: nextLevel, xp: nextXp, levelsGained }
}
