import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { getDb, immediate } from '../db/client.js'
import { trainers } from '../db/schema.js'
import { readObject } from './http.js'

export const trainerRoutes = new Hono<AuthEnv>()

/** Preferências do treinador (8.5): hoje só o interruptor Auto da luta. */
trainerRoutes.put('/prefs', requireUser, async (c) => {
  const body = await readObject(c)
  if (!body || !isPrefsBody(body)) return c.json({ error: 'invalid_body' }, 400)

  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => {
    const updated = getDb()
      .update(trainers)
      .set({ battleAuto: body.battleAuto, updatedAt: now })
      .where(eq(trainers.userId, userId))
      .run()
    if (updated.changes !== 1) throw new Error(`trainer missing for user ${userId}`)
    return { battleAuto: body.battleAuto }
  })
  return c.json(result)
})

function isPrefsBody(body: Record<string, unknown>): body is { battleAuto: boolean } {
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'battleAuto') return false
  return typeof body.battleAuto === 'boolean'
}
