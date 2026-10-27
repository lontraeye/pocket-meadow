import { traitsConfig } from '../../config/traits.js'
import { isPokemonType, typeEffectiveness, type PokemonType } from '../../config/types.js'
import { calcStat } from '../stats.js'
import { bandValue, simConfig } from './config.js'
import {
  applyStage,
  critChanceDenom,
  isCritImmune,
  type Stages,
} from './effects.js'
import type { DamageClass, SimFighter, SimMove, StatusCondition } from './types.js'
import type { Rng } from '../mulberry32.js'

/** Fator de Velocidade 0,8–1,2 (PLANNING 8.2), com estágio de Velocidade. */
export function speedFactor(speed: number, level: number, speedStages = 0): number {
  const staged = applyStage(speed, speedStages)
  const average = calcStat(
    simConfig.speedRefBase,
    simConfig.speedRefIv,
    0,
    level,
    'hardy',
    'speed',
  )
  if (!(average > 0)) return 1
  const raw = 1 + (simConfig.speedFactorK * (average - staged)) / average
  return Math.min(simConfig.speedFactorMax, Math.max(simConfig.speedFactorMin, raw))
}

export function moveCooldownMs(
  move: SimMove,
  speed: number,
  level: number,
  speedStages = 0,
  paralyzed = false,
): number {
  const bands =
    move.power <= traitsConfig.fastPowerMax ? simConfig.fastCooldownMs : simConfig.chargedCooldownMs
  const base = bandValue(bands, move.power, 'ms')
  let ms = Math.max(1, Math.floor(base * speedFactor(speed, level, speedStages)))
  if (paralyzed) {
    ms = Math.max(1, Math.floor((ms * simConfig.paralysisCooldownNum) / simConfig.paralysisCooldownDen))
  }
  return ms
}

export function fastEnergyGain(power: number): number {
  return bandValue(simConfig.fastEnergyGain, power, 'gain')
}

export function chargedEnergyCost(power: number): number {
  return bandValue(simConfig.chargedEnergyCost, power, 'cost')
}

export function typeMultiplier(moveType: PokemonType, defenderTypes: readonly PokemonType[]): number {
  let mult = 1
  for (const def of defenderTypes) {
    mult = mult * typeEffectiveness[moveType][def]
  }
  return mult
}

export type DamageInput = {
  attacker: SimFighter
  defender: SimFighter
  move: SimMove
  /** Ataque efetivo (já com habilidades / estágios / status). */
  attackStat: number
  /** Defesa efetiva do alvo. */
  defenseStat: number
  /** HP atual do atacante (Blaze etc.). */
  attackerHp: number
  /** HP máximo de luta do atacante (com battleHpMultiplier). */
  attackerMaxHp: number
  /** HP atual do defensor (Sturdy). */
  defenderHp: number
  /** HP máximo de luta do defensor (com battleHpMultiplier). */
  defenderMaxHp: number
  critical: boolean
  rng: Rng
}

/**
 * Dano: ⌊(⌊2L/5⌋+2) · Poder · A/D / 50⌋ + 2, depois STAB ×3/2,
 * efetividade, crítico e fator 85–100. Mínimo 1, salvo imunidade (0).
 */
export function calcDamage(input: DamageInput): number {
  const {
    attacker,
    defender,
    move,
    attackStat,
    defenseStat,
    attackerHp,
    attackerMaxHp,
    defenderHp,
    defenderMaxHp,
    critical,
    rng,
  } = input
  if (!isPokemonType(move.type)) return 1

  const immune = abilityImmunity(defender.abilityKey, move.type)
  if (immune.immune) return 0

  const level = attacker.level
  const a = Math.max(1, attackStat)
  const d = Math.max(1, defenseStat)
  let damage =
    Math.floor((((Math.floor((2 * level) / 5) + 2) * move.power * a) / d) / 50) + 2

  if (attacker.types.includes(move.type)) {
    damage = Math.floor((damage * 3) / 2)
  }

  const eff = typeMultiplier(move.type, defender.types)
  damage = applyEffectiveness(damage, eff)

  if (defender.abilityKey === 'thick-fat' && (move.type === 'fire' || move.type === 'ice')) {
    damage = Math.floor(damage / 2)
  }

  if (typeBoostAbility(attacker.abilityKey, move.type, attackerHp, attackerMaxHp)) {
    damage = Math.floor((damage * 3) / 2)
  }

  if (critical) {
    if (attacker.abilityKey === 'sniper') {
      damage = Math.floor((damage * simConfig.sniperCritDamageNum) / simConfig.sniperCritDamageDen)
    } else {
      damage = Math.floor((damage * simConfig.critDamageNum) / simConfig.critDamageDen)
    }
  }

  const roll = 85 + Math.floor(rng() * 16)
  damage = Math.floor((damage * roll) / 100)

  if (eff === 0) return 0
  if (damage < 1) damage = 1

  if (defender.abilityKey === 'sturdy' && defenderHp === defenderMaxHp && damage >= defenderHp) {
    return defenderHp - 1
  }

  return damage
}

