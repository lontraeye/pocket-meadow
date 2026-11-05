// HP e máquina de cura (PROGRESSAO.md, 4.2): funções puras por timestamp.

import { healConfig } from '../config/heal.js'

/** Fração de HP depois de `elapsedMs` de descanso no jardim (teto 1). */
export function restHpRatio(hpRatio: number, elapsedMs: number, fullMs: number = healConfig.restFullMs): number {
  if (elapsedMs <= 0 || hpRatio >= 1) return clampRatio(hpRatio)
  return clampRatio(hpRatio + elapsedMs / fullMs)
}

export type SettledHp = {
  hpRatio: number
  /** null = não está desmaiado. */
  faintedAt: number | null
  /** null = fora do jardim (o descanso congela). */
  hpUpdatedAt: number | null
}

/**
 * HP no catch-up. Desmaiado (faintedAt) fica em 0 até faintedAt + faintRecoverMs,
 * em qualquer lugar. Ao voltar, ganha faintRecoverRatio; no jardim o descanso
 * conta a partir desse instante. Sem desmaio, o descanso só anda no jardim.
 */
export function settleHp(
  hpRatio: number,
  faintedAt: number | null,
  hpUpdatedAt: number | null,
  now: number,
  inGarden: boolean,
): SettledHp {
  if (faintedAt != null) {
    const wakeAt = faintedAt + healConfig.faintRecoverMs
    if (now < wakeAt) {
      return { hpRatio: 0, faintedAt, hpUpdatedAt: inGarden ? hpUpdatedAt : null }
    }
    const recovered = healConfig.faintRecoverRatio
    if (!inGarden) return { hpRatio: recovered, faintedAt: null, hpUpdatedAt: null }
    return {
      hpRatio: restHpRatio(recovered, now - wakeAt),
      faintedAt: null,
      hpUpdatedAt: now,
    }
  }
  if (!inGarden) return { hpRatio: clampRatio(hpRatio), faintedAt: null, hpUpdatedAt: null }
  const from = hpUpdatedAt
  if (from == null) return { hpRatio: clampRatio(hpRatio), faintedAt: null, hpUpdatedAt: now }
  return { hpRatio: restHpRatio(hpRatio, now - from), faintedAt: null, hpUpdatedAt: now }
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
