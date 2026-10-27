import { daycareXpPerHour } from '../config/daycare.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { xpUntilCap } from './progression.js'
import { grantXp } from './xp.js'

export { daycareXpPerHour }

const hourMs = 60 * 60 * 1000

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

export type DaycareTimedBoost = {
  createdAt: number
  expiresAt: number
  multiplier: number
}

/**
 * A hora [start, end) ganha o bônus na fração que coincide com a janela do
 * efeito. As horas do daycare contam da entrada, não do uso da berry: com a
 * regra "só hora inteira", uma Nanab de 2 h usada no meio de uma hora cobriria
 * só 1 h. Proporcional, as 2 h valem 2 h.
 */
export function boostForHour(
  hourStart: number,
  boost: DaycareTimedBoost | null | undefined,
): number {
  if (!boost) return 1
  const overlap = Math.min(hourStart + hourMs, boost.expiresAt) - Math.max(hourStart, boost.createdAt)
  if (overlap <= 0) return 1
  return 1 + (boost.multiplier - 1) * Math.min(1, overlap / hourMs)
}

/**
 * Aplica `hours` horas de daycare. `boost` pode ser um número fixo (testes) ou
 * uma janela timed: cada hora olha o seu próprio multiplicador.
 */
export function applyDaycareHours(
  level: number,
  xp: number,
  hours: number,
  boost: number | DaycareTimedBoost | ((hourIndex: number) => number) = 1,
  options: { from?: number; cap?: number } = {},
): { level: number; xp: number; xpGained: number } {
  const cap: number = options.cap ?? progressConfig.levelCap
  const from = options.from ?? 0
  let nextLevel = level
  let nextXp = xp
  let xpGained = 0
  for (let hour = 0; hour < hours; hour += 1) {
    if (nextLevel >= cap) break
    const mult =
      typeof boost === 'function'
        ? boost(hour)
        : typeof boost === 'number'
          ? boost
          : boostForHour(from + hour * hourMs, boost)
    const rate = daycareXpPerHour(nextLevel, mult)
    const applied = Math.min(rate, xpUntilCap(nextLevel, nextXp, cap))
    const progressed = grantXp(nextLevel, nextXp, rate, xpToNext, cap)
    xpGained += applied
    nextLevel = progressed.level
    nextXp = progressed.xp
  }
  return { level: nextLevel, xp: nextXp, xpGained }
}
