import { and, eq, isNotNull } from 'drizzle-orm'
import { type GardenUnlocks, gardenUnlocks } from '../config/gardenUnlocks.js'
import type { Progress } from '../config/milestones.js'
import { getDb } from './client.js'
import { pokemon, species, trainerMilestones } from './schema.js'

/** As chaves dos marcos conquistados. */
export function clearedMilestones(userId: number): Set<string> {
  return new Set(
    getDb()
      .select({ key: trainerMilestones.milestoneKey })
      .from(trainerMilestones)
      .where(eq(trainerMilestones.userId, userId))
      .all()
      .map((row) => row.key),
  )
}

/** O que os marcos abriram no jardim (PROGRESSAO.md 4.3). */
export function gardenUnlocksOf(userId: number): GardenUnlocks {
  return gardenUnlocks(clearedMilestones(userId))
}

/** Marcos conquistados, nível e tipos do time: o que decide capítulos, áreas e ferramentas. */
export function loadProgress(userId: number, level: number): Progress {
  const db = getDb()
  const cleared = clearedMilestones(userId)
  const teamTypes = new Set<string>()
  const team = db
    .select({ type1: species.type1, type2: species.type2 })
    .from(pokemon)
    .innerJoin(species, eq(species.id, pokemon.speciesId))
    .where(and(eq(pokemon.userId, userId), isNotNull(pokemon.teamSlot)))
    .all()
  for (const row of team) {
    teamTypes.add(row.type1)
    if (row.type2) teamTypes.add(row.type2)
  }
  return { level, cleared, teamTypes }
}
