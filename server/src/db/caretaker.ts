import { and, eq, isNotNull } from 'drizzle-orm'
import { caretakerTier } from '../config/daycare.js'
import type { DaycareContext } from '../game/daycare.js'
import { getDb } from './client.js'
import { gardenStructures, pokemon } from './schema.js'

// Cuidador do daycare (PLANNING.md, 5.21): um Pokémon do jardim, fora do time,
// de uma espécie que cuida dos outros, acelera o daycare. Fica na tabela das
// estruturas do jardim (chave `daycare_keeper`, operador = o cuidador).
// Chamar dentro de immediate(), depois do catch-up.

const keeperWhere = (userId: number) =>
  and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, 'daycare_keeper'))

export type CaretakerView = { pokemonId: number; speciesId: number; tier: string; tierName: string; mult: number }

export function caretakerOf(userId: number): CaretakerView | null {
  const row = getDb()
    .select({
      pokemonId: pokemon.id,
      speciesId: pokemon.speciesId,
      location: pokemon.location,
      inPc: pokemon.inPc,
    })
    .from(gardenStructures)
    .innerJoin(pokemon, eq(gardenStructures.operatorPokemonId, pokemon.id))
    .where(keeperWhere(userId))
    .get()
  if (!row || row.location !== 'garden' || row.inPc) return null
  const tier = caretakerTier(row.speciesId)
  if (!tier) return null
  return { pokemonId: row.pokemonId, speciesId: row.speciesId, tier: tier.key, tierName: tier.name, mult: tier.mult }
}

/** A média do time e o bônus do cuidador, para o catch-up do daycare. */
export function daycareContext(userId: number): DaycareContext {
  const levels = getDb()
    .select({ level: pokemon.level })
    .from(pokemon)
    .where(and(eq(pokemon.userId, userId), isNotNull(pokemon.teamSlot)))
    .all()
    .map((row) => row.level)
  return {
    teamAverage: levels.length > 0 ? levels.reduce((sum, level) => sum + level, 0) / levels.length : null,
    caretakerMult: caretakerOf(userId)?.mult ?? 1,
  }
}

export type CaretakerError =
  | 'pokemon_not_found'
  | 'in_daycare'
  | 'in_pc'
  | 'in_team'
  | 'not_caretaker'
  | 'operating'

/** Põe (ou tira, com `null`) o cuidador. */
export function setCaretaker(
  userId: number,
  pokemonId: number | null,
  now: number,
): { ok: true } | { ok: false; error: CaretakerError } {
  const db = getDb()
  if (pokemonId !== null) {
    const mon = db
      .select({ speciesId: pokemon.speciesId, location: pokemon.location, inPc: pokemon.inPc, teamSlot: pokemon.teamSlot })
      .from(pokemon)
      .where(and(eq(pokemon.id, pokemonId), eq(pokemon.userId, userId)))
      .get()
    if (!mon) return { ok: false, error: 'pokemon_not_found' }
    if (mon.location === 'daycare') return { ok: false, error: 'in_daycare' }
    if (mon.inPc) return { ok: false, error: 'in_pc' }
    if (mon.teamSlot !== null) return { ok: false, error: 'in_team' }
    if (!caretakerTier(mon.speciesId)) return { ok: false, error: 'not_caretaker' }
    // Quem opera uma bancada não cuida do daycare ao mesmo tempo.
    const bench = db
      .select({ id: gardenStructures.id })
      .from(gardenStructures)
      .where(
        and(
          eq(gardenStructures.userId, userId),
          eq(gardenStructures.key, 'ball_bench'),
          eq(gardenStructures.operatorPokemonId, pokemonId),
        ),
      )
      .get()
    if (bench) return { ok: false, error: 'operating' }
  }
  const found = db.select({ key: gardenStructures.key }).from(gardenStructures).where(keeperWhere(userId)).get()
  if (found) {
    db.update(gardenStructures).set({ operatorPokemonId: pokemonId }).where(keeperWhere(userId)).run()
  } else {
    db.insert(gardenStructures).values({ userId, key: 'daycare_keeper', since: now, operatorPokemonId: pokemonId }).run()
  }
  return { ok: true }
}
