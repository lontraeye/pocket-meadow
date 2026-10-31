import type { LeaderFoe } from '../config/leaders.js'
import type { RolledTraits } from './traits.js'

/** Características do Pokémon do líder: fixas, do config (sem sorteio). Sem EVs. */
export function leaderFoeTraits(foe: LeaderFoe): RolledTraits {
  const iv = foe.iv
  return {
    ivs: { hp: iv, attack: iv, defense: iv, spAttack: iv, spDefense: iv, speed: iv },
    evs: { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 },
    nature: foe.nature,
    abilitySlot: foe.abilitySlot,
    fastMove: foe.fastMove,
    chargedMove: foe.chargedMove,
  }
}
