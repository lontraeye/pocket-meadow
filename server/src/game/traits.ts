import { natures } from '../config/natures.js'
import { traitsConfig } from '../config/traits.js'
import type { Rng } from './mulberry32.js'
import type { StatBlock } from './stats.js'

export type AbilitySlot = '1' | '2' | 'hidden'

export type MoveAilmentName =
  | 'burn'
  | 'poison'
  | 'paralysis'
  | 'sleep'
  | 'freeze'
  | 'confusion'

export type MoveStatChange = {
  stat: 'attack' | 'defense' | 'spAttack' | 'spDefense' | 'speed'
  stages: number
}

export type MoveInfo = {
  name: string
  displayName: string
  type: string
  power: number
  damageClass: 'physical' | 'special'
  /** 8.6 — opcional nos snapshots antigos. */
  ailment?: MoveAilmentName | null
  ailmentChance?: number
  statChanges?: MoveStatChange[]
  statChance?: number
  /** true = buff no usuário (damage-raise). */
  statOnSelf?: boolean
  /** % do dano: positivo cura, negativo recuo. */
  drain?: number
  /** 0 normal; ≥1 crítico alto (Slash…). */
  critRate?: number
}

export type LearnEntry = { move: string; level: number }

export type SpeciesAbilities = {
  slot1: string
  slot2: string | null
  hidden: string | null
}

export type RolledTraits = {
  ivs: StatBlock
  evs: StatBlock
  nature: string
  abilitySlot: AbilitySlot
  fastMove: string
  chargedMove: string | null
}

export function isFastMove(power: number): boolean {
  return power <= traitsConfig.fastPowerMax
}

export function isChargedMove(power: number): boolean {
  return power > traitsConfig.fastPowerMax
}

export function traitsRngSeed(source: number): number {
  // Derivado da seed do encontro / id do Pokémon — sequência própria (5.18).
  return (source ^ 0x54524149) >>> 0
}

export function rollTraits(
  rng: Rng,
  input: {
    level: number
    learnset: LearnEntry[]
    abilities: SpeciesAbilities
    moves: Map<string, MoveInfo>
  },
): RolledTraits {
  const ivs = {
    hp: rollIv(rng),
    attack: rollIv(rng),
    defense: rollIv(rng),
    spAttack: rollIv(rng),
    spDefense: rollIv(rng),
    speed: rollIv(rng),
  }
  const nature = natures[Math.floor(rng() * natures.length)]!.key
  const abilitySlot = rollAbilitySlot(rng, input.abilities)
  const moves = rollMoves(rng, input.level, input.learnset, input.moves)
  return {
    ivs,
    evs: { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 },
    nature,
    abilitySlot,
    fastMove: moves.fast,
    chargedMove: moves.charged,
  }
}

/** Nome da habilidade na posição; se a espécie não tem 2ª/oculta, cai na 1ª. */
export function resolveAbilityKey(abilities: SpeciesAbilities, slot: AbilitySlot): string {
  if (slot === 'hidden' && abilities.hidden) return abilities.hidden
  if (slot === '2' && abilities.slot2) return abilities.slot2
  return abilities.slot1
}

/**
 * Ao subir de nível o golpe rápido não muda e não há oferta de troca. O
 * carregado só entra se o slot estiver vazio: sorteado entre os carregados que
 * a espécie conhece até o nível novo (PLANNING.md, seção 5.18). O sorteio dá
 * valor ao indivíduo: o mesmo Pokémon com o golpe bom vale mais.
 */
export function learnChargedOnLevelUp(
  rng: Rng,
  input: {
    fromLevel: number
    toLevel: number
    learnset: LearnEntry[]
    moves: Map<string, MoveInfo>
    chargedMove: string | null
  },
): string | null {
  if (input.chargedMove !== null || input.toLevel <= input.fromLevel) return input.chargedMove
  const pool = input.learnset.filter((entry) => {
    const info = input.moves.get(entry.move)
    return entry.level <= input.toLevel && info !== undefined && isChargedMove(info.power)
  })
  if (pool.length === 0) return null
  return pool[Math.floor(rng() * pool.length)]!.move
}

export function canLearnMove(
  learnset: LearnEntry[],
  level: number,
  move: string,
  moves: Map<string, MoveInfo>,
): boolean {
  const info = moves.get(move)
  if (!info) return false
  return learnset.some((entry) => entry.move === move && entry.level <= level)
}

export function moveFitsSlot(power: number, slot: 'fast' | 'charged'): boolean {
  return slot === 'fast' ? isFastMove(power) : isChargedMove(power)
}

/** Próximo carregado que a espécie aprende depois do nível atual. */
export function nextChargedLearn(
  learnset: LearnEntry[],
  level: number,
  moves: Map<string, MoveInfo>,
): LearnEntry | null {
  for (const entry of learnset) {
    if (entry.level <= level) continue
    const info = moves.get(entry.move)
    if (info && isChargedMove(info.power)) return entry
  }
  return null
}

function rollIv(rng: Rng): number {
  return Math.floor(rng() * (traitsConfig.ivMax + 1))
}

function rollAbilitySlot(rng: Rng, abilities: SpeciesAbilities): AbilitySlot {
  if (abilities.hidden && rng() < traitsConfig.hiddenAbilityChance) return 'hidden'
  if (abilities.slot2 && rng() < 0.5) return '2'
  return '1'
}

/**
 * Sorteio dos dois golpes pelas regras da captura: um rápido e, se houver, um
 * carregado entre os que a espécie aprende até o nível. Usado na captura e de
 * novo ao evoluir, com o conjunto da espécie nova (como no Pokémon GO).
 */
export function rollMoves(
  rng: Rng,
  level: number,
  learnset: LearnEntry[],
  moves: Map<string, MoveInfo>,
): { fast: string; charged: string | null } {
  const known = learnset.filter((entry) => entry.level <= level && moves.has(entry.move))
  const fastPool = known.filter((entry) => isFastMove(moves.get(entry.move)!.power))
  const chargedPool = known.filter((entry) => isChargedMove(moves.get(entry.move)!.power))

  let fast: string
  if (fastPool.length > 0) {
    fast = fastPool[Math.floor(rng() * fastPool.length)]!.move
  } else {
    const firstFast = learnset.find((entry) => {
      const info = moves.get(entry.move)
      return info && isFastMove(info.power)
    })
    fast = firstFast?.move ?? 'tackle'
  }

  const charged =
    chargedPool.length > 0 ? chargedPool[Math.floor(rng() * chargedPool.length)]!.move : null

  return { fast, charged }
}
