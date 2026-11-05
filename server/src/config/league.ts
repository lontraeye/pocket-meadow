// Liga de Johto (PLANNING 5.24, parte 2): cinco lutas seguidas, sem curar
// entre elas. Níveis do Crystal; golpes no formato dos líderes (um rápido até
// 55 e um carregado, os que a base tem). O ás tem IV 31.

import { APRICORN_YELLOW } from './apricorn.js'
import type { TrainerConfig } from './trainers.js'
import type { LeaderFoe } from './leaders.js'

const ACE_IV = 31
const IV = 20

function foe(partial: LeaderFoe): LeaderFoe {
  return partial
}

export const leagueConfig = {
  /** Prêmio da primeira vez que se vence o campeão. */
  championRewards: {
    items: [
      { itemKey: 'ball:ultra', quantity: 3 },
      { itemKey: APRICORN_YELLOW, quantity: 5 },
    ],
    genericCandies: 50,
  },
}

export const leagueTrainers: readonly TrainerConfig[] = [
  {
    key: 'league-1',
    name: 'Elite da Liga (Psíquico)',
    kind: 'elite',
    foes: [
      foe({ speciesId: 178, level: 40, fastMove: 'peck', chargedMove: 'future-sight', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 124, level: 41, fastMove: 'powder-snow', chargedMove: 'ice-punch', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 103, level: 41, fastMove: 'confusion', chargedMove: 'egg-bomb', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 80, level: 41, fastMove: 'water-gun', chargedMove: 'psychic', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 178, level: 42, fastMove: 'peck', chargedMove: 'psychic', nature: 'modest', abilitySlot: '1', iv: ACE_IV, ace: true }),
    ],
  },
  {
    key: 'league-2',
    name: 'Elite da Liga (Veneno)',
    kind: 'elite',
    foes: [
      foe({ speciesId: 168, level: 40, fastMove: 'poison-sting', chargedMove: 'leech-life', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 49, level: 41, fastMove: 'gust', chargedMove: 'psychic', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 205, level: 43, fastMove: 'rapid-spin', chargedMove: 'zap-cannon', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 89, level: 42, fastMove: 'pound', chargedMove: 'sludge-bomb', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 169, level: 44, fastMove: 'poison-fang', chargedMove: 'wing-attack', nature: 'jolly', abilitySlot: '1', iv: ACE_IV, ace: true }),
    ],
  },
  {
    key: 'league-3',
    name: 'Elite da Liga (Lutador)',
    kind: 'elite',
    foes: [
      foe({ speciesId: 237, level: 42, fastMove: 'quick-attack', chargedMove: 'rolling-kick', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 106, level: 42, fastMove: 'double-kick', chargedMove: 'high-jump-kick', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 107, level: 42, fastMove: 'mach-punch', chargedMove: 'thunder-punch', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 95, level: 43, fastMove: 'rock-throw', chargedMove: 'slam', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 68, level: 46, fastMove: 'karate-chop', chargedMove: 'cross-chop', nature: 'adamant', abilitySlot: '1', iv: ACE_IV, ace: true }),
    ],
  },
  {
    key: 'league-4',
    name: 'Elite da Liga (Sombrio)',
    kind: 'elite',
    foes: [
      foe({ speciesId: 197, level: 42, fastMove: 'pursuit', chargedMove: 'feint-attack', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 45, level: 42, fastMove: 'acid', chargedMove: 'petal-dance', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 94, level: 45, fastMove: 'lick', chargedMove: 'dream-eater', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 198, level: 44, fastMove: 'pursuit', chargedMove: 'feint-attack', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 229, level: 47, fastMove: 'ember', chargedMove: 'flamethrower', nature: 'modest', abilitySlot: '2', iv: ACE_IV, ace: true }),
    ],
  },
  {
    key: 'league-champion',
    name: 'Campeão da Liga (Dragão)',
    kind: 'champion',
    foes: [
      foe({ speciesId: 130, level: 44, fastMove: 'twister', chargedMove: 'hydro-pump', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 149, level: 47, fastMove: 'twister', chargedMove: 'outrage', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 149, level: 47, fastMove: 'twister', chargedMove: 'hyper-beam', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 142, level: 46, fastMove: 'rock-throw', chargedMove: 'ancient-power', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 6, level: 46, fastMove: 'ember', chargedMove: 'flamethrower', nature: 'hardy', abilitySlot: '1', iv: IV }),
      foe({ speciesId: 149, level: 50, fastMove: 'twister', chargedMove: 'outrage', nature: 'adamant', abilitySlot: '1', iv: ACE_IV, ace: true }),
    ],
  },
]

export function leagueTrainerAt(stage: number): TrainerConfig | undefined {
  return leagueTrainers[stage]
}
