// Cuidado como pet (PLANNING.md, seção 5.21). Fome e carinho caem com o tempo;
// a felicidade sobe enquanto os dois estão acima do limite e cai abaixo dele.
// O pet feliz ganha XP no jardim e deixa presentes no chão. Tudo por
// timestamp, calculado no pedido (seção 2): nada roda em loop.

import { SEED_DROP_WEIGHTS } from './berries.js'

const hourMs = 60 * 60 * 1000

export type GiftDef =
  | { kind: 'item'; itemKey: string; min: number; max: number; weight: number }
  | { kind: 'genericCandy'; min: number; max: number; weight: number }

export const petConfig = {
  /** Valores de quem nunca passou pelo jardim (captura, migração). */
  start: { hunger: 80, affection: 60, happiness: 20 },
  /** Pontos por hora (de 0 a 100): a fome zera em ~12 h, o carinho em ~24 h. */
  hungerDrainPerHour: 100 / 12,
  affectionDrainPerHour: 100 / 24,
  /** Acima disso (nos dois) a felicidade sobe; abaixo, cai. */
  needThreshold: 40,
  /** De 0 a 100 em ~2 dias de cuidado; de 100 a 0 em ~3 dias sem. */
  happinessUpPerHour: 100 / 48,
  happinessDownPerHour: 100 / 72,
  /** Carinho: quanto enche e de quanto em quanto tempo o mesmo Pokémon aceita. */
  petAmount: 30,
  petCooldownMs: 30 * 60 * 1000,
  /** Berry como comida: quanto enche; com a fome acima de `fullAt`, recusa. */
  berryFill: 40,
  fullAt: 90,
  /**
   * XP do jardim: `xpPerLevelHour × nível × felicidade/100` por hora. Bem
   * abaixo do daycare (3 × nível), que é o treino focado (5.21).
   */
  xpPerLevelHour: 1,
  /** Um pedido só liquida o tempo a partir deste intervalo (evita gravar a cada toque). */
  settleMinMs: 60 * 1000,
  gifts: {
    /** Felicidade mínima para deixar presente. */
    minHappiness: 60,
    /** Intervalo entre presentes do mesmo Pokémon. */
    intervalMs: 4 * hourMs,
    /** Presentes no chão ao mesmo tempo, somando todos os Pokémon. */
    maxOnGround: 5,
    table: [
      ...SEED_DROP_WEIGHTS.map(
        (row): GiftDef => ({ kind: 'item', itemKey: `seed:${row.berryKey}`, min: 1, max: 1, weight: row.weight }),
      ),
      { kind: 'genericCandy', min: 1, max: 3, weight: 60 },
      { kind: 'item', itemKey: 'ball:poke', min: 1, max: 2, weight: 40 },
      { kind: 'item', itemKey: 'ball:great', min: 1, max: 1, weight: 10 },
    ] as readonly GiftDef[],
  },
} as const

/** Chave do presente de doce genérico na tabela `garden_gifts`. */
export const GENERIC_CANDY_GIFT = 'generic_candy'
