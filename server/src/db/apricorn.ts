import { and, eq } from 'drizzle-orm'
import { TREES, type TreeDef, treeDef } from '../config/apricorn.js'
import { pieceUnlockAt, type UnlockAt } from '../config/gardenUnlocks.js'
import type { WeatherKey } from '../config/weather.js'
import { harvestTree, settleTree, treeReadyTimes, treeUnitMs, type WeatherOf } from '../game/apricornTree.js'
import { currentWeather, weatherDay, weatherForDay } from '../game/weather.js'
import { getDb } from './client.js'
import { recordEvent } from './events.js'
import { autoPlace, isPlaced } from './gardenLayout.js'
import { creditItems } from './inventory.js'
import { clearedMilestones, gardenUnlocksOf } from './milestones.js'
import { gardenStructures, trainers } from './schema.js'

// Árvores de Apricorn (PLANNING.md, seção 5.23): abrem pelos marcos (a vermelha
// desde o começo; config/gardenUnlocks). Chamar dentro de immediate().

export type TreeView = {
  key: TreeDef['key']
  color: TreeDef['color']
  itemKey: string
  unlocked: boolean
  /** No jardim (false = guardada no inventário de construção, parada). */
  placed: boolean
  /** O marco que abre a árvore, para o texto do cadeado (null = aberta). */
  unlockAt: UnlockAt | null
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

/** A árvore do jogador; nasce (com o primeiro Apricorn) quando o marco abre. */
function ensureTree(userId: number, tree: TreeDef, now: number): TreeRow | null {
  if (!gardenUnlocksOf(userId).pieces.has(tree.key)) return null
  const db = getDb()
  const where = and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, tree.key))
  const found = db.select({ progress: gardenStructures.progress, since: gardenStructures.since }).from(gardenStructures).where(where).get()
  if (found) return found
  const row = { progress: tree.startWith, since: now }
  db.insert(gardenStructures).values({ userId, key: tree.key, ...row }).run()
  autoPlace(userId, tree.key, now)
  return row
}

function viewOf(userId: number, tree: TreeDef, now: number): TreeView {
  const base = { key: tree.key, color: tree.color, itemKey: tree.itemKey, unlockAt: null, cap: tree.cap }
  const row = ensureTree(userId, tree, now)
  if (!row) {
    const unlockAt = pieceUnlockAt(clearedMilestones(userId), tree.key)
    return { ...base, unlockAt, unlocked: false, placed: false, ready: 0, readyAts: [], unitMs: tree.intervalMs, raining: false }
  }
  // Guardada: não cresce (o `progress` foi liquidado ao guardar).
  if (!isPlaced(userId, tree.key)) {
    return { ...base, unlocked: true, placed: false, ready: Math.floor(row.progress), readyAts: [], unitMs: tree.intervalMs, raining: false }
  }
  const weather = weatherFor(userId, now)
  const progress = settleTree(row.progress, row.since, now, weather.of, tree)
  return {
    ...base,
    unlocked: true,
    placed: true,
    ready: Math.floor(progress),
    readyAts: treeReadyTimes(progress, now, weather.today, tree),
    unitMs: treeUnitMs(weather.today, tree),
    raining: weather.today === 'rain',
  }
}

/** Todas as árvores, abertas ou não (as fechadas aparecem com cadeado). */
export function treesView(userId: number, now: number): TreeView[] {
  return TREES.map((tree) => viewOf(userId, tree, now))
}

/** Só a vermelha (cenário de teste). */
export function treeView(userId: number, now: number): TreeView {
  return viewOf(userId, TREES[0]!, now)
}

/** Colhe tudo o que está pendurado. `null` = nada pronto, árvore fechada ou desconhecida. */
export function harvestApricorns(userId: number, now: number, key: string = TREES[0]!.key): number | null {
  const tree = treeDef(key)
  if (!tree) return null
  const row = ensureTree(userId, tree, now)
  if (!row || !isPlaced(userId, tree.key)) return null
  const settled = settleTree(row.progress, row.since, now, weatherFor(userId, now).of, tree)
  const { harvested, progress } = harvestTree(settled)
  if (harvested === 0) return null
  getDb()
    .update(gardenStructures)
    .set({ progress, since: now })
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, tree.key)))
    .run()
  creditItems(userId, [{ itemKey: tree.itemKey, quantity: harvested }])
  recordEvent(userId, 'apricorn_harvest', harvested, now)
  return harvested
}

/** Ao guardar: liquida o que cresceu até agora e para o relógio. */
export function freezeTree(userId: number, key: string, now: number): void {
  const tree = treeDef(key)
  if (!tree) return
  const where = and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, tree.key))
  const row = getDb().select({ progress: gardenStructures.progress, since: gardenStructures.since }).from(gardenStructures).where(where).get()
  if (!row) return
  const progress = settleTree(row.progress, row.since, now, weatherFor(userId, now).of, tree)
  getDb().update(gardenStructures).set({ progress, since: now }).where(where).run()
}
