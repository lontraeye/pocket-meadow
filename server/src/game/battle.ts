import { battleConfig } from '../config/battle.js'
import type { Rng } from './rng.js'

export type SpawnWeight = {
  speciesId: number
  weight: number
}

export type WildRoll = {
  speciesId: number
  level: number
  isShiny: boolean
}

// Espécie, nível e shiny gastam um rng() cada, nessa ordem. A batalha é a 4ª
// chamada e a captura a 5ª (PLANNING.md, seção 7).
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

export function catchChance(captureRate: number, berryBonus = 1): number {
  const raw = (captureRate / 255) * battleConfig.catchMult * berryBonus
  return clamp(raw, battleConfig.catchMin, 1)
}

export function battleXp(wildLevel: number): number {
  return wildLevel * battleConfig.xpPerWildLevel
}

export function fighterXp(wildLevel: number, teamSize: number): number {
  if (teamSize < 1) throw new Error('team size must be >= 1')
  return Math.floor(battleXp(wildLevel) / teamSize)
}

// Raro = peso estritamente abaixo do maior da região. O multiplicador vem do
// efeito rare_boost (Razz, inicial ×2).
export function applyRareWeights<T extends SpawnWeight>(spawns: readonly T[], multiplier: number): T[] {
  const top = Math.max(...spawns.map((spawn) => spawn.weight))
  return spawns.map((spawn) => (spawn.weight < top ? { ...spawn, weight: spawn.weight * multiplier } : { ...spawn }))
}

export function rollWild(
  rng: Rng,
  input: {
    spawns: readonly SpawnWeight[]
    levelMin: number
    levelMax: number
    shinyRate: number
    rareMultiplier?: number
  },
): WildRoll {
  const rare = input.rareMultiplier
  const spawns = rare !== undefined && rare !== 1 ? applyRareWeights(input.spawns, rare) : input.spawns
  const speciesId = rollWeighted(spawns, rng).speciesId
  const level = rollLevel(input.levelMin, input.levelMax, rng)
  const isShiny = rng() < input.shinyRate
  return { speciesId, level, isShiny }
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
