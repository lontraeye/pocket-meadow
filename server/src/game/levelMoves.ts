import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { pokemon } from '../db/schema.js'
import { learnsetFor, movesByName } from '../seed/traitsData.js'
import { mulberry32, randomSeed } from './rng.js'
import { learnChargedOnLevelUp, rollMoves, type MoveInfo } from './traits.js'

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
 * um carregado, ele entra sorteado e é gravado. Devolve o golpe aprendido.
 */
export function applyLevelMovesToPokemon(input: {
  userId: number
  pokemonId: number
  speciesId: number
  fromLevel: number
  toLevel: number
  chargedMove: string | null
}): { chargedMove: string | null; learned: MoveView | null } {
  const moves = movesByName()
  const charged = learnChargedOnLevelUp(oneShotRng(), {
    fromLevel: input.fromLevel,
    toLevel: input.toLevel,
    learnset: learnsetFor(input.speciesId),
    moves,
    chargedMove: input.chargedMove,
  })
  if (charged === input.chargedMove) return { chargedMove: charged, learned: null }
  getDb()
    .update(pokemon)
    .set({ chargedMove: charged })
    .where(and(eq(pokemon.id, input.pokemonId), eq(pokemon.userId, input.userId)))
    .run()
  return { chargedMove: charged, learned: charged === null ? null : moveView(charged, moves) }
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
    .set({ fastMove: rolled.fast, chargedMove: rolled.charged })
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
