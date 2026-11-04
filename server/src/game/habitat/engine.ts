// Motor de reconhecimento dos habitats (PLANNING.md, seção 5.22). Puro: recebe
// as casas construídas do jardim e devolve as zonas, o bioma de cada uma e
// quantos Pokémon cabem. O servidor roda ao salvar uma construção; a tela, ao
// vivo enquanto o jogador constrói.

import type { PokemonType } from '../../config/types.js'
import { BASIC_BIOME, type BiomeKey, FLOORS, habitatConfig, MATERIALS, type Material, OBJECTS, type RecipeRule } from './config.js'

/** Uma casa construída. Casa que não aparece é gramado. */
export type GardenCell = { col: number; row: number; floor: string | null; object: string | null }

/** Quanto falta numa regra da receita, em pontos (um chão vale 1, um objeto `objectWeight`). */
export type RuleGap = { materials: readonly Material[]; have: number; need: number }

export type Zone = {
  /** Casas da zona, em ordem de linha e coluna. A primeira é a âncora. */
  tiles: { col: number; row: number }[]
  /** Pontos totais (chão + objetos com peso). */
  weight: number
  /** Fração de cada material na zona (0 a 1). */
  fractions: Record<Material, number>
  /**
   * Bioma reconhecido. `basico` quando a zona tem tamanho mas não bate receita
   * (aceita qualquer tipo, sem bônus); null quando é pequena demais.
   */
  biome: BiomeKey | null
  /** Vagas: 0 quando não é habitat. */
  capacity: number
  /** Pequena demais para ser habitat (mesmo que a mistura bata). */
  tooSmall: boolean
  /** Sem receita (básico ou pequena): a receita mais perto e o que falta em cada regra que não bate. */
  nearest: { biome: BiomeKey; gaps: RuleGap[] } | null
}

const key = (col: number, row: number) => `${col},${row}`

function makeup(cell: GardenCell): { counts: boolean; weights: Partial<Record<Material, number>> } {
  const weights: Partial<Record<Material, number>> = {}
  let counts = false
  if (cell.object && habitatConfig.separatorObjects.includes(cell.object)) return { counts: false, weights }
  const floor = cell.floor ? (FLOORS as Record<string, Partial<Record<Material, number>>>)[cell.floor] : undefined
  if (floor && cell.floor && !habitatConfig.neutralFloors.includes(cell.floor)) {
    counts = true
    for (const [material, value] of Object.entries(floor) as [Material, number][]) {
      weights[material] = (weights[material] ?? 0) + value
    }
  }
  const object = cell.object ? (OBJECTS as Record<string, Partial<Record<Material, number>>>)[cell.object] : undefined
  if (object) {
    counts = true
    for (const [material, value] of Object.entries(object) as [Material, number][]) {
      weights[material] = (weights[material] ?? 0) + value * habitatConfig.objectWeight
    }
  }
  return { counts, weights }
}

function ruleShare(fractions: Record<Material, number>, rule: RecipeRule): number {
  return rule.materials.reduce((sum, material) => sum + fractions[material], 0)
}

/** Um pouco de folga para frações como 0.6 que não fecham em ponto flutuante. */
const EPS = 1e-9

/** A primeira receita que bate (sem o básico, que é a falta de receita). */
export function matchBiome(fractions: Record<Material, number>): BiomeKey | null {
  for (const recipe of habitatConfig.biomes) {
    if (recipe.rules.every((rule) => ruleShare(fractions, rule) + EPS >= rule.min)) return recipe.key
  }
  return null
}

function nearestBiome(fractions: Record<Material, number>, weight: number): Zone['nearest'] {
  let best: Zone['nearest'] = null
  let bestShort = Infinity
  for (const recipe of habitatConfig.biomes) {
    let short = 0
    const gaps: RuleGap[] = []
    for (const rule of recipe.rules) {
      const share = ruleShare(fractions, rule)
      if (share + EPS >= rule.min) continue
      short += rule.min - share
      gaps.push({ materials: rule.materials, have: Math.round(share * weight * 10) / 10, need: Math.ceil(rule.min * weight - EPS) })
    }
    if (short < bestShort) {
      bestShort = short
      best = { biome: recipe.key, gaps }
    }
  }
  return best
}

