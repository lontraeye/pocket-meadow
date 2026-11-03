import { and, eq } from 'drizzle-orm'
import { APRICORN_ITEM, apricornConfig } from '../config/apricorn.js'
import type { WeatherKey } from '../config/weather.js'
import { harvestTree, settleTree, treeReadyTimes, treeUnitMs, type WeatherOf } from '../game/apricornTree.js'
import { currentWeather, weatherDay, weatherForDay } from '../game/weather.js'
import { getDb } from './client.js'
import { recordEvent } from './events.js'
import { creditItems } from './inventory.js'
import { gardenStructures, trainers } from './schema.js'

// Árvore de Apricorn (PLANNING.md, seção 5.23). Chamar dentro de immediate().

export type TreeView = {
  unlocked: boolean
  unlockLevel: number
  /** Pendurados agora. */
  ready: number
  cap: number
  /** Quando cada próximo fica pronto (até encher), pelo clima de hoje. */
  readyAts: number[]
  /** Quanto leva cada Apricorn hoje (com a chuva): a barrinha do próximo. */
  unitMs: number
  raining: boolean
}

type TreeRow = { progress: number; since: number }

function weatherFor(userId: number, now: number): { today: WeatherKey; of: WeatherOf } {
  const row = getDb().select({ seed: trainers.weatherSeed }).from(trainers).where(eq(trainers.userId, userId)).get()
  if (!row) throw new Error(`trainer missing for user ${userId}`)
  const todayDay = weatherDay(now)
  const today = currentWeather(userId, row.seed, now)
  return { today, of: (day) => (day === todayDay ? today : weatherForDay(row.seed, day)) }
}

/** A árvore do jogador; nasce (com o primeiro Apricorn) quando o nível abre. */
function ensureTree(userId: number, level: number, now: number): TreeRow | null {
  const config = apricornConfig.tree
  if (level < config.unlockLevel) return null
  const db = getDb()
  const where = and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, 'apricorn_tree'))
  const found = db.select({ progress: gardenStructures.progress, since: gardenStructures.since }).from(gardenStructures).where(where).get()
  if (found) return found
  const row = { progress: config.startWith, since: now }
  db.insert(gardenStructures).values({ userId, key: 'apricorn_tree', ...row }).run()
  return row
}

export function treeView(userId: number, level: number, now: number): TreeView {
  const config = apricornConfig.tree
  const tree = ensureTree(userId, level, now)
  if (!tree) {
    return {
      unlocked: false,
      unlockLevel: config.unlockLevel,
      ready: 0,
      cap: config.cap,
      readyAts: [],
      unitMs: config.intervalMs,
      raining: false,
    }
  }
  const weather = weatherFor(userId, now)
  const progress = settleTree(tree.progress, tree.since, now, weather.of)
  return {
    unlocked: true,
    unlockLevel: config.unlockLevel,
    ready: Math.floor(progress),
    cap: config.cap,
    readyAts: treeReadyTimes(progress, now, weather.today),
    unitMs: treeUnitMs(weather.today),
    raining: weather.today === 'rain',
  }
}

/** Colhe tudo o que está pendurado. `null` = nada pronto (ou árvore fechada). */
export function harvestApricorns(userId: number, level: number, now: number): number | null {
  const tree = ensureTree(userId, level, now)
  if (!tree) return null
  const settled = settleTree(tree.progress, tree.since, now, weatherFor(userId, now).of)
  const { harvested, progress } = harvestTree(settled)
  if (harvested === 0) return null
  getDb()
    .update(gardenStructures)
    .set({ progress, since: now })
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, 'apricorn_tree')))
    .run()
  creditItems(userId, [{ itemKey: APRICORN_ITEM, quantity: harvested }])
  recordEvent(userId, 'apricorn_harvest', harvested, now)
  return harvested
}
