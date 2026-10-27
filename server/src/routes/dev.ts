import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { trainerConfig } from '../config/trainer.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { trainers } from '../db/schema.js'

// Ferramentas de teste. Só existem com DEV_TOOLS=1 e fora de produção;
// na VM (NODE_ENV=production) a rota nem é registrada.
export function devToolsEnabled(): boolean {
  return process.env.DEV_TOOLS === '1' && process.env.NODE_ENV !== 'production'
}

export const devRoutes = new Hono<AuthEnv>()

devRoutes.post('/energy', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  immediate(() => {
    persistCatchUp(userId, now)
    getDb()
      .update(trainers)
      .set({ energy: trainerConfig.energyMax, energyUpdatedAt: now, updatedAt: now })
      .where(eq(trainers.userId, userId))
      .run()
  })
  return c.json({ energy: trainerConfig.energyMax })
})
