// Quadro de missões diárias (PLANNING.md, seção 5.20): 3 por dia, sorteadas no
// primeiro acesso do dia (meia-noite de Brasília, a mesma do clima) e contadas
// pelo que o jogo já guarda (encontros, Pokédex). Completar as 3 abre o baú.

import { APRICORN_BLUE, APRICORN_ITEM, APRICORN_YELLOW } from './apricorn.js'

export type MissionKind =
  | 'win_any'
  | 'win_area'
  | 'catch_any'
  | 'catch_type'
  | 'catch_new'
  | 'win_with_type'
  | 'harvest_apricorn'
  | 'make_balls'
  | 'harvest_berries'
  | 'feed_pets'

export type MissionReward = {
  trainerXp: number
  genericCandies: number
  items: { itemKey: string; quantity: number }[]
  /** Uma semente sorteada pelos pesos da luta. */
  randomSeed?: boolean
}

export const missionConfig = {
  perDay: 3,
  rerollsPerDay: 1,
  /** Peso de cada tipo no sorteio (só entram os que fazem sentido para o jogador). */
  weights: {
    win_any: 3,
    win_area: 3,
    catch_any: 3,
    catch_type: 2,
    catch_new: 2,
    win_with_type: 2,
    // Jardim (5.23): só quando a árvore e a bancada estão abertas.
    harvest_apricorn: 2,
    make_balls: 2,
    harvest_berries: 2,
    feed_pets: 2,
  } satisfies Record<MissionKind, number>,
  /** Quantas vezes cada missão pede, pelo nível de treinador. Alvo: 5 a 10 minutos de jogo. */
  target(kind: MissionKind, level: number): number {
    switch (kind) {
      case 'win_any':
        return Math.min(8, 4 + Math.floor(level / 6))
      case 'win_area':
      case 'win_with_type':
        return Math.min(6, 3 + Math.floor(level / 10))
      case 'catch_any':
        return Math.min(5, 2 + Math.floor(level / 10))
      case 'catch_type':
        return 2
      case 'catch_new':
        return 1
      // A árvore dá 1 a cada 3 h (até 5): 3 é um dia de voltar algumas vezes.
      case 'harvest_apricorn':
        return 3
      // 2 Apricorns na bancada.
      case 'make_balls':
        return 4
      // Umas duas colheitas da horta.
      case 'harvest_berries':
        return 5
      case 'feed_pets':
        return 3
    }
  },
  reward(kind: MissionKind, level: number): MissionReward {
    const trainerXp = 15 + 3 * level
    if (kind === 'catch_new') {
      return {
        trainerXp,
        genericCandies: 3,
        items: [
          { itemKey: 'ball:great', quantity: 1 },
          { itemKey: APRICORN_BLUE, quantity: 1 },
        ],
      }
    }
    // Quem já produz Poké Balls ganha uma Great; quem colhe ganha mais Apricorn.
    if (kind === 'make_balls') {
      return { trainerXp, genericCandies: 2, items: [{ itemKey: 'ball:great', quantity: 1 }] }
    }
    if (kind === 'harvest_apricorn') {
      return { trainerXp, genericCandies: 2, items: [{ itemKey: APRICORN_ITEM, quantity: 2 }] }
    }
    // Semente é rara (só sai do arbusto seco): colher berries paga com uma.
    if (kind === 'harvest_berries') {
      return { trainerXp, genericCandies: 2, items: [], randomSeed: true }
    }
    if (kind === 'feed_pets') {
      return { trainerXp, genericCandies: 3, items: [] }
    }
    // Apricorn no lugar de bola (PROGRESSAO.md, item 5): a bola sai da bancada.
    return { trainerXp, genericCandies: 2, items: [{ itemKey: APRICORN_ITEM, quantity: 2 }] }
  },
  /** Baú do dia, ao resgatar as 3. */
  chest(level: number): MissionReward {
    return {
      trainerXp: 40 + 6 * level,
      genericCandies: 8,
      items: [
        { itemKey: 'ball:great', quantity: 1 },
        { itemKey: APRICORN_ITEM, quantity: 3 },
        { itemKey: APRICORN_BLUE, quantity: 2 },
        ...(level >= 12 ? [{ itemKey: APRICORN_YELLOW, quantity: 1 }] : []),
      ],
      randomSeed: true,
    }
  },
  /** Dias guardados (o resto é apagado ao abrir um dia novo). */
  keepDays: 7,
}
