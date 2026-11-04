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
  // Ritmo (PROGRESSAO.md, item 7): metade dos usos dá item; ~0,9 madeira por
  // Headbutt e ~1,2 pedra por Rock Smash (uma receita em ~9 usos).
  chance: 0.5,
  tables: {
    headbutt: [
      ...SEED_DROP_WEIGHTS.map((row) => ({ itemKey: berryItemKey(row.berryKey), weight: row.weight })),
      // As berries somam 100: com o Apricorn (50) e a madeira (125), cada um sai em ~1/5 e ~45% dos itens.
      { itemKey: APRICORN_ITEM, weight: 50 },
      { itemKey: WOOD_ITEM, weight: 125, min: 3, max: 5 },
    ],
    rockSmash: [
      { itemKey: ballItemKey('poke'), weight: 75 },
      { itemKey: ballItemKey('great'), weight: 20 },
      { itemKey: ballItemKey('ultra'), weight: 5 },
      // 60% dos itens da pedra é pedra.
      { itemKey: STONE_ITEM, weight: 150, min: 3, max: 5 },
    ],
  } satisfies Partial<Record<FieldMethod, { itemKey: string; weight: number; min?: number; max?: number }[]>>,
}

export type DropMethod = keyof typeof spotDropsConfig.tables

export function dropsOf(method: FieldMethod): method is DropMethod {
  return method in spotDropsConfig.tables
}