function capacityFor(size: number): number {
  if (size < habitatConfig.minTiles) return 0
  return size >= habitatConfig.bigTiles ? habitatConfig.capacity.big : habitatConfig.capacity.small
}

/**
 * As zonas do jardim: casas vizinhas (4 direções) com chão ou objeto que conta
 * formam uma zona. Gramado, caminho e cerca separam. Em ordem pela âncora
 * (linha, depois coluna), para o resultado não depender da ordem da entrada.
 */
export function recognizeHabitats(cells: readonly GardenCell[]): Zone[] {
  const byKey = new Map<string, { cell: GardenCell; weights: Partial<Record<Material, number>> }>()
  for (const cell of cells) {
    const { counts, weights } = makeup(cell)
    if (counts) byKey.set(key(cell.col, cell.row), { cell, weights })
  }
  const seen = new Set<string>()
  const zones: Zone[] = []
  const ordered = [...byKey.values()].sort((a, b) => a.cell.row - b.cell.row || a.cell.col - b.cell.col)
  for (const start of ordered) {
    const startKey = key(start.cell.col, start.cell.row)
    if (seen.has(startKey)) continue
    seen.add(startKey)
    const stack = [start]
    const members: typeof ordered = []
    while (stack.length) {
      const current = stack.pop()!
      members.push(current)
      const { col, row } = current.cell
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = key(col + dc, row + dr)
        const found = byKey.get(next)
        if (found && !seen.has(next)) {
          seen.add(next)
          stack.push(found)
        }
      }
    }
    members.sort((a, b) => a.cell.row - b.cell.row || a.cell.col - b.cell.col)
    const totals = Object.fromEntries(MATERIALS.map((m) => [m, 0])) as Record<Material, number>
    for (const member of members) {
      for (const [material, value] of Object.entries(member.weights) as [Material, number][]) totals[material] += value
    }
    const weight = MATERIALS.reduce((sum, m) => sum + totals[m], 0)
    const fractions = Object.fromEntries(MATERIALS.map((m) => [m, weight > 0 ? totals[m] / weight : 0])) as Record<Material, number>
    const size = members.length
    const tooSmall = size < habitatConfig.minTiles
    const matched = matchBiome(fractions)
    const biome = tooSmall ? null : (matched ?? BASIC_BIOME.key)
    zones.push({
      tiles: members.map((m) => ({ col: m.cell.col, row: m.cell.row })),
      weight,
      fractions,
      biome,
      capacity: biome ? capacityFor(size) : 0,
      tooSmall,
      nearest: matched ? null : nearestBiome(fractions, weight),
    })
  }
  return zones
}

/** Um Pokémon pode morar no bioma se um dos tipos dele está na lista; no básico, qualquer um. */
export function canLiveIn(types: readonly string[], biome: BiomeKey): boolean {
  if (biome === BASIC_BIOME.key) return true
  const recipe = habitatConfig.biomes.find((b) => b.key === biome)
  return !!recipe && types.some((type) => (recipe.types as readonly PokemonType[]).includes(type as PokemonType))
}

/** A zona que contém a casa (col, row), ou null. */
export function zoneAt(zones: readonly Zone[], col: number, row: number): Zone | null {
  return zones.find((zone) => zone.tiles.some((tile) => tile.col === col && tile.row === row)) ?? null
}

/** Morar ali dá o bônus do bioma: bioma de verdade (não o básico) de um dos tipos. */
export function biomeBonus(types: readonly string[], biome: BiomeKey | null): boolean {
  return biome !== null && biome !== BASIC_BIOME.key && canLiveIn(types, biome)
}

export function biomeName(biome: BiomeKey): string {
  if (biome === BASIC_BIOME.key) return BASIC_BIOME.name
  return habitatConfig.biomes.find((b) => b.key === biome)?.name ?? biome
}
