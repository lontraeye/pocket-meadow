import { SqliteError } from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { leaderByMilestone } from '../config/leaders.js'
import { chapterOpen, milestoneByKey } from '../config/milestones.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { loadProgress } from '../db/milestones.js'
import { encounters } from '../db/schema.js'
import { createLeaderEncounter } from './encounters.js'
import { fail } from './http.js'
import { currentPlaceOf } from './places.js'

// Desafio do líder (JORNADA.md, seção 9, parte 6; config/leaders.ts): na cidade
// do marco, com o nível de treinador, abre o encontro contra o time todo do
// líder (uma luta contínua, sem captura). A vitória dá o marco.

export const leaderRoutes = new Hono<AuthEnv>()

leaderRoutes.post('/:key/challenge', requireUser, (c) => {
  const userId = c.get('userId')
  const key = c.req.param('key')
  const now = Date.now()
  try {
    const result = immediate(() => startChallenge(userId, key, now))
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json(result.encounter, 201)
  } catch (error) {
    if (error instanceof SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'encounter_pending' }, 409)
    }
    throw error
  }
})

function startChallenge(userId: number, key: string, now: number) {
  const clock = persistCatchUp(userId, now)
  const progress = loadProgress(userId, clock.level)
  const milestone = milestoneByKey(key)
  const leader = leaderByMilestone(key)
  if (!milestone || !leader) return fail('milestone_not_found', 404)
  if (progress.cleared.has(key)) return fail('milestone_cleared', 409)
  if (!chapterOpen(milestone.chapter, progress)) return fail('milestone_locked', 400)
  if (currentPlaceOf(userId) !== milestone.town) return fail('milestone_not_here', 400)
  if (clock.level < milestone.minLevel) return fail('milestone_level', 400)
  const pending = getDb()
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
  if (pending) return fail('encounter_pending', 409)
  return { ok: true as const, encounter: createLeaderEncounter(userId, leader, now) }
}
