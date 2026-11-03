// HP e máquina de cura (PROGRESSAO.md, 4.2): funções puras por timestamp.

import { healConfig } from '../config/heal.js'

/** Fração de HP depois de `elapsedMs` de descanso no jardim (teto 1). */
export function restHpRatio(hpRatio: number, elapsedMs: number, fullMs: number = healConfig.restFullMs): number {
  if (elapsedMs <= 0 || hpRatio >= 1) return clampRatio(hpRatio)
  return clampRatio(hpRatio + elapsedMs / fullMs)
}

/** Cargas da máquina no instante `now`, a partir de `progress` em `since`. */
export function settleHealCharges(
  progress: number,
  since: number,
  now: number,
  max: number = healConfig.machine.maxCharges,
  rechargeMs: number = healConfig.machine.rechargeMs,
): number {
  if (now <= since || progress >= max) return Math.min(max, Math.max(0, progress))
  return Math.min(max, Math.max(0, progress) + (now - since) / rechargeMs)
}

/** Quando a próxima carga fica pronta; null se já está no máximo. */
export function nextHealChargeAt(
  progress: number,
  now: number,
  max: number = healConfig.machine.maxCharges,
  rechargeMs: number = healConfig.machine.rechargeMs,
): number | null {
  if (progress >= max) return null
  const next = Math.floor(progress) + 1
  return Math.ceil(now + (next - progress) * rechargeMs)
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 1
  if (ratio <= 0) return 0
  if (ratio >= 1) return 1
  return ratio
}
