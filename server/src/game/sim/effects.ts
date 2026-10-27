/** Tipos e helpers de status / estágios / crítico (8.6). Só aritmética pura. */

export type StatusCondition = 'burn' | 'poison' | 'paralysis' | 'sleep' | 'freeze'

export type MoveAilment = StatusCondition | 'confusion'

export type StageStat = 'attack' | 'defense' | 'spAttack' | 'spDefense' | 'speed'

export type StatChange = { stat: StageStat; stages: number }

export type MoveEffectFields = {
  ailment: MoveAilment | null
  ailmentChance: number
  statChanges: StatChange[]
  statChance: number
  /** true = buff no usuário; false = no alvo. */
  statOnSelf: boolean
  /** % do dano: positivo = cura, negativo = recuo. */
  drain: number
  /** 0 = normal (1/24); ≥1 = alto (1/8). */
  critRate: number
}

export const emptyMoveEffects: MoveEffectFields = {
  ailment: null,
  ailmentChance: 0,
  statChanges: [],
  statChance: 0,
  statOnSelf: false,
  drain: 0,
  critRate: 0,
}

export type Stages = Record<StageStat, number>

export function emptyStages(): Stages {
  return { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 }
}

/** Multiplicador de estágio: (2+n)/2 para cima, 2/(2−n) para baixo. */
export function stageFactor(stages: number): { num: number; den: number } {
  const n = stages
  if (n >= 0) return { num: 2 + n, den: 2 }
  return { num: 2, den: 2 - n }
}

export function applyStage(stat: number, stages: number): number {
  const { num, den } = stageFactor(stages)
  return Math.max(1, Math.floor((stat * num) / den))
}

export function clampStage(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Chance de crítico: denominador da fração 1/N. */
export function critChanceDenom(
  critRate: number,
  abilityKey: string,
  normalDenom: number,
  highDenom: number,
  superDenom: number,
): number {
  let denom = critRate >= 1 ? highDenom : normalDenom
  if (abilityKey === 'super-luck') {
    if (denom === normalDenom) denom = highDenom
    else denom = superDenom
  }
  return denom
}

export function isCritImmune(abilityKey: string): boolean {
  return abilityKey === 'battle-armor' || abilityKey === 'shell-armor'
}
