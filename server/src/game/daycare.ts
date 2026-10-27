import { daycareXpPerHour } from '../config/daycare.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { xpUntilCap } from './progression.js'
import { grantXp } from './xp.js'

export { daycareXpPerHour }

/** Desfaz `grantXp` para descobrir o nível de entrada a partir do XP da estadia. */
export function rewindXp(
  level: number,
  xp: number,
  amount: number,
): { level: number; xp: number } {
  if (amount < 0) throw new Error('xp amount must be >= 0')
  let nextLevel = level
  let nextXp = xp
  let remaining = amount
  while (remaining > 0) {
    if (nextXp > 0) {
      const take = Math.min(nextXp, remaining)
      nextXp -= take
      remaining -= take
      continue
    }
    if (nextLevel <= 1) return { level: 1, xp: 0 }
    nextLevel -= 1
    nextXp = xpToNext(nextLevel)
  }
  return { level: nextLevel, xp: nextXp }
}

export function levelsGainedFromStay(level: number, xp: number, xpGained: number): number {
  if (xpGained <= 0) return 0
  const start = rewindXp(level, xp, xpGained)
  return Math.max(0, level - start.level)
}

/** Aplica `hours` horas de daycare, com a taxa subindo quando o nível sobe. */
export function applyDaycareHours(
  level: number,
  xp: number,
  hours: number,
  boost = 1,
  cap = progressConfig.levelCap,
): { level: number; xp: number; xpGained: number } {
  let nextLevel = level
  let nextXp = xp
  let xpGained = 0
  for (let hour = 0; hour < hours; hour += 1) {
    if (nextLevel >= cap) break
    const rate = daycareXpPerHour(nextLevel, boost)
    const applied = Math.min(rate, xpUntilCap(nextLevel, nextXp, cap))
    const progressed = grantXp(nextLevel, nextXp, rate, xpToNext, cap)
    xpGained += applied
    nextLevel = progressed.level
    nextXp = progressed.xp
  }
  return { level: nextLevel, xp: nextXp, xpGained }
}
