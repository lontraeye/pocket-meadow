// Expansão do jardim (decidida em 2026-11-05): o jogador abre uma faixa de
// casas no lado que escolher. Cada expansão é uma obra (materiais e tempo, na
// mesma fila das construções) e abre por marco: uma por marco, da Azalea à
// Liga. Números de partida; ajustar com o item 7 (npm run economia).

import { STONE_ITEM, WOOD_ITEM } from './buildRecipes.js'

const hourMs = 60 * 60 * 1000

export const gardenExpansionConfig = {
  /** Casas que cada expansão abre no lado escolhido. */
  strip: 2,
  /** Teto em cada direção (largura e altura): do 12 de hoje até 20, quatro faixas por eixo. */
  maxSize: 20,
  /** Marcos que liberam uma expansão cada, na ordem da jornada. */
  milestones: ['azalea', 'goldenrod', 'ecruteak', 'cianwood', 'olivine', 'mahogany', 'blackthorn', 'league'],
} as const

export type ExpansionCost = {
  items: { itemKey: string; quantity: number }[]
  genericCandies: number
  ms: number
}

/** Custo da n-ésima expansão (1, 2, ...): cresce a cada uma. */
export function expansionCost(n: number): ExpansionCost {
  return {
    items: [
      { itemKey: WOOD_ITEM, quantity: 10 + 10 * n },
      { itemKey: STONE_ITEM, quantity: 10 + 10 * n },
    ],
    genericCandies: 20 * n,
    ms: (2 + 2 * n) * hourMs,
  }
}

/** Quantas expansões os marcos já liberaram. */
export function expansionsUnlocked(cleared: ReadonlySet<string>): number {
  return gardenExpansionConfig.milestones.filter((key) => cleared.has(key)).length
}

/** O marco que libera a próxima expansão (a `done + 1`-ésima), ou null se não há mais. */
export function nextExpansionMilestone(cleared: ReadonlySet<string>, done: number): string | null {
  const unlocked = expansionsUnlocked(cleared)
  if (done < unlocked) return null
  return gardenExpansionConfig.milestones.filter((key) => !cleared.has(key))[0] ?? null
}
