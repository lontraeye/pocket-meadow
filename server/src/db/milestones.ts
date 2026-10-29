import { eq } from 'drizzle-orm'
import type { Progress } from '../config/milestones.js'
import { getDb } from './client.js'
import { trainerMilestones } from './schema.js'

/** Marcos conquistados + nível: o que decide capítulos, áreas e ferramentas. */
export function loadProgress(userId: number, level: number): Progress {
  const cleared = new Set(
    getDb()
      .select({ key: trainerMilestones.milestoneKey })
      .from(trainerMilestones)
      .where(eq(trainerMilestones.userId, userId))
      .all()
      .map((row) => row.key),
  )
  return { level, cleared }
}
