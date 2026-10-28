import {
  SEED_DROP_CHANCE,
  SEED_DROP_WEIGHTS,
  SEED_EXTRA_CHANCE,
  UPROOT_SEED_RETURN_CHANCE,
  berryItemKey,
  getBerry,
  seedKey,
  trainerLevelRewards,
  type BerryDef,
  type LevelRewardSpec,
} from '../config/berries.js'
import { trainerConfig } from '../config/trainer.js'
import { rollWeighted, type SpawnWeight } from './battle.js'
import type { Rng } from './rng.js'

export type HarvestPlan = {
  berryKey: string
  berryAmount: number
  seedAmount: number
  credits: { itemKey: string; quantity: number }[]
}

/** Colheita: yield no intervalo e 1 semente + chance de outra. Os sorteios vêm de fora. */
export function planHarvest(
  berry: BerryDef,
  rolls: { yieldUnit: number; extraSeed: number },
): HarvestPlan {
  const [min, max] = berry.yield
  if (!(rolls.yieldUnit >= 0 && rolls.yieldUnit < 1)) throw new Error('yieldUnit must be in [0, 1)')
  if (!(rolls.extraSeed >= 0 && rolls.extraSeed < 1)) throw new Error('extraSeed must be in [0, 1)')
  const berryAmount = min + Math.floor(rolls.yieldUnit * (max - min + 1))
  const seedAmount = 1 + (rolls.extraSeed < SEED_EXTRA_CHANCE ? 1 : 0)
  return {
    berryKey: berry.key,
    berryAmount,
    seedAmount,
    credits: [
      { itemKey: berryItemKey(berry.key), quantity: berryAmount },
      { itemKey: seedKey(berry.key), quantity: seedAmount },
    ],
  }
}

/** Arrancar antes de ficar pronta: a semente volta com UPROOT_SEED_RETURN_CHANCE. */
export function planUproot(berryKey: string, roll: number): { seedReturned: boolean; credits: ItemCredit[] } {
  if (!(roll >= 0 && roll < 1)) throw new Error('roll must be in [0, 1)')
  const seedReturned = roll < UPROOT_SEED_RETURN_CHANCE
  return { seedReturned, credits: seedReturned ? [{ itemKey: seedKey(berryKey), quantity: 1 }] : [] }
}

export type EnergyApply =
  | { ok: false; error: 'energy_full' }
  | { ok: true; energy: number; energyUpdatedAt: number; gained: number }

export function applyEnergyBerry(
  energy: number,
  energyUpdatedAt: number,
  amount: number,
  now: number,
  energyMax = trainerConfig.energyMax,
): EnergyApply {
  if (energy >= energyMax) return { ok: false, error: 'energy_full' }
  const next = Math.min(energyMax, energy + amount)
  return {
    ok: true,
    energy: next,
    energyUpdatedAt: next >= energyMax ? now : energyUpdatedAt,
    gained: next - energy,
  }
}

export type EffectApply =
  | { kind: 'energy'; energy: number; energyUpdatedAt: number; gained: number }
  | {
      kind: 'replace_effect'
      effectKey: string
      multiplier: number
      charges: number | null
      expiresAt: number | null
      renewed: boolean
    }

export function planBerryUse(
  berry: BerryDef,
  state: { energy: number; energyUpdatedAt: number; hasSameEffect: boolean },
  now: number,
): { ok: false; error: 'energy_full' | 'berry_not_usable' } | { ok: true; apply: EffectApply } {
  const effect = berry.effect
  if (!effect) return { ok: false, error: 'berry_not_usable' }
  if (effect.kind === 'energy') {
    const result = applyEnergyBerry(state.energy, state.energyUpdatedAt, effect.amount, now)
    if (!result.ok) return result
    return {
      ok: true,
      apply: {
        kind: 'energy',
        energy: result.energy,
        energyUpdatedAt: result.energyUpdatedAt,
        gained: result.gained,
      },
    }
  }
  if (effect.kind === 'charges') {
    return {
      ok: true,
      apply: {
        kind: 'replace_effect',
        effectKey: effect.effectKey,
        multiplier: effect.multiplier,
        charges: effect.charges,
        expiresAt: null,
        renewed: state.hasSameEffect,
      },
    }
  }
  return {
    ok: true,
    apply: {
      kind: 'replace_effect',
      effectKey: effect.effectKey,
      multiplier: effect.multiplier,
      charges: null,
      expiresAt: now + effect.durationMs,
      renewed: state.hasSameEffect,
    },
  }
}

export type ItemCredit = { itemKey: string; quantity: number }

/** Soma as recompensas de cada nível em (fromLevel, toLevel]. */
export function rewardsForLevelsGained(
  fromLevel: number,
  toLevel: number,
  pickRandomSeed: () => string,
): ItemCredit[] {
  if (toLevel <= fromLevel) return []
  const totals = new Map<string, number>()
  for (let level = fromLevel + 1; level <= toLevel; level += 1) {
    for (const reward of resolveReward(trainerLevelRewards(level), pickRandomSeed)) {
      totals.set(reward.itemKey, (totals.get(reward.itemKey) ?? 0) + reward.quantity)
    }
  }
  return [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([itemKey, quantity]) => ({ itemKey, quantity }))
}

function resolveReward(specs: LevelRewardSpec[], pickRandomSeed: () => string): ItemCredit[] {
  const out: ItemCredit[] = []
  for (const spec of specs) {
    if ('kind' in spec) out.push({ itemKey: seedKey(pickRandomSeed()), quantity: 1 })
    else out.push(spec)
  }
  return out
}

export type SeedDrop = { itemKey: string; berryKey: string } | null

/** Chance de semente após a captura (mesmo PRNG do encontro). */
export function rollBattleSeed(rng: Rng): SeedDrop {
  if (rng() >= SEED_DROP_CHANCE) return null
  const weights: SpawnWeight[] = SEED_DROP_WEIGHTS.map((row, index) => ({
    speciesId: index + 1,
    weight: row.weight,
  }))
  const pick = rollWeighted(weights, rng)
  const berryKey = SEED_DROP_WEIGHTS[pick.speciesId - 1]?.berryKey
  if (!berryKey || !getBerry(berryKey)) throw new Error('seed drop table is broken')
  return { itemKey: seedKey(berryKey), berryKey }
}

export function pickSeedByWeight(rng: Rng): string {
  const weights: SpawnWeight[] = SEED_DROP_WEIGHTS.map((row, index) => ({
    speciesId: index + 1,
    weight: row.weight,
  }))
  const pick = rollWeighted(weights, rng)
  const berryKey = SEED_DROP_WEIGHTS[pick.speciesId - 1]?.berryKey
  if (!berryKey) throw new Error('seed drop table is broken')
  return berryKey
}
