import { RARE_WEIGHT_MAX, battleConfig } from '../config/battle.js'
import type { Rng } from './rng.js'

export type SpawnWeight = {
  speciesId: number
  weight: number
}

export type SpawnSlot = SpawnWeight & {
  minLevel: number
  maxLevel: number
}

export type WildRoll = {
  speciesId: number
  level: number
  isShiny: boolean
}

// Slot, nível e shiny: 3 rng(). Depois: batalha, captura; numa vitória,
// chance de semente e, se caiu, qual semente (PLANNING.md, seção 7).
export const wildRollCount = 3

export function power(baseStatTotal: number, level: number): number {
  return baseStatTotal * (1 + level / 10)
}

export function teamPower(powers: readonly number[]): number {
  const ranked = [...powers].sort((a, b) => b - a)
  return ranked.reduce((sum, value, index) => sum + value * (battleConfig.teamWeights[index] ?? 0), 0)
}

export function winChance(team: number, wild: number): number {
  if (!(wild > 0)) return battleConfig.maxChance
  if (!(team > 0)) return battleConfig.minChance
  const ratio = team / wild
  const chance = 1 / (1 + Math.exp(-battleConfig.k * Math.log(ratio)))
  return clamp(chance, battleConfig.minChance, battleConfig.maxChance)
}

/** Chance de captura (PLANNING 5.6). Master Ball: passe guaranteed=true → 1. */
export function catchChance(
  captureRate: number,
  berryBonus = 1,
  ballMult = 1,
  guaranteed = false,
  /** Qualidade × curva do arremesso (9.4); 1 se omitido. */
  throwMult = 1,
): number {
  if (guaranteed) return 1
  const raw = (captureRate / 255) * battleConfig.catchMult * ballMult * berryBonus * throwMult
  return clamp(raw, battleConfig.catchMin, 1)
}

// Fórmula da Geração 5 (PLANNING.md, seção 5.5). O +1 fica fora do floor.
export function battleXp(baseExperience: number, wildLevel: number, fighterLevel: number): number {
  if (!(baseExperience > 0)) throw new Error('base experience must be positive')
  const ratio = (2 * wildLevel + 10) / (wildLevel + fighterLevel + 10)
  const raw = (baseExperience * wildLevel / battleConfig.xpDiv) * ratio ** battleConfig.xpLevelExp
  return Math.floor(raw) + 1
}

/** Divide o XP pelo número de quem recebe (entrou e não desmaiou). Exp Share (futuro) muda o conjunto. */
export function fighterXp(
  baseExperience: number,
  wildLevel: number,
  fighterLevel: number,
  sharerCount: number,
): number {
  if (sharerCount < 1) throw new Error('sharer count must be >= 1')
  return Math.floor(battleXp(baseExperience, wildLevel, fighterLevel) / sharerCount)
}

/**
 * Quem recebe XP/EVs na vitória: entrou em campo e terminou de pé.
 * Quem ficou na pokébola ou desmaiou não entra. Exp Share (item futuro) amplia isso.
 */
export function battleXpSharers(enteredSlots: readonly number[], faintedSlots: readonly number[]): number[] {
  const fainted = new Set(faintedSlots)
  return [...enteredSlots].filter((slot) => !fainted.has(slot)).sort((a, b) => a - b)
}

// Raro = espécie cuja soma dos slots fica até RARE_WEIGHT_MAX. A soma é por
// espécie porque os slots são por faixa de nível: o Pidgey Nv 7 da Rota 1 tem
// peso 1, mas o Pidgey soma 70. O multiplicador vem do efeito rare_boost
// (Razz, inicial ×2).
export function applyRareWeights<T extends SpawnWeight>(spawns: readonly T[], multiplier: number): T[] {
  const totals = new Map<number, number>()
  for (const spawn of spawns) totals.set(spawn.speciesId, (totals.get(spawn.speciesId) ?? 0) + spawn.weight)
  return spawns.map((spawn) =>
    (totals.get(spawn.speciesId) ?? 0) <= RARE_WEIGHT_MAX ? { ...spawn, weight: spawn.weight * multiplier } : { ...spawn },
  )
}

export function rollWild(
  rng: Rng,
  input: {
    slots: readonly SpawnSlot[]
    shinyRate: number
    rareMultiplier?: number
  },
): WildRoll {
  const rare = input.rareMultiplier
  const slots = rare !== undefined && rare !== 1 ? applyRareWeights(input.slots, rare) : input.slots
  const slot = rollWeighted(slots, rng)
  const level = rollLevel(slot.minLevel, slot.maxLevel, rng)
  const isShiny = rng() < input.shinyRate
  return { speciesId: slot.speciesId, level, isShiny }
}

export function skipWildRolls(rng: Rng): void {
  for (let i = 0; i < wildRollCount; i += 1) rng()
}

export function rollChance(chance: number, rng: Rng): boolean {
  return rng() < chance
}

export function rollWeighted<T extends SpawnWeight>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new Error('empty weight table')
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  if (!(total > 0)) throw new Error('weight table total must be positive')
  let cursor = rng() * total
  for (const item of items) {
    cursor -= item.weight
    if (cursor < 0) return item
  }
  const last = items[items.length - 1]
  if (!last) throw new Error('empty weight table')
  return last
}

function rollLevel(min: number, max: number, rng: Rng): number {
  if (max < min) throw new Error('level range is inverted')
  return min + Math.floor(rng() * (max - min + 1))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
