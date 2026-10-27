import { and, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { asUsername, createPlayer, isStarter, openSession, setSessionCookie } from '../auth/accounts.js'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { trainerConfig } from '../config/trainer.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { berryPlots, daycareSlots, trainers, users } from '../db/schema.js'
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

// Adianta um canteiro: recua planted_at e ready_at. `ready: true` termina o
// crescimento agora; senão, `minutes` (1 a 1440).
devRoutes.post('/plots/advance', requireUser, async (c) => {
  const body = (await readObject(c)) ?? {}
  const plotIndex = body.plotIndex
  if (typeof plotIndex !== 'number' || !Number.isInteger(plotIndex) || plotIndex < 0) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const ready = body.ready === true
  const minutes = body.minutes
  if (!ready && (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const userId = c.get('userId')
  const now = Date.now()
  const found = immediate(() => {
    persistCatchUp(userId, now)
    const db = getDb()
    const where = and(eq(berryPlots.userId, userId), eq(berryPlots.plotIndex, plotIndex))
    const plot = db.select({ readyAt: berryPlots.readyAt }).from(berryPlots).where(where).get()
    if (!plot) return false
    const shift = ready ? Math.max(0, plot.readyAt - now) : (minutes as number) * 60 * 1000
    db.update(berryPlots)
      .set({
        plantedAt: sql`${berryPlots.plantedAt} - ${shift}`,
        readyAt: sql`${berryPlots.readyAt} - ${shift}`,
      })
      .where(where)
      .run()
    return true
  })
  if (!found) return c.json({ error: 'plot_empty' }, 404)
  return c.json({ plotIndex })
})
