import type { StatKey } from './natures.js'

export const traitsConfig = {
  /** Chance de habilidade oculta na captura / backfill. */
  hiddenAbilityChance: 0.05,
  /** Poder máximo de golpe rápido (fast). Acima disso é carregado (charged). */
  fastPowerMax: 55,
  ivMin: 0,
  ivMax: 31,
} as const

/** Fallback quando a espécie não tem nenhum golpe rápido no pool. */
export const fallbackFastMove = { name: 'tackle', id: 33 } as const

/**
 * Version groups da PokéAPI por geração. O pool de uma espécie usa a geração
 * em que ela estreou e a seguinte (PLANNING.md 5.18).
 */
export const versionGroupsByGeneration: Record<number, readonly string[]> = {
  1: ['red-blue', 'yellow'],
  2: ['gold-silver', 'crystal'],
  3: ['ruby-sapphire', 'emerald', 'firered-leafgreen'],
  4: ['diamond-pearl', 'platinum', 'heartgold-soulsilver'],
  5: ['black-white', 'black-2-white-2'],
  6: ['x-y', 'omega-ruby-alpha-sapphire'],
  7: ['sun-moon', 'ultra-sun-ultra-moon', 'lets-go-pikachu-lets-go-eevee'],
  8: ['sword-shield', 'brilliant-diamond-shining-pearl', 'legends-arceus'],
  9: ['scarlet-violet', 'the-teal-mask', 'the-indigo-disk'],
}

/** Version groups do pool: estreia + geração seguinte (se existir). */
export function learnVersionGroupsForDebut(debutGeneration: number): readonly string[] {
  const current = versionGroupsByGeneration[debutGeneration] ?? []
  const next = versionGroupsByGeneration[debutGeneration + 1] ?? []
  return [...current, ...next]
}

/**
 * Habilidades com efeito na luta (conjunto da 5.18). Só a lista nesta parte;
 * o efeito entra na 8.2.
 */
export const combatAbilityKeys = [
  'intimidate',
  'blaze',
  'torrent',
  'overgrow',
  'swarm',
  'levitate',
  'flash-fire',
  'water-absorb',
  'volt-absorb',
  'sturdy',
  'thick-fat',
  'hustle',
  'huge-power',
  'sniper',
] as const

export type CombatAbilityKey = (typeof combatAbilityKeys)[number]

export function isCombatAbility(key: string): key is CombatAbilityKey {
  return (combatAbilityKeys as readonly string[]).includes(key)
}

export const statKeys = ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed'] as const
export type FullStatKey = (typeof statKeys)[number]

export const natureStatKeys: StatKey[] = ['attack', 'defense', 'spAttack', 'spDefense', 'speed']
