// Receitas de construção (PROGRESSAO.md 4.3, passo 2c): o marco dá a primeira
// unidade e a receita; as próximas se constroem com materiais, levam tempo e
// param no teto do tipo (config/gardenUnlocks). Uma construção por vez.
// Números de partida; o balanço fica para o item 7.

import type { StructurePiece } from '../game/garden/layout.js'
import { APRICORN_ITEM } from './apricorn.js'

/** Materiais novos: madeira do Headbutt e pedra do Rock Smash. */
export const WOOD_ITEM = 'mat:wood'
export const STONE_ITEM = 'mat:stone'

const hourMs = 60 * 60 * 1000

export type BuildRecipe = {
  piece: StructurePiece
  cost: readonly { itemKey: string; quantity: number }[]
  /** Quanto leva para ficar pronta (vai para o inventário de construção). */
  ms: number
}

export const BUILD_RECIPES: readonly BuildRecipe[] = [
  {
    piece: 'apricorn_tree',
    cost: [
      { itemKey: WOOD_ITEM, quantity: 10 },
      { itemKey: APRICORN_ITEM, quantity: 5 },
      { itemKey: 'berry:oran', quantity: 3 },
    ],
    ms: 1 * hourMs,
  },
  {
    piece: 'heal_machine',
    cost: [
      { itemKey: STONE_ITEM, quantity: 10 },
      { itemKey: WOOD_ITEM, quantity: 5 },
      { itemKey: 'berry:oran', quantity: 5 },
    ],
    ms: 2 * hourMs,
  },
  {
    piece: 'ball_bench',
    cost: [
      { itemKey: WOOD_ITEM, quantity: 15 },
      { itemKey: STONE_ITEM, quantity: 10 },
      { itemKey: APRICORN_ITEM, quantity: 10 },
    ],
    ms: 4 * hourMs,
  },
]

export function buildRecipe(piece: StructurePiece): BuildRecipe | null {
  return BUILD_RECIPES.find((recipe) => recipe.piece === piece) ?? null
}
