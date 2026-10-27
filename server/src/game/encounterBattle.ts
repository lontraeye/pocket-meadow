import { mulberry32 } from './mulberry32.js'
import { calcStats, type StatBlock } from './stats.js'
import {
  rollTraits,
  type AbilitySlot,
  type MoveInfo,
  type SpeciesAbilities,
} from './traits.js'
import { buildSimFighter, fighterPowerSum } from './sim/build.js'
import { applyEvYield } from './sim/evs.js'
import { runBattle } from './sim/run.js'
import { battleRngSeed, wildTraitsSeed } from './sim/seeds.js'
import type { BattleInput, BattleResult, BattleSetup, SimFighter } from './sim/types.js'

export type TeamMonRow = {
  id: number
  speciesId: number
  level: number
  type1: string
  type2: string | null
  hp: number
  attack: number
  defense: number
  spAttack: number
  spDefense: number
  speed: number
  ivHp: number
  ivAttack: number
  ivDefense: number
  ivSpAttack: number
  ivSpDefense: number
  ivSpeed: number
  evHp: number
  evAttack: number
  evDefense: number
  evSpAttack: number
  evSpDefense: number
  evSpeed: number
  nature: string
  abilitySlot: AbilitySlot
  fastMove: string
  chargedMove: string | null
}

export type WildSpeciesRow = {
  id: number
  type1: string
  type2: string | null
  hp: number
  attack: number
  defense: number
  spAttack: number
  spDefense: number
  speed: number
  evHp: number
  evAttack: number
  evDefense: number
  evSpAttack: number
  evSpDefense: number
  evSpeed: number
}

export function buildBattleSetup(input: {
  team: TeamMonRow[]
  wild: WildSpeciesRow
  wildLevel: number
  encounterSeed: number
  abilitiesFor: (speciesId: number) => SpeciesAbilities
  learnsetFor: (speciesId: number) => { move: string; level: number }[]
  moves: Map<string, MoveInfo>
}): { setup: BattleSetup; teamFighters: SimFighter[]; powers: number[] } {
  const moves = input.moves
  const teamFighters = input.team.map((mon) =>
    buildSimFighter({
      id: mon.id,
      speciesId: mon.speciesId,
      level: mon.level,
      type1: mon.type1,
      type2: mon.type2,
      base: speciesBase(mon),
      ivs: {
        hp: mon.ivHp,
        attack: mon.ivAttack,
        defense: mon.ivDefense,
        spAttack: mon.ivSpAttack,
        spDefense: mon.ivSpDefense,
        speed: mon.ivSpeed,
      },
      evs: {
        hp: mon.evHp,
        attack: mon.evAttack,
        defense: mon.evDefense,
        spAttack: mon.evSpAttack,
        spDefense: mon.evSpDefense,
        speed: mon.evSpeed,
      },
      nature: mon.nature,
      abilitySlot: mon.abilitySlot,
      abilities: input.abilitiesFor(mon.speciesId),
      fastMove: mon.fastMove,
      chargedMove: mon.chargedMove,
      moves,
    }),
  )

  const wildTraits = rollTraits(mulberry32(wildTraitsSeed(input.encounterSeed)), {
    level: input.wildLevel,
    learnset: input.learnsetFor(input.wild.id),
    abilities: input.abilitiesFor(input.wild.id),
    moves,
  })
  const wildFighter = buildSimFighter({
    id: null,
    speciesId: input.wild.id,
    level: input.wildLevel,
    type1: input.wild.type1,
    type2: input.wild.type2,
    base: speciesBase(input.wild),
    ivs: wildTraits.ivs,
    evs: wildTraits.evs,
    nature: wildTraits.nature,
    abilitySlot: wildTraits.abilitySlot,
    abilities: input.abilitiesFor(input.wild.id),
    fastMove: wildTraits.fastMove,
    chargedMove: wildTraits.chargedMove,
    moves,
  })

  return {
    setup: { team: teamFighters, wild: wildFighter },
    teamFighters,
    powers: teamFighters.map(fighterPowerSum),
  }
}

export function runAutoEncounterBattle(setup: BattleSetup, encounterSeed: number): BattleResult {
  return runBattle({ setup, seed: battleRngSeed(encounterSeed) })
}

export function runManualEncounterBattle(
  setup: BattleSetup,
  encounterSeed: number,
  inputs: BattleInput[],
): BattleResult {
  return runBattle({ setup, seed: battleRngSeed(encounterSeed), inputs })
}

export function evYieldFromSpecies(wild: WildSpeciesRow): StatBlock {
  return {
    hp: wild.evHp,
    attack: wild.evAttack,
    defense: wild.evDefense,
    spAttack: wild.evSpAttack,
    spDefense: wild.evSpDefense,
    speed: wild.evSpeed,
  }
}

export { applyEvYield, fighterPowerSum, calcStats }

function speciesBase(row: {
  hp: number
  attack: number
  defense: number
  spAttack: number
  spDefense: number
  speed: number
}): StatBlock {
  return {
    hp: row.hp,
    attack: row.attack,
    defense: row.defense,
    spAttack: row.spAttack,
    spDefense: row.spDefense,
    speed: row.speed,
  }
}
