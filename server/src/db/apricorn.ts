import { and, eq } from 'drizzle-orm'
import { TREES, type TreeDef, treeDef } from '../config/apricorn.js'
import type { WeatherKey } from '../config/weather.js'
import { harvestTree, settleTree, treeReadyTimes, treeUnitMs, type WeatherOf } from '../game/apricornTree.js'
import { currentWeather, weatherDay, weatherForDay } from '../game/weather.js'
import { getDb } from './client.js'
import { recordEvent } from './events.js'
import { isPlaced } from './gardenLayout.js'
import { creditItems } from './inventory.js'
import { gardenStructures, trainers } from './schema.js'
import { structureById, structuresOf, type StructureRow } from './structures.js'

// Árvores de Apricorn (PLANNING.md, seção 5.23), uma por peça: abrem pelos
// marcos (a vermelha desde o começo; config/gardenUnlocks) e cada uma cresce
// por conta. Chamar dentro de immediate(), depois do catch-up.

export type TreeView = {
  /** A peça (garden_structures.id). */
  id: number
  key: TreeDef['key']
  color: TreeDef['color']
  itemKey: string
  /** No jardim (false = guardada no inventário de construção, parada). */
  placed: boolean
  /** Pendurados agora. */
  ready: number
  cap: number
  /** Quando cada próximo fica pronto (até encher), pelo clima de hoje. */
  readyAts: number[]
  /** Quanto leva cada Apricorn hoje (com a chuva): a barrinha do próximo. */
  unitMs: number
  raining: boolean
}

function weatherFor(userId: number, now: number): { today: WeatherKey; of: WeatherOf } {
  const row = getDb().select({ seed: trainers.weatherSeed }).from(trainers).where(eq(trainers.userId, userId)).get()
  if (!row) throw new Error(`trainer missing for user ${userId}`)
  const todayDay = weatherDay(now)
  const today = currentWeather(userId, row.seed, now)
  return { today, of: (day) => (day === todayDay ? today : weatherForDay(row.seed, day)) }
}

function viewOf(row: StructureRow, tree: TreeDef, weather: { today: WeatherKey; of: WeatherOf }, now: number): TreeView {
  const base = { id: row.id, key: tree.key, color: tree.color, itemKey: tree.itemKey, cap: tree.cap }
  // Guardada: não cresce (o `progress` foi liquidado ao guardar).
  if (!isPlaced(row.id)) {
    return { ...base, placed: false, ready: Math.floor(row.progress), readyAts: [], unitMs: tree.intervalMs, raining: false }
  }
  const progress = settleTree(row.progress, row.since, now, weather.of, tree)
  return {
    ...base,
    placed: true,
    ready: Math.floor(progress),
    readyAts: treeReadyTimes(progress, now, weather.today, tree),
    unitMs: treeUnitMs(weather.today, tree),
    raining: weather.today === 'rain',
  }
}

/** As árvores do jogador, colocadas ou guardadas, na ordem em que vieram. */
export function treesView(userId: number, now: number): TreeView[] {
  const weather = weatherFor(userId, now)
  return TREES.flatMap((tree) => structuresOf(userId, tree.key).map((row) => viewOf(row, tree, weather, now)))
}

/** A primeira árvore de um tipo (cenário de teste). */
export function treeView(userId: number, now: number, key: TreeDef['key'] = TREES[0]!.key): TreeView | null {
  return treesView(userId, now).find((row) => row.key === key) ?? null
}

/** Colhe tudo o que está pendurado na árvore `id`. `null` = nada pronto, guardada ou não é árvore. */
export function harvestApricorns(userId: number, now: number, id: number): number | null {
  const row = structureById(userId, id)
  const tree = row ? treeDef(row.key) : null
  if (!row || !tree || !isPlaced(row.id)) return null
  const settled = settleTree(row.progress, row.since, now, weatherFor(userId, now).of, tree)
  const { harvested, progress } = harvestTree(settled)
  if (harvested === 0) return null
  getDb()
    .update(gardenStructures)
    .set({ progress, since: now })
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.id, row.id)))
    .run()
  creditItems(userId, [{ itemKey: tree.itemKey, quantity: harvested }])
  recordEvent(userId, 'apricorn_harvest', harvested, now)
  return harvested
}

/** Ao guardar: liquida o que cresceu até agora e para o relógio. */
export function freezeTree(userId: number, id: number, now: number): void {
  const row = structureById(userId, id)
  const tree = row ? treeDef(row.key) : null
  if (!row || !tree) return
  const progress = settleTree(row.progress, row.since, now, weatherFor(userId, now).of, tree)
  getDb()
    .update(gardenStructures)
    .set({ progress, since: now })
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.id, row.id)))
    .run()
}