function applyEffectiveness(damage: number, eff: number): number {
  if (eff === 0) return 0
  if (eff === 1) return damage
  if (eff === 2) return damage * 2
  if (eff === 4) return damage * 4
  if (eff === 0.5) return Math.floor(damage / 2)
  if (eff === 0.25) return Math.floor(damage / 4)
  return Math.floor((damage * Math.floor(eff * 100)) / 100)
}

export function abilityImmunity(
  abilityKey: string,
  moveType: PokemonType,
): { immune: boolean; healFraction: number } {
  if (abilityKey === 'levitate' && moveType === 'ground') return { immune: true, healFraction: 0 }
  if (abilityKey === 'flash-fire' && moveType === 'fire') return { immune: true, healFraction: 0 }
  if (abilityKey === 'water-absorb' && moveType === 'water') return { immune: true, healFraction: 1 / 4 }
  if (abilityKey === 'volt-absorb' && moveType === 'electric') return { immune: true, healFraction: 1 / 4 }
  return { immune: false, healFraction: 0 }
}

function typeBoostAbility(
  abilityKey: string,
  moveType: PokemonType,
  hp: number,
  maxHp: number,
): boolean {
  if (hp * 3 > maxHp) return false
  if (abilityKey === 'blaze' && moveType === 'fire') return true
  if (abilityKey === 'torrent' && moveType === 'water') return true
  if (abilityKey === 'overgrow' && moveType === 'grass') return true
  if (abilityKey === 'swarm' && moveType === 'bug') return true
  return false
}

/** Estágio de ataque efetivo no crítico: ignora estágios negativos. */
export function attackStagesForCrit(stages: number, critical: boolean): number {
  if (critical && stages < 0) return 0
  return stages
}

/** Estágio de defesa efetivo no crítico: ignora estágios positivos. */
export function defenseStagesForCrit(stages: number, critical: boolean): number {
  if (critical && stages > 0) return 0
  return stages
}

export function offensiveStat(
  fighter: SimFighter,
  damageClass: DamageClass,
  stages: Stages,
  status: StatusCondition | null,
  critical: boolean,
): number {
  const key = damageClass === 'physical' ? 'attack' : 'spAttack'
  let atk = damageClass === 'physical' ? fighter.stats.attack : fighter.stats.spAttack
  if (damageClass === 'physical') {
    if (fighter.abilityKey === 'huge-power') atk = atk * 2
    if (fighter.abilityKey === 'hustle') atk = Math.floor((atk * 3) / 2)
    if (status !== null && fighter.abilityKey === 'guts') {
      atk = Math.floor((atk * simConfig.gutsAttackNum) / simConfig.gutsAttackDen)
    }
  }
  const stage = attackStagesForCrit(stages[key], critical)
  atk = applyStage(atk, stage)
  if (
    damageClass === 'physical' &&
    status === 'burn' &&
    fighter.abilityKey !== 'guts'
  ) {
    atk = Math.floor((atk * simConfig.burnAttackNum) / simConfig.burnAttackDen)
  }
  return Math.max(1, atk)
}

export function defensiveStat(
  fighter: SimFighter,
  damageClass: DamageClass,
  stages: Stages,
  status: StatusCondition | null,
  critical: boolean,
): number {
  const key = damageClass === 'physical' ? 'defense' : 'spDefense'
  let def = damageClass === 'physical' ? fighter.stats.defense : fighter.stats.spDefense
  if (damageClass === 'physical' && status !== null && fighter.abilityKey === 'marvel-scale') {
    def = Math.floor((def * simConfig.marvelScaleDefNum) / simConfig.marvelScaleDefDen)
  }
  const stage = defenseStagesForCrit(stages[key], critical)
  return Math.max(1, applyStage(def, stage))
}

/** Battle Armor e Shell Armor protegem quem recebe: ver rollCriticalAgainst. */
export function rollCritical(move: SimMove, attacker: SimFighter, rng: Rng): boolean {
  const denom = critChanceDenom(
    move.critRate,
    attacker.abilityKey,
    simConfig.critChanceNormalDenom,
    simConfig.critChanceHighDenom,
    simConfig.critChanceSuperLuckDenom,
  )
  return Math.floor(rng() * denom) === 0
}

export function rollCriticalAgainst(
  move: SimMove,
  attacker: SimFighter,
  defender: SimFighter,
  rng: Rng,
): boolean {
  if (isCritImmune(defender.abilityKey)) return false
  return rollCritical(move, attacker, rng)
}
