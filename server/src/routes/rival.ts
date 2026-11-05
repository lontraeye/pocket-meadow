import { SqliteError } from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { rivalFightByKey } from '../config/rival.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { loadProgress } from '../db/milestones.js'
import { clearedRivals, rivalBlock, rivalTrainerFor } from '../db/rival.js'
import { encounters } from '../db/schema.js'
import { createTrainerEncounter } from './encounters.js'
import { fail } from './http.js'
import { currentPlaceOf } from './places.js'

// Rival (PLANNING 5.24, parte 3): no lugar da luta, com o capítulo aberto,
// abre o encontro contra o time dele (sem energia, sem captura). Não trava
// o marco; vencer dá o prêmio uma vez.

export const rivalRoutes = new Hono<AuthEnv>()

rivalRoutes.post('/:key/challenge', requireUser, (c) => {
  const userId = c.get('userId')
  const key = c.req.param('key')
  const now = Date.now()
  try {
    const result = immediate(() => startRival(userId, key, now))
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json(result.encounter, 201)
  } catch (error) {
    if (error instanceof SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'encounter_pending' }, 409)
    }
    throw error
  }
})

function startRival(userId: number, key: string, now: number) {
  const clock = persistCatchUp(userId, now)
  const progress = loadProgress(userId, clock.level)
  const fight = rivalFightByKey(key)
  if (!fight) return fail('rival_not_found', 404)
  const here = currentPlaceOf(userId)
  const block = rivalBlock(fight, progress, here, clearedRivals(userId))
  if (block) return fail(block, block === 'rival_cleared' ? 409 : 400)
  const pending = getDb()
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
  if (pending) return fail('encounter_pending', 409)
  return { ok: true as const, encounter: createTrainerEncounter(userId, rivalTrainerFor(userId, fight), here, now) }
}
