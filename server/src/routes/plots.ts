import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { FIRST_GROWTH_MULT, bushDeathChance, getBerry, plotSlotsUnlocked, seedKey } from '../config/berries.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { recordEvent } from '../db/events.js'
import { creditItems, debitItem } from '../db/inventory.js'
import { loadWeather } from '../db/weather.js'
import { berryPlots } from '../db/schema.js'
import { planClear, planHarvest, planUproot } from '../game/berries.js'
import { growMsFor } from '../game/weather.js'
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
): Ok<{
  planted: { plotIndex: number; berryKey: string; plantedAt: number; readyAt: number; weatherBoost: boolean }
}> | Failure {
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

  // Clima favorito da berry no dia do plantio: cresce mais rápido. Decidido
  // aqui e gravado no readyAt, então não muda se o clima virar no meio.
  const weather = loadWeather(userId, now).key
  // Primeiro crescimento: semente, muda e arbusto antes dos primeiros frutos.
  const readyAt = now + growMsFor(berry.growMs * FIRST_GROWTH_MULT, berry.favoriteWeather, weather)
  db.insert(berryPlots)
    .values({ userId, plotIndex, berryKey: berry.key, plantedAt: now, readyAt })
    .run()

  return {
    ok: true,
    planted: { plotIndex, berryKey: berry.key, plantedAt: now, readyAt, weatherBoost: berry.favoriteWeather === weather },
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
    credits: { itemKey: string; quantity: number }[]
    /** O arbusto secou depois desta colheita: não frutifica mais, só se limpa. */
    died: boolean
    readyAt: number
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
  if (plot.deadAt !== null) return fail('bush_dead', 400)

  if (now < plot.readyAt) return fail('not_ready', 400, { readyAt: plot.readyAt })

  const berry = getBerry(plot.berryKey)
  if (!berry) throw new Error(`unknown berry planted: ${plot.berryKey}`)

  const plan = planHarvest(berry, { yieldUnit: unitRoll() })
  // O arbusto fica e frutifica de novo no tempo da berry (com o clima de hoje),
  // a menos que seque: a chance cresce a cada colheita depois das garantidas.
  const harvests = plot.harvests + 1
  const died = unitRoll() < bushDeathChance(harvests)
  const weather = loadWeather(userId, now).key
  const nextReadyAt = now + growMsFor(berry.growMs, berry.favoriteWeather, weather)
  db.update(berryPlots)
    .set({ readyAt: nextReadyAt, harvests, deadAt: died ? now : null })
    .where(and(eq(berryPlots.userId, userId), eq(berryPlots.plotIndex, plotIndex)))
    .run()
  creditItems(userId, plan.credits)
  recordEvent(userId, 'berry_harvest', plan.berryAmount, now)

  return {
    ok: true,
    harvested: {
      plotIndex,
      berryKey: plan.berryKey,
      berries: plan.berryAmount,
      credits: plan.credits,
      died,
      readyAt: nextReadyAt,
    },
  }
}

// Arrancar: vivo e antes de ficar pronto, a semente volta com uma chance (pronto
// não se arranca, o caminho é colher). Seco, é limpar: sorteia 0, 1 ou 2 sementes.
function uproot(
  userId: number,
  plotIndex: number,
  now: number,
): Ok<{ uprooted: { plotIndex: number; berryKey: string; seedReturned: boolean; seeds: number; cleared: boolean } }> | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const plot = db
    .select()
    .from(berryPlots)
    .where(and(eq(berryPlots.userId, userId), eq(berryPlots.plotIndex, plotIndex)))
    .get()
  if (!plot) return fail('plot_empty', 404)
  const dead = plot.deadAt !== null
  if (!dead && now >= plot.readyAt) return fail('already_ready', 400)

  const credits = dead ? planClear(plot.berryKey, unitRoll()).credits : planUproot(plot.berryKey, unitRoll()).credits
  const seeds = credits.reduce((sum, row) => sum + row.quantity, 0)
  db.delete(berryPlots)
    .where(and(eq(berryPlots.userId, userId), eq(berryPlots.plotIndex, plotIndex)))
    .run()
  creditItems(userId, credits)

  return {
    ok: true,
    uprooted: { plotIndex, berryKey: plot.berryKey, seedReturned: seeds > 0, seeds, cleared: dead },
  }
}
