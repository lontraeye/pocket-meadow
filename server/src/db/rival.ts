// Rival (PLANNING 5.24, parte 3): qual luta está disponível no lugar e o
// prêmio da vitória (uma vez por luta).

import { asc, eq } from 'drizzle-orm'
import { chapterOpen, type Progress } from '../config/milestones.js'
import { rewardLabel } from '../config/rewardNames.js'
import {
  RIVAL_LINE_BY_STARTER,
  type RivalFight,
  rivalFights,
  rivalLineFor,
  rivalTrainerKey,
} from '../config/rival.js'
import { trainerByKey, type TrainerConfig } from '../config/trainers.js'
import { getDb } from './client.js'
import { creditItems } from './inventory.js'
import { pokemon, trainerRivals, trainers } from './schema.js'

/**
 * Inicial do jogador. Conta antiga (sem a coluna): o Pokémon mais antigo dele,
 * se for um dos iniciais; sem isso, null (o rival usa fogo).
 */
export function starterOf(userId: number): number | null {
  const db = getDb()
  const row = db.select({ starter: trainers.starterSpeciesId }).from(trainers).where(eq(trainers.userId, userId)).get()
  if (row?.starter != null) return row.starter
  const first = db
    .select({ speciesId: pokemon.originalSpeciesId })
    .from(pokemon)
    .where(eq(pokemon.userId, userId))
    .orderBy(asc(pokemon.id))
    .limit(1)
    .get()
  return first?.speciesId != null && RIVAL_LINE_BY_STARTER[first.speciesId] ? first.speciesId : null
}

export function clearedRivals(userId: number): Set<string> {
  return new Set(
    getDb()
      .select({ key: trainerRivals.rivalKey })
      .from(trainerRivals)
      .where(eq(trainerRivals.userId, userId))
      .all()
      .map((row) => row.key),
  )
}

/** Por que a luta não dá agora; null = dá. */
export function rivalBlock(
  fight: RivalFight,
  progress: Progress,
  here: string,
  cleared: ReadonlySet<string>,
): 'rival_cleared' | 'rival_locked' | 'rival_not_here' | null {
  if (cleared.has(fight.key)) return 'rival_cleared'
  if (!chapterOpen(fight.chapter, progress)) return 'rival_locked'
  if (here !== fight.place) return 'rival_not_here'
  return null
}

/** O treinador da luta para este jogador (a variação do inicial dele). */
export function rivalTrainerFor(userId: number, fight: RivalFight): TrainerConfig {
  const key = rivalTrainerKey(fight.key, rivalLineFor(starterOf(userId)))
  const trainer = trainerByKey(key)
  if (!trainer) throw new Error(`rival ${key} is missing`)
  return trainer
}

/** A luta do rival disponível no lugar (no máximo uma por lugar), ou undefined. */
export function rivalHere(userId: number, progress: Progress, here: string): RivalFight | undefined {
  const cleared = clearedRivals(userId)
  return rivalFights.find((fight) => rivalBlock(fight, progress, here, cleared) === null)
}

/** Venceu o rival: grava a luta e entrega o prêmio só na primeira vez. */
export function clearRival(userId: number, fight: RivalFight, now: number): { rewards: string[] } {
  const inserted = getDb()
    .insert(trainerRivals)
    .values({ userId, rivalKey: fight.key, clearedAt: now })
    .onConflictDoNothing()
    .run()
  if (inserted.changes !== 1) return { rewards: [] }
  creditItems(userId, [...fight.rewards])
  return { rewards: fight.rewards.map(rewardLabel) }
}
