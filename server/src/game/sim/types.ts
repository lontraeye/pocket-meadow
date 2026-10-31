import type { PokemonType } from '../../config/types.js'
import type { MoveAilment, MoveEffectFields, StageStat, Stages, StatusCondition } from './effects.js'

export type DamageClass = 'physical' | 'special'

export type { MoveAilment, StageStat, Stages, StatusCondition }

export type SimMove = {
  name: string
  type: PokemonType
  power: number
  damageClass: DamageClass
} & MoveEffectFields

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
  /** O adversário em campo no começo (o selvagem, ou o 1º do treinador). */
  wild: SimFighter
  /**
   * Treinador (líder): o time dele em ordem, com `wild` = `foes[0]`. Quando um
   * desmaia, o próximo entra (como o do jogador). Ausente = selvagem sozinho.
   */
  foes?: SimFighter[]
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
  | {
      t: number
      kind: 'move'
      side: 'player' | 'wild'
      move: 'fast' | 'charged'
      moveName: string
      damage: number
      /** Multiplicador de tipo (0, 0.25, 0.5, 1, 2, 4) — o mesmo que o dano usa. */
      effectiveness: number
      critical: boolean
      fainted: boolean
    }
  | { t: number; kind: 'heal'; side: 'player' | 'wild'; amount: number }
  | { t: number; kind: 'faint'; side: 'player' | 'wild'; slot: number }
  | { t: number; kind: 'switch'; side: 'player'; slot: number; manual: boolean }
  | { t: number; kind: 'intimidate'; side: 'player' | 'wild' }
  | {
      t: number
      kind: 'status'
      side: 'player' | 'wild'
      status: StatusCondition | 'confusion'
      /** true = aplicado; false = curado. */
      applied: boolean
    }
  | {
      t: number
      kind: 'status_damage'
      side: 'player' | 'wild'
      status: 'burn' | 'poison'
      damage: number
      fainted: boolean
    }
  | {
      t: number
      kind: 'stat_change'
      side: 'player' | 'wild'
      stat: StageStat
      stages: number
      /** Estágio depois da mudança (−6…+6). */
      value: number
    }
  | {
      t: number
      kind: 'drain'
      side: 'player' | 'wild'
      amount: number
    }
  | {
      t: number
      kind: 'recoil'
      side: 'player' | 'wild'
      damage: number
      fainted: boolean
    }
  | {
      t: number
      kind: 'confusion_hit'
      side: 'player' | 'wild'
      damage: number
      fainted: boolean
    }
  | {
      t: number
      kind: 'cant_act'
      side: 'player' | 'wild'
      reason: 'sleep' | 'freeze'
    }
  | {
      t: number
      kind: 'ignored'
      side: 'player' | 'wild'
      reason: 'cooldown' | 'energy' | 'invalid' | 'fainted' | 'switching'
    }
  | { t: number; kind: 'end'; result: BattleResultKind }

export type BattleResultKind = 'win' | 'lose' | 'timeout'

/** Foto do estado para a tela ao vivo (untilMs). */
export type BattleSnapshotSide = {
  slot: number
  fighterId: number | null
  speciesId: number
  hp: number
  maxHp: number
  energy: number
  readyAt: number
  fainted: boolean
  status: StatusCondition | null
  confused: boolean
  stages: Stages
}

export type BattleSnapshot = {
  t: number
  activeSlot: number
  switchReadyAt: number
  team: BattleSnapshotSide[]
  /** O adversário em campo agora. */
  wild: BattleSnapshotSide
  /** Qual do time adversário está em campo (0 no selvagem). */
  foeSlot: number
  /** O time adversário inteiro (só o selvagem, se não for treinador). */
  foes: BattleSnapshotSide[]
  /** null = luta ainda em andamento (parou em untilMs). */
  result: BattleResultKind | null
}

export type BattleResult = {
  /** null se parou cedo com untilMs sem fim. */
  result: BattleResultKind | null
  /** Duração até o fim ou até untilMs (ms). */
  durationMs: number
  log: BattleEvent[]
  /** Inputs efetivos (inclui os do automático). */
  inputs: BattleInput[]
  /** Slots do time que entraram na luta (XP/EVs: quem entrou e não desmaiou). */
  enteredSlots: number[]
  snapshot: BattleSnapshot
}
