// Berries e efeitos (PLANNING.md, seção 5.10).
import { APRICORN_BLUE, APRICORN_ITEM, APRICORN_YELLOW } from './apricorn.js'
import { trainerConfig } from './trainer.js'
import type { WeatherKey } from './weather.js'
export const SEED_EXTRA_CHANCE = 0.25
/**
 * O arbusto fica no canteiro e frutifica de novo (2026-11-03). O primeiro
 * crescimento (semente → muda → crescida → frutos) leva FIRST_GROWTH_MULT vezes
 * o tempo da berry; as colheitas seguintes, o tempo normal. A colheita não dá
 * semente: depois de algumas, o arbusto seca, e limpar o arbusto seco é que
 * dá (com sorte) uma ou duas.
 */
export const FIRST_GROWTH_MULT = 2
export const bushConfig = {
  /** Colheitas garantidas antes de o arbusto poder secar. */
  safeHarvests: 2,
  /** Chance de secar depois da colheita n (n > safeHarvests): base + passo por colheita, até 100%. */
  deathBase: 0.2,
  deathStep: 0.15,
  /** Sementes ao limpar o arbusto seco: pesos de 0, 1 e 2. */
  clearSeedWeights: [20, 55, 25] as const,
}

/** Chance de o arbusto secar logo depois da colheita número `harvest` (1 = a primeira). */
export function bushDeathChance(harvest: number): number {
  if (harvest <= bushConfig.safeHarvests) return 0
  return Math.min(1, bushConfig.deathBase + bushConfig.deathStep * (harvest - bushConfig.safeHarvests - 1))
}
export const SEED_DROP_CHANCE = 0.1
// Arrancar antes de ficar pronta (clique errado): chance de a semente voltar.
export const UPROOT_SEED_RETURN_CHANCE = 0.5

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
  /** Plantada neste clima, cresce mais rápido (weatherConfig.favoriteGrowFactor). */
  favoriteWeather: WeatherKey
  yield: readonly [number, number]
  /** Ausente = só captura (ou sem uso pela Mochila). */
  effect?: BerryEffect
  effectDescription: string
  capture?: CaptureEffect
}

/** Berry de energia com a energia desligada (trainerConfig.energyEnabled): não se usa na mochila. */
export function energyBerryOff(berry: { effect?: { kind: string } }): boolean {
  return berry.effect?.kind === 'energy' && !trainerConfig.energyEnabled
}

export const berries = {
  oran: {
    key: 'oran',
    name: 'Oran',
    growMs: 30 * 60 * 1000,
    favoriteWeather: 'rain',
    yield: [4, 5],
    effect: { kind: 'energy', amount: 2 },
    effectDescription: '+2 de energia',
    capture: { calm: 1, description: 'Acalma um pouco (−1 agitação)' },
  },
  pinap: {
    key: 'pinap',
    name: 'Pinap',
    growMs: 2 * 60 * 60 * 1000,
    favoriteWeather: 'sunny',
    yield: [3, 4],
    effectDescription: 'Só na captura: +3 doces da linha se capturar',
    capture: { candyOnCatch: 3, description: 'Se capturar, +3 doces da linha' },
  },
  razz: {
    key: 'razz',
    name: 'Razz',
    growMs: 4 * 60 * 60 * 1000,
    favoriteWeather: 'sunny',
    yield: [3, 4],
    effect: { kind: 'charges', effectKey: 'rare_boost', multiplier: 2, charges: 1 },
    effectDescription: 'Próximo encontro com raros dobrados',
    capture: { catchMult: 1.5, description: 'Chance de captura ×1,5' },
  },
  nanab: {
    key: 'nanab',
    name: 'Nanab',
    growMs: 6 * 60 * 60 * 1000,
    favoriteWeather: 'cloudy',
    yield: [3, 4],
    effect: { kind: 'timed', effectKey: 'daycare_boost', multiplier: 2, durationMs: 2 * 60 * 60 * 1000 },
    effectDescription: 'Daycare ×2 de XP por 2 h',
    capture: { calm: 2, description: 'Acalma (−2 agitação)' },
  },
  lum: {
    key: 'lum',
    name: 'Lum',
    growMs: 12 * 60 * 60 * 1000,
    favoriteWeather: 'rain',
    yield: [3, 3],
    effect: { kind: 'charges', effectKey: 'shiny_boost', multiplier: 4, charges: 1 },
    effectDescription: 'Próximo encontro com shiny ×4',
    capture: { calm: 'all', description: 'Acalma totalmente' },
  },
  'golden-razz': {
    key: 'golden-razz',
    name: 'Golden Razz',
    growMs: 24 * 60 * 60 * 1000,
    favoriteWeather: 'wind',
    yield: [3, 3],
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
    favoriteWeather: 'cloudy',
    yield: [3, 3],
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

/**
 * Recompensas ao atingir exatamente este nível de treinador. Apricorn no lugar
 * de bola (PROGRESSAO.md, item 5): a bola sai da bancada.
 */
export function trainerLevelRewards(level: number): LevelRewardSpec[] {
  const rewards: LevelRewardSpec[] = [
    { itemKey: 'seed:oran', quantity: 1 },
    { itemKey: APRICORN_ITEM, quantity: 2 },
  ]
  if (level === 3) rewards.push({ itemKey: 'seed:razz', quantity: 1 })
  if (level === 5) rewards.push({ itemKey: 'seed:nanab', quantity: 1 })
  if (level === 8) rewards.push({ itemKey: 'seed:lum', quantity: 1 })
  if (level === 15) rewards.push({ itemKey: 'seed:silver-pinap', quantity: 1 })
  if (level === 20) rewards.push({ itemKey: 'seed:golden-razz', quantity: 1 })
  if (level % 5 === 0) rewards.push({ itemKey: APRICORN_BLUE, quantity: 2 })
  if (level % 10 === 0) rewards.push({ itemKey: APRICORN_YELLOW, quantity: 2 })
  if (level >= 10 && level % 5 === 0) rewards.push({ kind: 'random_seed' })
  return rewards
}

export const berryConfig = {
  seedExtraChance: SEED_EXTRA_CHANCE,
  seedDropChance: SEED_DROP_CHANCE,
  uprootSeedReturnChance: UPROOT_SEED_RETURN_CHANCE,
  seedDropWeights: SEED_DROP_WEIGHTS,
} as const


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
