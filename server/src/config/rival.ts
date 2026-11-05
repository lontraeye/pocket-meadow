// Rival de Johto (PLANNING 5.24, parte 3): cinco lutas pontuais, cada uma num
// lugar e num capítulo. Não trava o marco: é um prêmio a mais, uma vez só.
//
// O time começa com o inicial que vence o do jogador e cresce com o capítulo
// (times e níveis perto do Crystal; o ás é sempre o inicial, por último).
// Golpes no formato dos líderes: um rápido até 55 e um carregado, da base.

import { APRICORN_BLUE, APRICORN_YELLOW } from './apricorn.js'
import type { LeaderFoe } from './leaders.js'
import type { TrainerConfig } from './trainers.js'

const ACE_IV = 31
const IV = 20

/** Linha do inicial do rival (a que vence a do jogador). */
export type RivalLine = 'fire' | 'water' | 'grass'

/** Inicial do jogador → linha do rival: Chikorita → fogo, Cyndaquil → água, Totodile → planta. */
export const RIVAL_LINE_BY_STARTER: Readonly<Record<number, RivalLine>> = {
  152: 'fire',
  155: 'water',
  158: 'grass',
}

export type RivalFight = {
  /** Chave da luta (sem a linha): o que fica gravado em trainer_rivals. */
  key: string
  chapter: number
  /** Slug do lugar (config/places.ts). */
  place: string
  /** Os outros Pokémon do time, antes do inicial. */
  support: readonly LeaderFoe[]
  /** O inicial do rival nesta luta, por linha. */
  ace: Readonly<Record<RivalLine, LeaderFoe>>
  rewards: readonly { itemKey: string; quantity: number }[]
}

function support(speciesId: number, level: number, fastMove: string, chargedMove: string | null): LeaderFoe {
  return { speciesId, level, fastMove, chargedMove, nature: 'hardy', abilitySlot: '1', iv: IV }
}

function ace(speciesId: number, level: number, fastMove: string, chargedMove: string | null, nature: string): LeaderFoe {
  return { speciesId, level, fastMove, chargedMove, nature, abilitySlot: '1', iv: ACE_IV, ace: true }
}

export const rivalFights: readonly RivalFight[] = [
  {
    key: 'rival-1',
    chapter: 1,
    place: 'cherrygrove',
    support: [],
    ace: {
      fire: ace(155, 5, 'tackle', null, 'modest'),
      water: ace(158, 5, 'scratch', null, 'adamant'),
      grass: ace(152, 5, 'tackle', null, 'bold'),
    },
    rewards: [{ itemKey: 'ball:poke', quantity: 5 }],
  },
  {
    key: 'rival-2',
    chapter: 2,
    place: 'azalea',
    support: [support(92, 12, 'lick', null), support(41, 14, 'astonish', 'wing-attack')],
    ace: {
      fire: ace(156, 16, 'ember', 'flame-wheel', 'modest'),
      water: ace(159, 16, 'water-gun', 'bite', 'adamant'),
      grass: ace(153, 16, 'razor-leaf', 'magical-leaf', 'bold'),
    },
    rewards: [{ itemKey: 'ball:great', quantity: 3 }],
  },
  {
    key: 'rival-3',
    chapter: 4,
    place: 'burned-tower',
    support: [
      support(92, 20, 'lick', 'dream-eater'),
      support(41, 20, 'astonish', 'wing-attack'),
      support(81, 18, 'thunder-shock', 'spark'),
    ],
    ace: {
      fire: ace(156, 22, 'ember', 'flame-wheel', 'modest'),
      water: ace(159, 22, 'water-gun', 'bite', 'adamant'),
      grass: ace(153, 22, 'razor-leaf', 'body-slam', 'bold'),
    },
    rewards: [
      { itemKey: APRICORN_BLUE, quantity: 2 },
      { itemKey: 'ball:great', quantity: 3 },
    ],
  },
  {
    key: 'rival-4',
    chapter: 7,
    // A Torre de Rádio não é lugar: a luta fica na cidade.
    place: 'goldenrod',
    support: [
      support(42, 30, 'astonish', 'air-cutter'),
      support(81, 28, 'thunder-shock', 'spark'),
      support(93, 30, 'lick', 'dream-eater'),
      support(215, 32, 'quick-attack', 'feint-attack'),
    ],
    ace: {
      fire: ace(157, 34, 'ember', 'flamethrower', 'modest'),
      water: ace(160, 34, 'water-gun', 'hydro-pump', 'adamant'),
      grass: ace(154, 34, 'razor-leaf', 'body-slam', 'bold'),
    },
    rewards: [
      { itemKey: APRICORN_YELLOW, quantity: 2 },
      { itemKey: 'ball:ultra', quantity: 2 },
    ],
  },
  {
    key: 'rival-5',
    chapter: 9,
    place: 'victory-road-johto',
    support: [
      support(215, 34, 'quick-attack', 'feint-attack'),
      support(42, 36, 'astonish', 'air-cutter'),
      support(82, 35, 'thunder-shock', 'thunderbolt'),
      support(93, 35, 'lick', 'dream-eater'),
      support(64, 35, 'confusion', 'psychic'),
    ],
    ace: {
      fire: ace(157, 40, 'ember', 'flamethrower', 'modest'),
      water: ace(160, 40, 'water-gun', 'hydro-pump', 'adamant'),
      grass: ace(154, 40, 'razor-leaf', 'solar-beam', 'bold'),
    },
    rewards: [{ itemKey: 'ball:ultra', quantity: 3 }],
  },
]

const LINES: readonly RivalLine[] = ['fire', 'water', 'grass']

/** Chave do treinador (vai em encounters.leader_key): a luta e a linha, "rival-2/water". */
export function rivalTrainerKey(fightKey: string, line: RivalLine): string {
  return `${fightKey}/${line}`
}

/** "rival-2/water" → a luta "rival-2". */
export function rivalFightOfKey(trainerKey: string): RivalFight | undefined {
  const [fightKey] = trainerKey.split('/')
  return rivalFights.find((fight) => fight.key === fightKey)
}

export function rivalFightByKey(key: string): RivalFight | undefined {
  return rivalFights.find((fight) => fight.key === key)
}

/** Linha do rival para o inicial do jogador; sem inicial conhecido, fogo. */
export function rivalLineFor(starterSpeciesId: number | null): RivalLine {
  return (starterSpeciesId !== null ? RIVAL_LINE_BY_STARTER[starterSpeciesId] : undefined) ?? 'fire'
}

/** Todas as variações (luta × linha) como treinadores, para trainerByKey e o teste de boot. */
export const rivalTrainers: readonly TrainerConfig[] = rivalFights.flatMap((fight) =>
  LINES.map((line) => ({
    key: rivalTrainerKey(fight.key, line),
    name: 'Rival',
    kind: 'rival' as const,
    foes: [...fight.support, fight.ace[line]],
  })),
)
