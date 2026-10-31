import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { pokemon } from '../db/schema.js'
import { learnsetFor, movesByName } from '../seed/traitsData.js'
import { mulberry32, randomSeed } from './rng.js'
import {
  isFastMove,
  learnChargedOnLevelUp,
  pickWeightedMove,
  rerollCandidates,
  rollLevelOffer,
  rollMoves,
  type MoveInfo,
  type MoveSlot,
} from './traits.js'

// Mesmo formato do `MoveView` do front (web/src/lib/api.ts).
export type MoveView = {
  name: string
  displayName: string
  power: number
  type: string
  damageClass: 'physical' | 'special'
}

// Os sorteios daqui são ações únicas dentro de uma transação, sem replay:
// usam `crypto`, como a colheita (PLANNING.md, seção 5.10).
function oneShotRng() {
  return mulberry32(randomSeed())
}

/**
 * Ao subir de nível: se o slot de carregado estava vazio e a espécie já conhece
 * um carregado, ele entra sorteado e é gravado. Depois, se não há oferta
 * pendente, a chance de oferecer um golpe novo (aprender ou manter na ficha).
 * Devolve o golpe aprendido e o oferecido.
 */
export function applyLevelMovesToPokemon(input: {
  userId: number
  pokemonId: number
  speciesId: number
  fromLevel: number
  toLevel: number
  chargedMove: string | null
}): { chargedMove: string | null; learned: MoveView | null; offered: MoveView | null } {
  const moves = movesByName()
  const learnset = learnsetFor(input.speciesId)
  const rng = oneShotRng()
  const charged = learnChargedOnLevelUp(rng, {
    fromLevel: input.fromLevel,
    toLevel: input.toLevel,
    learnset,
    moves,
    chargedMove: input.chargedMove,
  })
  const db = getDb()
  const where = and(eq(pokemon.id, input.pokemonId), eq(pokemon.userId, input.userId))
  const learned = charged !== input.chargedMove && charged !== null ? moveView(charged, moves) : null
  if (charged !== input.chargedMove) db.update(pokemon).set({ chargedMove: charged }).where(where).run()

  const row = db.select({ fastMove: pokemon.fastMove, moveOffer: pokemon.moveOffer }).from(pokemon).where(where).get()
  let offered: MoveView | null = null
  if (row?.fastMove && row.moveOffer === null) {
    const offer = rollLevelOffer(rng, {
      fromLevel: input.fromLevel,
      toLevel: input.toLevel,
      learnset,
      moves,
      fastMove: row.fastMove,
      chargedMove: charged,
    })
    if (offer) {
      db.update(pokemon).set({ moveOffer: offer.name }).where(where).run()
      offered = moveView(offer.name, moves)
    }
  }
  return { chargedMove: charged, learned, offered }
}

/** O slot do golpe pelo poder dele (rápido até 55). */
export function slotOfMove(move: string): MoveSlot {
  return isFastMove(movesByName().get(move)?.power ?? 0) ? 'fast' : 'charged'
}

/** Sorteio pago com doce: só entre golpes iguais ou mais fortes que o atual. */
export function rerollMove(input: {
  speciesId: number
  level: number
  slot: MoveSlot
  current: string | null
}): MoveView | null {
  const moves = movesByName()
  const pool = rerollCandidates(learnsetFor(input.speciesId), input.level, moves, input.slot, input.current)
  const pick = pickWeightedMove(oneShotRng(), pool)
  return pick ? moveView(pick.name, moves) : null
}

/** Ao evoluir: os dois golpes são sorteados de novo pelo conjunto da espécie nova. */
export function rerollMovesOnEvolve(input: {
  userId: number
  pokemonId: number
  speciesId: number
  level: number
}): { fast: MoveView | null; charged: MoveView | null } {
  const moves = movesByName()
  const rolled = rollMoves(oneShotRng(), input.level, learnsetFor(input.speciesId), moves)
  getDb()
    .update(pokemon)
    // A oferta era da espécie antiga: some junto.
    .set({ fastMove: rolled.fast, chargedMove: rolled.charged, moveOffer: null })
    .where(and(eq(pokemon.id, input.pokemonId), eq(pokemon.userId, input.userId)))
    .run()
  return {
    fast: moveView(rolled.fast, moves),
    charged: rolled.charged === null ? null : moveView(rolled.charged, moves),
  }
}

function moveView(move: string, moves: Map<string, MoveInfo>): MoveView | null {
  const info = moves.get(move)
  if (!info) return null
  return { name: move, displayName: info.displayName, power: info.power, type: info.type, damageClass: info.damageClass }
}
