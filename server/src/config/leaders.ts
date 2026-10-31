import type { AbilitySlot } from '../game/traits.js'

/**
 * Líderes de Johto (JORNADA.md, seção 9, parte 6): o marco da cidade só vem
 * vencendo o líder. É uma luta só, contínua: quando um Pokémon dele cai, o
 * próximo entra (como o seu), e o HP de cada lado vale até o fim. Perdeu,
 * tenta de novo do começo.
 *
 * Times do HeartGold/SoulSilver com os níveis do Crystal (os mesmos jogos das
 * tabelas de encontro). Os golpes são adaptados à nossa luta (um rápido, até
 * 55 de poder, e um carregado), escolhidos entre os golpes que a base tem,
 * perto dos que cada um usa nos jogos. O ás de cada líder tem IV 31 em tudo,
 * natureza escolhida e a habilidade que faz diferença; os outros, IV 20.
 *
 * Nomes: por enquanto "Líder de <cidade>" (os nomes ainda estão para decidir,
 * JORNADA.md seção 10).
 */
export type LeaderFoe = {
  speciesId: number
  level: number
  fastMove: string
  chargedMove: string | null
  nature: string
  abilitySlot: AbilitySlot
  /** IV de todos os atributos. */
  iv: number
  ace?: boolean
}

export type LeaderConfig = {
  /** O marco que o líder entrega (milestones.ts). */
  milestoneKey: string
  name: string
  foes: readonly LeaderFoe[]
}

const ACE_IV = 31
const IV = 20

export const leaderConfigs: readonly LeaderConfig[] = [
  {
    milestoneKey: 'violet',
    name: 'Líder de Violet',
    foes: [
      { speciesId: 16, level: 7, fastMove: 'tackle', chargedMove: null, nature: 'hardy', abilitySlot: '1', iv: IV },
      // Pidgeotto: o ás que abre o jogo, rápido e com Wing Attack.
      { speciesId: 17, level: 9, fastMove: 'gust', chargedMove: 'wing-attack', nature: 'jolly', abilitySlot: '1', iv: ACE_IV, ace: true },
    ],
  },
  {
    milestoneKey: 'azalea',
    name: 'Líder de Azalea',
    foes: [
      { speciesId: 11, level: 14, fastMove: 'tackle', chargedMove: null, nature: 'hardy', abilitySlot: '1', iv: IV },
      { speciesId: 14, level: 14, fastMove: 'poison-sting', chargedMove: null, nature: 'hardy', abilitySlot: '1', iv: IV },
      // Scyther com Swarm: Fury Cutter fica mais forte quando ele está no fim.
      { speciesId: 123, level: 16, fastMove: 'fury-cutter', chargedMove: 'wing-attack', nature: 'adamant', abilitySlot: '1', iv: ACE_IV, ace: true },
    ],
  },
  {
    milestoneKey: 'goldenrod',
    name: 'Líder de Goldenrod',
    foes: [
      { speciesId: 35, level: 18, fastMove: 'pound', chargedMove: null, nature: 'hardy', abilitySlot: '1', iv: IV },
      // A Miltank famosa: Rollout e Stomp, rápida e com Thick Fat (fogo e gelo pela metade).
      { speciesId: 241, level: 20, fastMove: 'rollout', chargedMove: 'stomp', nature: 'jolly', abilitySlot: '1', iv: ACE_IV, ace: true },
    ],
  },
  {
    milestoneKey: 'ecruteak',
    name: 'Líder de Ecruteak',
    foes: [
      { speciesId: 92, level: 21, fastMove: 'lick', chargedMove: null, nature: 'hardy', abilitySlot: '1', iv: IV },
      { speciesId: 93, level: 21, fastMove: 'lick', chargedMove: 'dream-eater', nature: 'hardy', abilitySlot: '1', iv: IV },
      { speciesId: 93, level: 23, fastMove: 'astonish', chargedMove: 'dream-eater', nature: 'hardy', abilitySlot: '1', iv: IV },
      // Gengar: Lick paralisa e o Dream Eater cura metade do dano.
      { speciesId: 94, level: 25, fastMove: 'lick', chargedMove: 'dream-eater', nature: 'timid', abilitySlot: '1', iv: ACE_IV, ace: true },
    ],
  },
  {
    milestoneKey: 'cianwood',
    name: 'Líder de Cianwood',
    foes: [
      { speciesId: 57, level: 27, fastMove: 'karate-chop', chargedMove: 'rock-slide', nature: 'hardy', abilitySlot: '1', iv: IV },
      // Poliwrath: Body Slam paralisa; Water Absorb: golpe de Água nele cura em vez de ferir.
      { speciesId: 62, level: 30, fastMove: 'water-gun', chargedMove: 'body-slam', nature: 'adamant', abilitySlot: '1', iv: ACE_IV, ace: true },
    ],
  },
  {
    milestoneKey: 'olivine',
    name: 'Líder de Olivine',
    foes: [
      { speciesId: 81, level: 30, fastMove: 'thunder-shock', chargedMove: 'thunderbolt', nature: 'hardy', abilitySlot: '2', iv: IV },
      { speciesId: 81, level: 30, fastMove: 'thunder-shock', chargedMove: 'thunderbolt', nature: 'hardy', abilitySlot: '2', iv: IV },
      // Steelix com Sturdy: aguenta um golpe que o derrubaria de vida cheia.
      { speciesId: 208, level: 35, fastMove: 'rock-throw', chargedMove: 'iron-tail', nature: 'adamant', abilitySlot: '2', iv: ACE_IV, ace: true },
    ],
  },
  {
    milestoneKey: 'mahogany',
    name: 'Líder de Mahogany',
    foes: [
      { speciesId: 86, level: 27, fastMove: 'icy-wind', chargedMove: 'aurora-beam', nature: 'hardy', abilitySlot: '1', iv: IV },
      { speciesId: 87, level: 29, fastMove: 'icy-wind', chargedMove: 'aurora-beam', nature: 'hardy', abilitySlot: '1', iv: IV },
      // Piloswine com Thick Fat (oculta): Blizzard congela, e fogo dói pela metade.
      { speciesId: 221, level: 31, fastMove: 'powder-snow', chargedMove: 'blizzard', nature: 'modest', abilitySlot: 'hidden', iv: ACE_IV, ace: true },
    ],
  },
  {
    milestoneKey: 'blackthorn',
    name: 'Líder de Blackthorn',
    foes: [
      // Gyarados com Intimidate: ao entrar, baixa o ataque do seu Pokémon.
      { speciesId: 130, level: 37, fastMove: 'twister', chargedMove: 'bite', nature: 'hardy', abilitySlot: '1', iv: IV },
      { speciesId: 148, level: 37, fastMove: 'twister', chargedMove: 'dragon-breath', nature: 'hardy', abilitySlot: 'hidden', iv: IV },
      { speciesId: 148, level: 37, fastMove: 'twister', chargedMove: 'slam', nature: 'hardy', abilitySlot: 'hidden', iv: IV },
      // Kingdra com Sniper: crítico dói mais; Hydro Pump forte.
      { speciesId: 230, level: 40, fastMove: 'twister', chargedMove: 'hydro-pump', nature: 'modest', abilitySlot: '2', iv: ACE_IV, ace: true },
    ],
  },
]

export function leaderByMilestone(key: string): LeaderConfig | undefined {
  return leaderConfigs.find((leader) => leader.milestoneKey === key)
}
