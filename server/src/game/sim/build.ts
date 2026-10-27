import { isPokemonType, type PokemonType } from '../../config/types.js'
import { calcStats, type StatBlock } from '../stats.js'
import { resolveAbilityKey, type AbilitySlot, type MoveInfo } from '../traits.js'
import type { SpeciesAbilities } from '../traits.js'
import { emptyMoveEffects } from './effects.js'
import type { SimFighter, SimMove } from './types.js'

export type FighterSources = {
  id: number | null
  speciesId: number
  level: number
  type1: string
  type2: string | null
  base: StatBlock
  ivs: StatBlock
  evs: StatBlock
  nature: string
  abilitySlot: AbilitySlot
  abilities: SpeciesAbilities
  fastMove: string
  chargedMove: string | null
  moves: Map<string, MoveInfo>
}

export function buildSimFighter(source: FighterSources): SimFighter {
  const types = resolveTypes(source.type1, source.type2)
  const stats = calcStats({
    base: source.base,
    ivs: source.ivs,
    evs: source.evs,
    level: source.level,
    nature: source.nature,
  })
  const fast = toSimMove(source.moves.get(source.fastMove), source.fastMove)
  const charged = source.chargedMove
    ? toSimMove(source.moves.get(source.chargedMove), source.chargedMove)
    : null
  return {
    id: source.id,
    speciesId: source.speciesId,
    level: source.level,
    types,
    stats,
    fastMove: fast,
    chargedMove: charged,
    abilityKey: resolveAbilityKey(source.abilities, source.abilitySlot),
  }
}

/** Soma dos atributos finais — valor guardado em encounter_fighters.power. */
export function fighterPowerSum(fighter: SimFighter): number {
  const s = fighter.stats
  return s.hp + s.attack + s.defense + s.spAttack + s.spDefense + s.speed
}

function resolveTypes(
  type1: string,
  type2: string | null,
): readonly [PokemonType] | readonly [PokemonType, PokemonType] {
  if (!isPokemonType(type1)) throw new Error(`unknown type ${type1}`)
  if (type2 && isPokemonType(type2) && type2 !== type1) return [type1, type2]
  return [type1]
}

export function toSimMove(info: MoveInfo | undefined, name: string): SimMove {
  if (!info) throw new Error(`unknown move ${name}`)
  if (!isPokemonType(info.type)) throw new Error(`unknown move type ${info.type}`)
  return {
    name: info.name,
    type: info.type,
    power: info.power,
    damageClass: info.damageClass,
    ailment: info.ailment ?? emptyMoveEffects.ailment,
    ailmentChance: info.ailmentChance ?? emptyMoveEffects.ailmentChance,
    statChanges: info.statChanges ? [...info.statChanges] : [],
    statChance: info.statChance ?? emptyMoveEffects.statChance,
    statOnSelf: info.statOnSelf ?? emptyMoveEffects.statOnSelf,
    drain: info.drain ?? emptyMoveEffects.drain,
    critRate: info.critRate ?? emptyMoveEffects.critRate,
  }
}
