import { progressConfig, xpToNext } from '../config/progress.js'
import { trainerConfig } from '../config/trainer.js'

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
    expiresAt: number | null
  }[]
  encounters: { id: number; status: string; expiresAt: number }[]
}

export type CatchUpResult = {
  trainer: { energy: number; energyUpdatedAt: number }
  energyNextAt: number | null
  daycare: { pokemonId: number; level: number; xp: number; lastSettledAt: number }[]
  deleteEffectIds: number[]
  fleeEncounterIds: number[]
}

const hourMs = 60 * 60 * 1000

export function applyCatchUp(state: CatchUpState, now: number): CatchUpResult {
  const trainer = catchUpEnergy(state.trainer, now)
  const deleteEffectIds = state.effects
    .filter((effect) => effect.expiresAt !== null && effect.expiresAt <= now)
    .map((effect) => effect.id)
  const daycareBoost = state.effects.find(
    (effect) => effect.effectKey === 'daycare_boost' && !deleteEffectIds.includes(effect.id),
  )
  const daycareRate = progressConfig.daycareXpPerHour * (daycareBoost?.multiplier ?? 1)
  const daycare = state.daycare.flatMap((slot) => {
    const settled = settleDaycare(slot, now, daycareRate)
    return settled === undefined ? [] : [settled]
  })
  const fleeEncounterIds = state.encounters
    .filter((encounter) => encounter.status === 'pending' && encounter.expiresAt <= now)
    .map((encounter) => encounter.id)

  return {
    trainer,
    energyNextAt:
      trainer.energy >= trainerConfig.energyMax ? null : trainer.energyUpdatedAt + progressConfig.energyRegenMs,
    daycare,
    deleteEffectIds,
    fleeEncounterIds,
  }
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

function settleDaycare(
  slot: CatchUpState['daycare'][number],
  now: number,
  xpPerHour: number,
): CatchUpResult['daycare'][number] | undefined {
  const end = Math.min(now, slot.enteredAt + progressConfig.daycareMaxMs)
  const hours = Math.floor((end - slot.lastSettledAt) / hourMs)
  if (hours <= 0) return undefined
  const progressed = applyXp(slot.level, slot.xp, hours * xpPerHour)
  return {
    pokemonId: slot.pokemonId,
    level: progressed.level,
    xp: progressed.xp,
    lastSettledAt: slot.lastSettledAt + hours * hourMs,
  }
}

function applyXp(level: number, xp: number, gain: number): { level: number; xp: number } {
  let nextLevel = level
  let nextXp = xp + gain
  while (nextLevel < progressConfig.levelCap) {
    const need = xpToNext(nextLevel)
    if (nextXp < need) break
    nextXp -= need
    nextLevel += 1
  }
  if (nextLevel >= progressConfig.levelCap) return { level: progressConfig.levelCap, xp: 0 }
  return { level: nextLevel, xp: nextXp }
}
