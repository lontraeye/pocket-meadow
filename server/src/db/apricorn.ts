import { and, eq } from 'drizzle-orm'
import { TREES, type TreeDef, treeDef } from '../config/apricorn.js'
import type { WeatherKey } from '../config/weather.js'
import { harvestTree, settleTree, treeReadyTimes, treeUnitMs, type WeatherOf } from '../game/apricornTree.js'
import { currentWeather, weatherDay, weatherForDay } from '../game/weather.js'
import { getDb } from './client.js'
import { recordEvent } from './events.js'
import { autoPlace, isPlaced } from './gardenLayout.js'
import { creditItems } from './inventory.js'
import { gardenStructures, trainers } from './schema.js'

// Árvores de Apricorn (PLANNING.md, seção 5.23): a vermelha abre pelo nível de
// treinador; a azul e a amarela, pelo nível da bancada. Chamar dentro de immediate().

export type TreeView = {
  key: TreeDef['key']
  color: TreeDef['color']
  itemKey: string
  unlocked: boolean
  /** No jardim (false = guardada no inventário de construção, parada). */
  placed: boolean
  /** O que abre a árvore, para o texto do cadeado. */
  unlock: TreeDef['unlock']
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

/** Nível da bancada, contando uma melhoria que já terminou (e ainda não foi gravada). */
function benchLevelOf(userId: number, now: number): number {
  const row = getDb()
    .select({ level: gardenStructures.level, upgradeTo: gardenStructures.upgradeTo, upgradeEndsAt: gardenStructures.upgradeEndsAt })
    .from(gardenStructures)
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, 'ball_bench')))
    .get()
  if (!row) return 0
  return row.upgradeTo !== null && row.upgradeEndsAt !== null && row.upgradeEndsAt <= now ? row.upgradeTo : row.level
}

export function treeOpen(tree: TreeDef, trainerLevel: number, benchLevel: number): boolean {
  return 'trainerLevel' in tree.unlock ? trainerLevel >= tree.unlock.trainerLevel : benchLevel >= tree.unlock.benchLevel
}

/** A árvore do jogador; nasce (com o primeiro Apricorn) quando abre. */
function ensureTree(userId: number, tree: TreeDef, trainerLevel: number, now: number): TreeRow | null {
  if (!treeOpen(tree, trainerLevel, benchLevelOf(userId, now))) return null
  const db = getDb()
  const where = and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, tree.key))
  const found = db.select({ progress: gardenStructures.progress, since: gardenStructures.since }).from(gardenStructures).where(where).get()
  if (found) return found
  const row = { progress: tree.startWith, since: now }
  db.insert(gardenStructures).values({ userId, key: tree.key, ...row }).run()
  autoPlace(userId, tree.key, now)
  return row
}

function viewOf(userId: number, tree: TreeDef, trainerLevel: number, now: number): TreeView {
  const base = { key: tree.key, color: tree.color, itemKey: tree.itemKey, unlock: tree.unlock, cap: tree.cap }
  const row = ensureTree(userId, tree, trainerLevel, now)
  if (!row) return { ...base, unlocked: false, placed: false, ready: 0, readyAts: [], unitMs: tree.intervalMs, raining: false }
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
export function treesView(userId: number, trainerLevel: number, now: number): TreeView[] {
  return TREES.map((tree) => viewOf(userId, tree, trainerLevel, now))
}

/** Só a vermelha (cenário de teste). */
export function treeView(userId: number, trainerLevel: number, now: number): TreeView {
  return viewOf(userId, TREES[0]!, trainerLevel, now)
}

/** Colhe tudo o que está pendurado. `null` = nada pronto, árvore fechada ou desconhecida. */
export function harvestApricorns(userId: number, trainerLevel: number, now: number, key: string = TREES[0]!.key): number | null {
  const tree = treeDef(key)
  if (!tree) return null
  const row = ensureTree(userId, tree, trainerLevel, now)
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
