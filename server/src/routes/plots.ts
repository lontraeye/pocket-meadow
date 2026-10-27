import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { getBerry, plotSlotsUnlocked, seedKey } from '../config/berries.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { creditItems, debitItem } from '../db/inventory.js'
import { berryPlots } from '../db/schema.js'
import { planHarvest, planUproot } from '../game/berries.js'
import { unitRoll } from '../game/rng.js'
import { type Failure, fail, parseSlot, readObject } from './http.js'

type Ok<T> = { ok: true } & T

export const plotRoutes = new Hono<AuthEnv>()

plotRoutes.post('/:index/plant', requireUser, async (c) => {
  const plotIndex = parseSlot(c.req.param('index'))
  if (plotIndex === null) return c.json({ error: 'invalid_body' }, 400)
  const body = await readObject(c)
  if (!body || typeof body.berryKey !== 'string') return c.json({ error: 'invalid_body' }, 400)
  const berryKey = body.berryKey
  const result = immediate(() => plant(c.get('userId'), plotIndex, berryKey, Date.now()))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.planted)
})

plotRoutes.post('/:index/harvest', requireUser, (c) => {
  const plotIndex = parseSlot(c.req.param('index'))
  if (plotIndex === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => harvest(c.get('userId'), plotIndex, Date.now()))
  if (!result.ok) {
    return c.json(
      { error: result.error, ...(result.readyAt !== undefined ? { readyAt: result.readyAt } : {}) },
      result.status,
    )
  }
  return c.json(result.harvested)
})

plotRoutes.post('/:index/uproot', requireUser, (c) => {
  const plotIndex = parseSlot(c.req.param('index'))
  if (plotIndex === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => uproot(c.get('userId'), plotIndex, Date.now()))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.uprooted)
})

function plant(
  userId: number,
  plotIndex: number,
  berryKey: string,
  now: number,
): Ok<{ planted: { plotIndex: number; berryKey: string; plantedAt: number; readyAt: number } }> | Failure {
  const clock = persistCatchUp(userId, now)
  const unlocked = plotSlotsUnlocked(clock.level)
  if (plotIndex < 0 || plotIndex >= unlocked) return fail('plot_locked', 400)

  const berry = getBerry(berryKey)
  if (!berry) return fail('unknown_berry', 400)

  const db = getDb()
  const taken = db
    .select({ berryKey: berryPlots.berryKey })
    .from(berryPlots)
    .where(and(eq(berryPlots.userId, userId), eq(berryPlots.plotIndex, plotIndex)))
    .get()
  if (taken) return fail('plot_taken', 400)

  if (!debitItem(userId, seedKey(berry.key), 1)) return fail('no_seed', 400)

  const readyAt = now + berry.growMs
  db.insert(berryPlots)
    .values({ userId, plotIndex, berryKey: berry.key, plantedAt: now, readyAt })
    .run()

  return {
    ok: true,
    planted: { plotIndex, berryKey: berry.key, plantedAt: now, readyAt },
  }
}

function harvest(
  userId: number,
  plotIndex: number,
  now: number,
): Ok<{
  harvested: {
    plotIndex: number
    berryKey: string
    berries: number
    seeds: number
    credits: { itemKey: string; quantity: number }[]
  }
}> | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const plot = db
    .select()
    .from(berryPlots)
    .where(and(eq(berryPlots.userId, userId), eq(berryPlots.plotIndex, plotIndex)))
    .get()
  if (!plot) return fail('plot_empty', 404)

  if (now < plot.readyAt) return fail('not_ready', 400, { readyAt: plot.readyAt })

  const berry = getBerry(plot.berryKey)
  if (!berry) throw new Error(`unknown berry planted: ${plot.berryKey}`)

  const plan = planHarvest(berry, { yieldUnit: unitRoll(), extraSeed: unitRoll() })
  db.delete(berryPlots)
    .where(and(eq(berryPlots.userId, userId), eq(berryPlots.plotIndex, plotIndex)))
    .run()
  creditItems(userId, plan.credits)

  return {
    ok: true,
    harvested: {
      plotIndex,
      berryKey: plan.berryKey,
      berries: plan.berryAmount,
      seeds: plan.seedAmount,
      credits: plan.credits,
    },
  }
}

// Pronta não se arranca: o caminho é colher, para não perder a colheita.
function uproot(
  userId: number,
  plotIndex: number,
  now: number,
): Ok<{ uprooted: { plotIndex: number; berryKey: string; seedReturned: boolean } }> | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const plot = db
    .select()
    .from(berryPlots)
    .where(and(eq(berryPlots.userId, userId), eq(berryPlots.plotIndex, plotIndex)))
    .get()
  if (!plot) return fail('plot_empty', 404)
  if (now >= plot.readyAt) return fail('already_ready', 400)

  const plan = planUproot(plot.berryKey, unitRoll())
  db.delete(berryPlots)
    .where(and(eq(berryPlots.userId, userId), eq(berryPlots.plotIndex, plotIndex)))
    .run()
  creditItems(userId, plan.credits)

  return { ok: true, uprooted: { plotIndex, berryKey: plot.berryKey, seedReturned: plan.seedReturned } }
}
