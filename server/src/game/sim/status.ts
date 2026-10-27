import type { PokemonType } from '../../config/types.js'
import { simConfig } from './config.js'
import { clampStage, emptyStages, type MoveAilment, type Stages, type StatusCondition } from './effects.js'
import type { BattleEvent, SimFighter } from './types.js'
import type { Rng } from '../mulberry32.js'

export function typeBlocksAilment(ailment: MoveAilment, types: readonly PokemonType[]): boolean {
  if (ailment === 'burn' && types.includes('fire')) return true
  if (ailment === 'paralysis' && types.includes('electric')) return true
  if (ailment === 'poison' && (types.includes('poison') || types.includes('steel'))) return true
  if (ailment === 'freeze' && types.includes('ice')) return true
  return false
}

export function abilityBlocksAilment(abilityKey: string, ailment: MoveAilment): boolean {
  if (ailment === 'poison' && abilityKey === 'immunity') return true
  if (ailment === 'paralysis' && abilityKey === 'limber') return true
  if (ailment === 'sleep' && (abilityKey === 'insomnia' || abilityKey === 'vital-spirit')) return true
  if (ailment === 'burn' && abilityKey === 'water-veil') return true
  if (ailment === 'freeze' && abilityKey === 'magma-armor') return true
  if (ailment === 'confusion' && abilityKey === 'own-tempo') return true
  return false
}

export function canReceiveAilment(
  ailment: MoveAilment,
  fighter: SimFighter,
): boolean {
  if (typeBlocksAilment(ailment, fighter.types)) return false
  if (abilityBlocksAilment(fighter.abilityKey, ailment)) return false
  return true
}

export type StatusSide = {
  fighter: SimFighter
  status: StatusCondition | null
  /** Instantes em que sleep/freeze acaba; 0 se N/A. */
  statusUntil: number
  confusionUntil: number
  stages: Stages
  nextStatusTickAt: number | null
  nextShedSkinAt: number | null
}

export function initStatusFields(): Pick<
  StatusSide,
  'status' | 'statusUntil' | 'confusionUntil' | 'stages' | 'nextStatusTickAt' | 'nextShedSkinAt'
> {
  return {
    status: null,
    statusUntil: 0,
    confusionUntil: 0,
    stages: emptyStages(),
    nextStatusTickAt: null,
    nextShedSkinAt: null,
  }
}

export function isImmobilized(side: StatusSide, t: number): 'sleep' | 'freeze' | null {
  if (side.status === 'sleep' && t < side.statusUntil) return 'sleep'
  if (side.status === 'freeze' && t < side.statusUntil) return 'freeze'
  return null
}

/** Limpa sleep/freeze quando o tempo acaba. */
export function tickStatusExpiry(
  side: StatusSide,
  t: number,
  push: (event: BattleEvent) => void,
  sideKey: 'player' | 'wild',
): void {
  if ((side.status === 'sleep' || side.status === 'freeze') && t >= side.statusUntil) {
    const cleared = side.status
    side.status = null
    side.statusUntil = 0
    push({ t, kind: 'status', side: sideKey, status: cleared, applied: false })
  }
  if (side.confusionUntil > 0 && t >= side.confusionUntil) {
    side.confusionUntil = 0
    push({ t, kind: 'status', side: sideKey, status: 'confusion', applied: false })
  }
}

export function tryApplyAilment(
  side: StatusSide,
  ailment: MoveAilment,
  t: number,
  push: (event: BattleEvent) => void,
  sideKey: 'player' | 'wild',
): boolean {
  if (!canReceiveAilment(ailment, side.fighter)) return false
  if (ailment === 'confusion') {
    if (side.confusionUntil > t) return false
    side.confusionUntil = t + simConfig.confusionDurationMs
    push({ t, kind: 'status', side: sideKey, status: 'confusion', applied: true })
    return true
  }
  if (side.status !== null) return false
  side.status = ailment
  if (ailment === 'sleep') {
    const dur =
      side.fighter.abilityKey === 'early-bird'
        ? Math.floor(simConfig.sleepDurationMs / 2)
        : simConfig.sleepDurationMs
    side.statusUntil = t + dur
  } else if (ailment === 'freeze') {
    side.statusUntil = t + simConfig.freezeDurationMs
  } else {
    side.statusUntil = 0
    side.nextStatusTickAt = t + simConfig.statusTickMs
  }
  if (side.fighter.abilityKey === 'shed-skin') {
    side.nextShedSkinAt = t + simConfig.shedSkinIntervalMs
  }
  push({ t, kind: 'status', side: sideKey, status: ailment, applied: true })
  return true
}

export function clearStatus(
  side: StatusSide,
  t: number,
  push: (event: BattleEvent) => void,
  sideKey: 'player' | 'wild',
): void {
  if (side.status !== null) {
    const cleared = side.status
    side.status = null
    side.statusUntil = 0
    side.nextStatusTickAt = null
    side.nextShedSkinAt = null
    push({ t, kind: 'status', side: sideKey, status: cleared, applied: false })
  }
}

export function thawIfFireHit(side: StatusSide, moveType: string, t: number, push: (e: BattleEvent) => void, sideKey: 'player' | 'wild'): void {
  if (side.status === 'freeze' && moveType === 'fire') {
    clearStatus(side, t, push, sideKey)
  }
}

export function applyStageChange(
  side: StatusSide,
  stat: keyof Stages,
  delta: number,
  t: number,
  push: (event: BattleEvent) => void,
  sideKey: 'player' | 'wild',
): void {
  const before = side.stages[stat]
  const after = clampStage(before + delta, simConfig.stageMin, simConfig.stageMax)
  if (after === before) return
  side.stages[stat] = after
  push({ t, kind: 'stat_change', side: sideKey, stat, stages: after - before, value: after })
}

export function resetStages(side: StatusSide): void {
  side.stages = emptyStages()
}

export function effectChancePercent(
  baseChance: number,
  isFast: boolean,
  sereneGrace: boolean,
): number {
  let chance = baseChance
  if (isFast) chance = Math.floor(chance / simConfig.fastEffectChanceDivisor)
  if (sereneGrace) chance = chance * 2
  if (chance < 0) return 0
  if (chance > 100) return 100
  return chance
}

export function rollPercent(rng: Rng, chance: number): boolean {
  if (chance <= 0) return false
  if (chance >= 100) return true
  return Math.floor(rng() * 100) < chance
}

export function statusDotDamage(maxHp: number): number {
  return Math.max(1, Math.floor(maxHp / simConfig.statusDotDenom))
}
