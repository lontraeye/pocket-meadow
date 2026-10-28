// Berries e efeitos (PLANNING.md, seção 5.10).
export const SEED_EXTRA_CHANCE = 0.25
export const SEED_DROP_CHANCE = 0.1
// Arrancar antes de ficar pronta (clique errado): chance de a semente voltar.
export const UPROOT_SEED_RETURN_CHANCE = 0.5
export const PLOT_SLOT_LEVELS = [1, 1, 8, 20] as const

export const SEED_DROP_WEIGHTS = [
  { berryKey: 'oran', weight: 46 },
  { berryKey: 'pinap', weight: 25 },
  { berryKey: 'razz', weight: 15 },
  { berryKey: 'nanab', weight: 7 },
  { berryKey: 'lum', weight: 3 },
  { berryKey: 'golden-razz', weight: 2 },
  { berryKey: 'silver-pinap', weight: 2 },
] as const

export type BerryEffect =
  | { kind: 'energy'; amount: number }
  | { kind: 'charges'; effectKey: string; multiplier: number; charges: number }
  | { kind: 'timed'; effectKey: string; multiplier: number; durationMs: number }

/** Efeito só na captura (Fase 9.2+). Sem isto a berry não aparece em "Dar berry". */
export type CaptureEffect = {
  /** Multiplicador na chance (ex.: 1.5). */
  catchMult?: number
  /** Reduz agitação antes do lançamento; `'all'` zera. */
  calm?: number | 'all'
  /** Doces da linha se capturar. */
  candyOnCatch?: number
  description: string
}

export type BerryDef = {
  key: string
  name: string
  growMs: number
  yield: readonly [number, number]
  /** Ausente = só captura (ou sem uso pela Mochila). */
  effect?: BerryEffect
  effectDescription: string
  capture?: CaptureEffect
}

export const berries = {
  oran: {
    key: 'oran',
    name: 'Oran',
    growMs: 30 * 60 * 1000,
    yield: [2, 3],
    effect: { kind: 'energy', amount: 2 },
    effectDescription: '+2 de energia',
    capture: { calm: 1, description: 'Acalma um pouco (−1 agitação)' },
  },
  pinap: {
    key: 'pinap',
    name: 'Pinap',
    growMs: 2 * 60 * 60 * 1000,
    yield: [1, 2],
    effectDescription: 'Só na captura: +3 doces da linha se capturar',
    capture: { candyOnCatch: 3, description: 'Se capturar, +3 doces da linha' },
  },
  razz: {
    key: 'razz',
    name: 'Razz',
    growMs: 4 * 60 * 60 * 1000,
    yield: [1, 2],
    effect: { kind: 'charges', effectKey: 'rare_boost', multiplier: 2, charges: 1 },
    effectDescription: 'Próximo encontro com raros dobrados',
    capture: { catchMult: 1.5, description: 'Chance de captura ×1,5' },
  },
  nanab: {
    key: 'nanab',
    name: 'Nanab',
    growMs: 6 * 60 * 60 * 1000,
    yield: [1, 2],
    effect: { kind: 'timed', effectKey: 'daycare_boost', multiplier: 2, durationMs: 2 * 60 * 60 * 1000 },
    effectDescription: 'Daycare ×2 de XP por 2 h',
    capture: { calm: 2, description: 'Acalma (−2 agitação)' },
  },
  lum: {
    key: 'lum',
    name: 'Lum',
    growMs: 12 * 60 * 60 * 1000,
    yield: [1, 1],
    effect: { kind: 'charges', effectKey: 'shiny_boost', multiplier: 4, charges: 1 },
    effectDescription: 'Próximo encontro com shiny ×4',
    capture: { calm: 'all', description: 'Acalma totalmente' },
  },
  'golden-razz': {
    key: 'golden-razz',
    name: 'Golden Razz',
    growMs: 24 * 60 * 60 * 1000,
    yield: [1, 1],
    effectDescription: 'Só na captura: chance ×2,5 e acalma (−1)',
    capture: {
      catchMult: 2.5,
      calm: 1,
      description: 'Chance ×2,5 e acalma (−1)',
    },
  },
  'silver-pinap': {
    key: 'silver-pinap',
    name: 'Silver Pinap',
    growMs: 18 * 60 * 60 * 1000,
    yield: [1, 1],
    effectDescription: 'Só na captura: chance ×1,8 e +5 doces se capturar',
    capture: {
      catchMult: 1.8,
      candyOnCatch: 5,
      description: 'Chance ×1,8; se capturar, +5 doces da linha',
    },
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
  if (level === 15) rewards.push({ itemKey: 'seed:silver-pinap', quantity: 1 })
  if (level === 20) rewards.push({ itemKey: 'seed:golden-razz', quantity: 1 })
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
