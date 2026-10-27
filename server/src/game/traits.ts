import { natures } from '../config/natures.js'
import { traitsConfig } from '../config/traits.js'
import type { Rng } from './mulberry32.js'
import type { StatBlock } from './stats.js'

export type AbilitySlot = '1' | '2' | 'hidden'

export type MoveInfo = {
  name: string
  displayName: string
  type: string
  power: number
  damageClass: 'physical' | 'special'
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
  const moves = pickMoves(rng, input.level, input.learnset, input.moves)
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

export function movesLearnedBetween(
  learnset: LearnEntry[],
  fromLevel: number,
  toLevel: number,
  moves: Map<string, MoveInfo>,
): LearnEntry[] {
  if (toLevel <= fromLevel) return []
  return learnset.filter(
    (entry) => entry.level > fromLevel && entry.level <= toLevel && moves.has(entry.move),
  )
}

/**
 * Golpes aprendidos ao subir de nível (ou ao evoluir com fromLevel 0).
 * Carregado com slot vazio → entra direto (primeiro por nível); o resto vira oferta.
 */
export function applyLearnedMoves(input: {
  fromLevel: number
  toLevel: number
  learnset: LearnEntry[]
  moves: Map<string, MoveInfo>
  fastMove: string
  chargedMove: string | null
}): { chargedMove: string | null; offers: LearnEntry[] } {
  const learned = movesLearnedBetween(input.learnset, input.fromLevel, input.toLevel, input.moves)
  let charged = input.chargedMove
  const offers: LearnEntry[] = []
  for (const entry of learned) {
    const info = input.moves.get(entry.move)
    if (!info) continue
    if (isChargedMove(info.power) && charged === null) {
      charged = entry.move
      continue
    }
    if (entry.move === input.fastMove || entry.move === charged) continue
    offers.push(entry)
  }
  return { chargedMove: charged, offers }
}

/** Ofertas de destaque a partir do estado já atualizado (ex.: após catch-up do daycare). */
export function moveLearnOffers(input: {
  fromLevel: number
  toLevel: number
  learnset: LearnEntry[]
  moves: Map<string, MoveInfo>
  fastMove: string
  chargedMove: string | null
}): LearnEntry[] {
  return movesLearnedBetween(input.learnset, input.fromLevel, input.toLevel, input.moves).filter(
    (entry) => entry.move !== input.fastMove && entry.move !== input.chargedMove,
  )
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

function pickMoves(
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
