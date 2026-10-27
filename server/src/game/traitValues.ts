import type { RolledTraits } from './traits.js'

/** Campos de traço para insert/update no Drizzle. */
export function traitColumns(traits: RolledTraits) {
  return {
    ivHp: traits.ivs.hp,
    ivAttack: traits.ivs.attack,
    ivDefense: traits.ivs.defense,
    ivSpAttack: traits.ivs.spAttack,
    ivSpDefense: traits.ivs.spDefense,
    ivSpeed: traits.ivs.speed,
    evHp: traits.evs.hp,
    evAttack: traits.evs.attack,
    evDefense: traits.evs.defense,
    evSpAttack: traits.evs.spAttack,
    evSpDefense: traits.evs.spDefense,
    evSpeed: traits.evs.speed,
    nature: traits.nature,
    abilitySlot: traits.abilitySlot,
    fastMove: traits.fastMove,
    chargedMove: traits.chargedMove,
  }
}
