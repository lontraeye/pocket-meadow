import { daycareConfig } from '../config/daycare.js'
import { progressConfig } from '../config/progress.js'
import { trainerConfig } from '../config/trainer.js'
import { applyDaycareHours, type DaycareTimedBoost } from './daycare.js'

export type CatchUpState = {
  trainer: { energy: number; energyUpdatedAt: number }
  daycare: {
    pokemonId: number
    level: number
    xp: number
    enteredAt: number
    lastSettledAt: number
  }[]
  effects: {
    id: number
    effectKey: string
    multiplier: number
    createdAt: number
    expiresAt: number | null
  }[]
  encounters: { id: number; status: string; expiresAt: number }[]
}

export type CatchUpResult = {
  trainer: { energy: number; energyUpdatedAt: number }
  energyNextAt: number | null
  daycare: { pokemonId: number; level: number; xp: number; lastSettledAt: number; xpGained: number }[]
  deleteEffectIds: number[]
  fleeEncounterIds: number[]
}

const hourMs = 60 * 60 * 1000

export function applyCatchUp(state: CatchUpState, now: number): CatchUpResult {
  const trainer = catchUpEnergy(state.trainer, now)
  // Liquidar o daycare antes de apagar efeitos vencidos: horas passadas ainda
  // usam a janela do Nanab (PLANNING.md, seção 5.10).
  const daycareBoost = timedDaycareBoost(state.effects) ?? 1
  const daycare = state.daycare.flatMap((slot) => {
    const settled = settleDaycare(slot, now, daycareBoost)
    return settled === undefined ? [] : [settled]
  })
  const deleteEffectIds = state.effects
    .filter((effect) => effect.expiresAt !== null && effect.expiresAt <= now)
    .map((effect) => effect.id)
  const fleeEncounterIds = state.encounters
    .filter((encounter) => encounter.status === 'pending' && encounter.expiresAt <= now)
    .map((encounter) => encounter.id)

  return {
    trainer,
    energyNextAt: nextEnergyAt(trainer.energy, trainer.energyUpdatedAt),
    daycare,
    deleteEffectIds,
    fleeEncounterIds,
  }
}

function timedDaycareBoost(effects: CatchUpState['effects']): DaycareTimedBoost | null {
  const boost = effects.find((effect) => effect.effectKey === 'daycare_boost' && effect.expiresAt !== null)
  if (!boost || boost.expiresAt === null) return null
  return { createdAt: boost.createdAt, expiresAt: boost.expiresAt, multiplier: boost.multiplier }
}

function catchUpEnergy(
  trainer: CatchUpState['trainer'],
  now: number,
): CatchUpResult['trainer'] {
  const elapsed = now - trainer.energyUpdatedAt
  if (trainer.energy >= trainerConfig.energyMax) {
    return { energy: trainer.energy, energyUpdatedAt: now }
  }
  const gained = Math.floor(elapsed / progressConfig.energyRegenMs)
  if (gained <= 0) return { ...trainer }
  const energy = Math.min(trainerConfig.energyMax, trainer.energy + gained)
  return {
    energy,
    energyUpdatedAt: energy >= trainerConfig.energyMax ? now : trainer.energyUpdatedAt + gained * progressConfig.energyRegenMs,
  }
}

export function settleDaycare(
  slot: CatchUpState['daycare'][number],
  now: number,
  boost: number | DaycareTimedBoost = 1,
): CatchUpResult['daycare'][number] | undefined {
  const end = Math.min(now, slot.enteredAt + daycareConfig.maxMs)
  const hours = Math.floor((end - slot.lastSettledAt) / hourMs)
  if (hours <= 0) return undefined

  const { level, xp, xpGained } = applyDaycareHours(slot.level, slot.xp, hours, boost, {
    from: slot.lastSettledAt,
  })
  return {
    pokemonId: slot.pokemonId,
    level,
    xp,
    lastSettledAt: slot.lastSettledAt + hours * hourMs,
    xpGained,
  }
}

export function nextEnergyAt(energy: number, energyUpdatedAt: number): number | null {
  if (energy >= trainerConfig.energyMax) return null
  return energyUpdatedAt + progressConfig.energyRegenMs
}
