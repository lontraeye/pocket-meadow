import type Database from 'better-sqlite3'
import { abilitiesFor, learnsetFor, movesByName } from '../seed/traitsData.js'
import { mulberry32 } from '../game/rng.js'
import { rollTraits, traitsRngSeed } from '../game/traits.js'

type Row = {
  id: number
  species_id: number
  level: number
  iv_hp: number | null
  iv_attack: number | null
  iv_defense: number | null
  iv_sp_attack: number | null
  iv_sp_defense: number | null
  iv_speed: number | null
  nature: string | null
  ability_slot: string | null
  fast_move: string | null
  charged_move: string | null
}

/**
 * Preenche só colunas NULL (coalesce). Nunca mexe em EVs.
 * charged_move NULL é válido ("ainda não aprendeu") — critério é IVs/nature.
 */
export function backfillPokemonTraits(sqlite: Database.Database): number {
  const pending = sqlite
    .prepare(
      `select p.id, p.species_id, p.level,
              p.iv_hp, p.iv_attack, p.iv_defense, p.iv_sp_attack, p.iv_sp_defense, p.iv_speed,
              p.nature, p.ability_slot, p.fast_move, p.charged_move
       from pokemon p
       where p.nature is null
          or p.ability_slot is null
          or p.fast_move is null
          or p.iv_hp is null
          or p.iv_attack is null
          or p.iv_defense is null
          or p.iv_sp_attack is null
          or p.iv_sp_defense is null
          or p.iv_speed is null`,
    )
    .all() as Row[]

  if (pending.length === 0) return 0

  const moves = movesByName()
  const update = sqlite.prepare(
    `update pokemon set
      iv_hp = coalesce(iv_hp, ?),
      iv_attack = coalesce(iv_attack, ?),
      iv_defense = coalesce(iv_defense, ?),
      iv_sp_attack = coalesce(iv_sp_attack, ?),
      iv_sp_defense = coalesce(iv_sp_defense, ?),
      iv_speed = coalesce(iv_speed, ?),
      nature = coalesce(nature, ?),
      ability_slot = coalesce(ability_slot, ?),
      fast_move = coalesce(fast_move, ?),
      -- charged NULL é válido; só preenche na primeira vez (ainda sem IVs).
      charged_move = case when iv_hp is null then coalesce(charged_move, ?) else charged_move end
     where id = ?`,
  )

  const write = sqlite.transaction(() => {
    for (const row of pending) {
      const traits = rollTraits(mulberry32(traitsRngSeed(row.id)), {
        level: row.level,
        learnset: learnsetFor(row.species_id),
        abilities: abilitiesFor(row.species_id),
        moves,
      })
      // Só sorteia charged se o Pokémon ainda estava sem traços (nature/IVs NULL).
      // Se já tinha golpes e só faltava nature, charged_move permanece (mesmo NULL).
      update.run(
        traits.ivs.hp,
        traits.ivs.attack,
        traits.ivs.defense,
        traits.ivs.spAttack,
        traits.ivs.spDefense,
        traits.ivs.speed,
        traits.nature,
        traits.abilitySlot,
        traits.fastMove,
        traits.chargedMove,
        row.id,
      )
    }
  })
  write.immediate()
  return pending.length
}
