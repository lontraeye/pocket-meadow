import type { PokemonType } from '../../config/types.js'

export type DamageClass = 'physical' | 'special'

export type SimMove = {
  name: string
  type: PokemonType
  power: number
  damageClass: DamageClass
}

export type SimFighter = {
  /** id do Pokémon do jogador, ou null para o selvagem. */
  id: number | null
  speciesId: number
  level: number
  types: readonly [PokemonType] | readonly [PokemonType, PokemonType]
  /** Atributos finais já calculados. */
  stats: {
    hp: number
    attack: number
    defense: number
    spAttack: number
    spDefense: number
    speed: number
  }
  fastMove: SimMove
  chargedMove: SimMove | null
  /** Nome da habilidade já resolvido pela posição. */
  abilityKey: string
}

export type BattleSetup = {
  team: SimFighter[]
  wild: SimFighter
}

export type BattleAction = 'fast' | 'charged' | 'switch'

export type BattleInput = {
  /** ms desde o início da luta. */
  t: number
  action: BattleAction
  /** Slot do time (0–2) para switch. */
  slot?: number
}

export type BattleEvent =
  | { t: number; kind: 'enter'; side: 'player' | 'wild'; fighterId: number | null; slot: number }
  | { t: number; kind: 'move'; side: 'player' | 'wild'; move: 'fast' | 'charged'; moveName: string; damage: number; fainted: boolean }
  | { t: number; kind: 'heal'; side: 'player' | 'wild'; amount: number }
  | { t: number; kind: 'faint'; side: 'player' | 'wild'; slot: number }
  | { t: number; kind: 'switch'; side: 'player'; slot: number; manual: boolean }
  | { t: number; kind: 'intimidate'; side: 'player' | 'wild' }
  | {
      t: number
      kind: 'ignored'
      side: 'player' | 'wild'
      reason: 'cooldown' | 'energy' | 'invalid' | 'fainted' | 'switching'
    }
  | { t: number; kind: 'end'; result: BattleResultKind }

export type BattleResultKind = 'win' | 'lose' | 'timeout'

export type BattleResult = {
  result: BattleResultKind
  /** Duração até o fim (ms). */
  durationMs: number
  log: BattleEvent[]
  /** Inputs efetivos (inclui os do automático). */
  inputs: BattleInput[]
  /** Slots do time que entraram na luta (para EVs). */
  enteredSlots: number[]
}
