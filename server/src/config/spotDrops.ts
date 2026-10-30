import { ballItemKey } from './balls.js'
import { berryItemKey, SEED_DROP_WEIGHTS } from './berries.js'
import type { FieldMethod } from './regions.js'

/**
 * Árvore e pedra do campo (JORNADA.md, seção 4): cada uso sorteia ou um item,
 * ou um Pokémon. O item gasta a energia do mesmo jeito, mas não abre encontro.
 * A árvore derruba berries (os mesmos pesos das sementes da luta); a pedra
 * solta bolas. Pedras de evolução (PLANNING 5.16) entram aqui quando existirem.
 */
export const spotDropsConfig = {
  chance: 0.3,
  tables: {
    headbutt: SEED_DROP_WEIGHTS.map((row) => ({ itemKey: berryItemKey(row.berryKey), weight: row.weight })),
    rockSmash: [
      { itemKey: ballItemKey('poke'), weight: 75 },
      { itemKey: ballItemKey('great'), weight: 20 },
      { itemKey: ballItemKey('ultra'), weight: 5 },
    ],
  } satisfies Partial<Record<FieldMethod, { itemKey: string; weight: number }[]>>,
}

export type DropMethod = keyof typeof spotDropsConfig.tables

export function dropsOf(method: FieldMethod): method is DropMethod {
  return method in spotDropsConfig.tables
}
