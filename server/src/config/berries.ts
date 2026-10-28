// Berries e efeitos (PLANNING.md, seção 5.10).
export const SEED_EXTRA_CHANCE = 0.25
export const SEED_DROP_CHANCE = 0.1
// Arrancar antes de ficar pronta (clique errado): chance de a semente voltar.
export const UPROOT_SEED_RETURN_CHANCE = 0.5
export const PLOT_SLOT_LEVELS = [1, 1, 8, 20] as const

export const SEED_DROP_WEIGHTS = [
  { berryKey: 'oran', weight: 50 },
  { berryKey: 'pinap', weight: 25 },
  { berryKey: 'razz', weight: 15 },
  { berryKey: 'nanab', weight: 7 },
  { berryKey: 'lum', weight: 3 },
] as const

export type BerryEffect =
  | { kind: 'energy'; amount: number }
  | { kind: 'charges'; effectKey: string; multiplier: number; charges: number }
  | { kind: 'timed'; effectKey: string; multiplier: number; durationMs: number }

export type BerryDef = {
  key: string
  name: string
  growMs: number
  yield: readonly [number, number]
  effect: BerryEffect
  effectDescription: string
}

export const berries = {
  oran: {
    key: 'oran',
    name: 'Oran',
    growMs: 30 * 60 * 1000,
    yield: [2, 3],
    effect: { kind: 'energy', amount: 2 },
    effectDescription: '+2 de energia',
  },
  pinap: {
    key: 'pinap',
    name: 'Pinap',
    growMs: 2 * 60 * 60 * 1000,
    yield: [1, 2],
    effect: { kind: 'charges', effectKey: 'catch_boost', multiplier: 1.5, charges: 1 },
    effectDescription: 'Próxima captura com chance ×1,5',
  },
  razz: {
    key: 'razz',
    name: 'Razz',
    growMs: 4 * 60 * 60 * 1000,
    yield: [1, 2],
    effect: { kind: 'charges', effectKey: 'rare_boost', multiplier: 2, charges: 1 },
    effectDescription: 'Próximo encontro com raros dobrados',
  },
  nanab: {
    key: 'nanab',
    name: 'Nanab',
    growMs: 6 * 60 * 60 * 1000,
    yield: [1, 2],
    effect: { kind: 'timed', effectKey: 'daycare_boost', multiplier: 2, durationMs: 2 * 60 * 60 * 1000 },
    effectDescription: 'Daycare ×2 de XP por 2 h',
  },
  lum: {
    key: 'lum',
    name: 'Lum',
    growMs: 12 * 60 * 60 * 1000,
    yield: [1, 1],
    effect: { kind: 'charges', effectKey: 'shiny_boost', multiplier: 4, charges: 1 },
    effectDescription: 'Próximo encontro com shiny ×4',
  },
} as const satisfies Record<string, BerryDef>

export type BerryKey = keyof typeof berries

export const berryList: BerryDef[] = Object.values(berries)

export type LevelRewardSpec =
  | { itemKey: string; quantity: number }
  | { kind: 'random_seed' }

/** Recompensas ao atingir exatamente este nível de treinador. */
export function trainerLevelRewards(level: number): LevelRewardSpec[] {
  const rewards: LevelRewardSpec[] = [
    { itemKey: 'seed:oran', quantity: 1 },
    { itemKey: 'ball:poke', quantity: 5 },
  ]
  if (level === 3) rewards.push({ itemKey: 'seed:razz', quantity: 1 })
  if (level === 5) rewards.push({ itemKey: 'seed:nanab', quantity: 1 })
  if (level === 8) rewards.push({ itemKey: 'seed:lum', quantity: 1 })
  if (level % 5 === 0) rewards.push({ itemKey: 'ball:great', quantity: 3 })
  if (level % 10 === 0) rewards.push({ itemKey: 'ball:ultra', quantity: 2 })
  if (level >= 10 && level % 5 === 0) rewards.push({ kind: 'random_seed' })
  return rewards
}

export const berryConfig = {
  seedExtraChance: SEED_EXTRA_CHANCE,
  seedDropChance: SEED_DROP_CHANCE,
  uprootSeedReturnChance: UPROOT_SEED_RETURN_CHANCE,
  seedDropWeights: SEED_DROP_WEIGHTS,
  plotSlotLevels: PLOT_SLOT_LEVELS,
} as const

export function plotSlotsUnlocked(trainerLevel: number): number {
  let unlocked = 0
  for (const level of PLOT_SLOT_LEVELS) {
    if (trainerLevel >= level) unlocked += 1
  }
  return unlocked
}

export function nextPlotSlotLevel(trainerLevel: number): number | null {
  const unlocked = plotSlotsUnlocked(trainerLevel)
  if (unlocked >= PLOT_SLOT_LEVELS.length) return null
  return PLOT_SLOT_LEVELS[unlocked] ?? null
}

export function getBerry(key: string): BerryDef | null {
  return key in berries ? berries[key as BerryKey] : null
}

export function seedKey(berryKey: string): string {
  return `seed:${berryKey}`
}

export function berryItemKey(berryKey: string): string {
  return `berry:${berryKey}`
}

export function berryKeyFromItem(itemKey: string): string | null {
  if (!itemKey.startsWith('berry:')) return null
  return itemKey.slice('berry:'.length)
}
