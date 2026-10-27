import { isPokemonType } from '../../config/types.js'
import type { BattleSetup, SimFighter, SimMove } from './types.js'

/** Forma serializada do setup (POST start / coluna battle_setup_json). */
export type SerializedBattleSetup = {
  team: SerializedFighter[]
  wild: SerializedFighter
}

export type SerializedFighter = {
  id: number | null
  speciesId: number
  level: number
  types: string[]
  stats: SimFighter['stats']
  fastMove: SimMove
  chargedMove: SimMove | null
  abilityKey: string
}

export function serializeBattleSetup(setup: BattleSetup): SerializedBattleSetup {
  return {
    team: setup.team.map(serializeFighter),
    wild: serializeFighter(setup.wild),
  }
}

export function parseBattleSetup(json: string): BattleSetup {
  const raw = JSON.parse(json) as SerializedBattleSetup
  if (!raw || !Array.isArray(raw.team) || raw.team.length < 1 || raw.team.length > 3 || !raw.wild) {
    throw new Error('invalid_battle_setup')
  }
  return {
    team: raw.team.map(parseFighter),
    wild: parseFighter(raw.wild),
  }
}

function serializeFighter(fighter: SimFighter): SerializedFighter {
  return {
    id: fighter.id,
    speciesId: fighter.speciesId,
    level: fighter.level,
    types: [...fighter.types],
    stats: { ...fighter.stats },
    fastMove: { ...fighter.fastMove },
    chargedMove: fighter.chargedMove ? { ...fighter.chargedMove } : null,
    abilityKey: fighter.abilityKey,
  }
}

function parseFighter(raw: SerializedFighter): SimFighter {
  if (!raw || typeof raw.speciesId !== 'number' || typeof raw.level !== 'number') {
    throw new Error('invalid_battle_setup')
  }
  const types = parseTypes(raw.types)
  return {
    id: raw.id ?? null,
    speciesId: raw.speciesId,
    level: raw.level,
    types,
    stats: { ...raw.stats },
    fastMove: parseMove(raw.fastMove),
    chargedMove: raw.chargedMove ? parseMove(raw.chargedMove) : null,
    abilityKey: typeof raw.abilityKey === 'string' ? raw.abilityKey : 'none',
  }
}

function parseTypes(types: string[]): SimFighter['types'] {
  if (!Array.isArray(types) || types.length < 1 || types.length > 2) {
    throw new Error('invalid_battle_setup')
  }
  const t0 = types[0]!
  if (!isPokemonType(t0)) throw new Error('invalid_battle_setup')
  if (types.length === 1) return [t0]
  const t1 = types[1]!
  if (!isPokemonType(t1)) throw new Error('invalid_battle_setup')
  return [t0, t1]
}

function parseMove(raw: SimMove): SimMove {
  if (!raw || !isPokemonType(raw.type) || typeof raw.power !== 'number') {
    throw new Error('invalid_battle_setup')
  }
  return {
    name: raw.name,
    type: raw.type,
    power: raw.power,
    damageClass: raw.damageClass === 'special' ? 'special' : 'physical',
  }
}
