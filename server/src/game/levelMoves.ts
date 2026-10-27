import { and, eq } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { pokemon } from '../db/schema.js'
import { learnsetFor, movesByName } from '../seed/traitsData.js'
import {
  applyLearnedMoves,
  moveLearnOffers,
  type LearnEntry,
  type MoveInfo,
} from './traits.js'

export type MoveOfferView = {
  move: string
  level: number
  displayName: string
  power: number
  type: string
  damageClass: 'physical' | 'special'
}

/** Aplica golpes ao subir de nível e grava o carregado se o slot estava vazio. */
export function applyLevelMovesToPokemon(input: {
  userId: number
  pokemonId: number
  speciesId: number
  fromLevel: number
  toLevel: number
  fastMove: string
  chargedMove: string | null
}): { chargedMove: string | null; offers: MoveOfferView[] } {
  if (input.toLevel <= input.fromLevel) {
    return { chargedMove: input.chargedMove, offers: [] }
  }
  const moves = movesByName()
  const learnset = learnsetFor(input.speciesId)
  const result = applyLearnedMoves({
    fromLevel: input.fromLevel,
    toLevel: input.toLevel,
    learnset,
    moves,
    fastMove: input.fastMove,
    chargedMove: input.chargedMove,
  })
  if (result.chargedMove !== input.chargedMove) {
    getDb()
      .update(pokemon)
      .set({ chargedMove: result.chargedMove })
      .where(and(eq(pokemon.id, input.pokemonId), eq(pokemon.userId, input.userId)))
      .run()
  }
  return {
    chargedMove: result.chargedMove,
    offers: toOfferViews(result.offers, moves),
  }
}

/** Ofertas a partir do estado já persistido (daycare após catch-up). */
export function offersForLevelRange(input: {
  speciesId: number
  fromLevel: number
  toLevel: number
  fastMove: string
  chargedMove: string | null
}): MoveOfferView[] {
  if (input.toLevel <= input.fromLevel) return []
  const moves = movesByName()
  return toOfferViews(
    moveLearnOffers({
      fromLevel: input.fromLevel,
      toLevel: input.toLevel,
      learnset: learnsetFor(input.speciesId),
      moves,
      fastMove: input.fastMove,
      chargedMove: input.chargedMove,
    }),
    moves,
  )
}

function toOfferViews(entries: LearnEntry[], moves: Map<string, MoveInfo>): MoveOfferView[] {
  return entries.flatMap((entry) => {
    const info = moves.get(entry.move)
    if (!info) return []
    return [
      {
        move: entry.move,
        level: entry.level,
        displayName: info.displayName,
        power: info.power,
        type: info.type,
        damageClass: info.damageClass,
      },
    ]
  })
}
