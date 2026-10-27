import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { trainerConfig } from '../config/trainer.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { daycareSlots, trainers } from '../db/schema.js'
import { readObject } from './http.js'

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

// Simula o tempo passando no daycare: recua entered_at e last_settled_at do
// jogador e liquida de novo. Liquida antes também, para as horas reais que já
// passaram entrarem com o nível certo.
devRoutes.post('/daycare/advance', requireUser, async (c) => {
  const body = (await readObject(c)) ?? {}
  const hours = body.hours === undefined ? 1 : body.hours
  if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 24) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const userId = c.get('userId')
  const now = Date.now()
  const shift = hours * 60 * 60 * 1000
  immediate(() => {
    persistCatchUp(userId, now)
    getDb()
      .update(daycareSlots)
      .set({
        enteredAt: sql`${daycareSlots.enteredAt} - ${shift}`,
        lastSettledAt: sql`${daycareSlots.lastSettledAt} - ${shift}`,
      })
      .where(eq(daycareSlots.userId, userId))
      .run()
    persistCatchUp(userId, now)
  })
  return c.json({ hours })
})
