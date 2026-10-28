import { battleConfig } from '../config/battle.js'

/** Chance de fuga depois de um erro, com a agitação já incrementada. */
export function fleeChanceAt(agitationAfterMiss: number): number {
  const steps = Math.max(0, agitationAfterMiss - 1)
  return Math.min(battleConfig.fleeMax, battleConfig.fleeBase + battleConfig.fleeStep * steps)
}

/** Aplica acalmar da berry (antes do lançamento). `all` zera; número reduz até 0. */
export function calmAgitation(current: number, calm: number | 'all' | undefined): number {
  if (calm === undefined) return Math.max(0, current)
  if (calm === 'all') return 0
  return Math.max(0, current - calm)
}
