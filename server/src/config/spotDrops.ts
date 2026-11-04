import { APRICORN_ITEM } from './apricorn.js'
import { ballItemKey } from './balls.js'
import { berryItemKey, SEED_DROP_WEIGHTS } from './berries.js'
import { STONE_ITEM, WOOD_ITEM } from './buildRecipes.js'
import type { FieldMethod } from './regions.js'

/**
 * Árvore e pedra do campo (JORNADA.md, seção 4): cada uso sorteia ou um item,
 * ou um Pokémon. O item gasta a energia do mesmo jeito, mas não abre encontro.
 * A árvore derruba berries (os mesmos pesos das sementes da luta) e Apricorns
 * (5.23, complementa a árvore do jardim); a pedra solta bolas. Pedras de evolução (PLANNING 5.16) entram aqui quando existirem.
 * Madeira (árvore) e pedra (pedra) são os materiais de construção (PROGRESSAO.md 4.3,
 * passo 2c) e caem de 2 a 4 por vez (`min`/`max`; sem eles, 1).
 */
export const spotDropsConfig = {
  chance: 0.3,
  tables: {
    headbutt: [
      ...SEED_DROP_WEIGHTS.map((row) => ({ itemKey: berryItemKey(row.berryKey), weight: row.weight })),
      // As berries somam 100: com o Apricorn (50) e a madeira (75), cada um sai em ~1/5 e ~1/3 dos itens.
      { itemKey: APRICORN_ITEM, weight: 50 },
      { itemKey: WOOD_ITEM, weight: 75, min: 2, max: 4 },
    ],
    rockSmash: [
      { itemKey: ballItemKey('poke'), weight: 75 },
      { itemKey: ballItemKey('great'), weight: 20 },
      { itemKey: ballItemKey('ultra'), weight: 5 },
      // Metade dos itens da pedra é pedra.
      { itemKey: STONE_ITEM, weight: 100, min: 2, max: 4 },
    ],
  } satisfies Partial<Record<FieldMethod, { itemKey: string; weight: number; min?: number; max?: number }[]>>,
}

export type DropMethod = keyof typeof spotDropsConfig.tables

export function dropsOf(method: FieldMethod): method is DropMethod {
  return method in spotDropsConfig.tables
}
