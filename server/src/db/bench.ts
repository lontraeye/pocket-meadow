import { and, eq, inArray, isNull, lt, ne } from 'drizzle-orm'
import { RECIPES, apricornConfig, benchLevel, benchUnitMs, recipeDef, recipeUnitMs } from '../config/apricorn.js'
import { benchLevelAt, type UnlockAt } from '../config/gardenUnlocks.js'
import { getDb } from './client.js'
import { isPlaced } from './gardenLayout.js'
import { recordEvent } from './events.js'
import { creditItems, debitItem, itemQty } from './inventory.js'
import { clearedMilestones, gardenUnlocksOf } from './milestones.js'
import { craftJobs, gardenStructures, pokemon, species } from './schema.js'
import { structureById, structuresOf, type StructureRow } from './structures.js'

// Bancada de bolas (PLANNING.md, seção 5.23): um operador do jardim transforma
// Apricorns em bolas, em lotes, pela receita escolhida. As bolas ficam prontas
// uma a uma, por timestamp. A bancada sobe de nível (lote maior, mais rápida,
// receitas novas); o upgrade leva tempo e ela fica parada enquanto isso. Até
// onde ela sobe vem dos marcos (config/gardenUnlocks). Cada bancada (peça) tem
// o seu operador, lote e nível (PROGRESSAO.md 4.3, passo 2).
// Chamar dentro de immediate(), depois do catch-up.

export const BENCH_KEY = 'ball_bench' as const

export type BenchJobView = {
  id: number
  recipeKey: string
  /** Bolas por Apricorn da receita deste lote. */
  perUnit: number
  output: string
  quantity: number
  unitMs: number
  startedAt: number
  collected: number
}

export type RecipeView = {
  key: string
  input: string
  output: string
  perUnit: number
  /** Tempo de cada Apricorn no nível atual, antes do operador. */
  unitMs: number
  minBenchLevel: number
  unlocked: boolean
}

export type BenchView = {
  /** A peça (garden_structures.id). */
  id: number
  /** No jardim (false = guardada no inventário de construção). */
  placed: boolean
  level: number
  maxLevel: number
  batchSize: number
  speedBonus: number
  operatorTypes: string[]
  operatorId: number | null
  recipes: RecipeView[]
  job: BenchJobView | null
  /** Upgrade em andamento (a bancada fica parada até `endsAt`). */
  upgrade: { toLevel: number; endsAt: number; startedAt: number } | null
  /** O próximo nível: o que muda e quanto custa. null = já está no máximo. */
  next: {
    level: number
    batchSize: number
    speed: number
    /** O marco que falta para subir (null = já pode). */
    unlockAt: UnlockAt | null
    ms: number
    cost: { itemKey: string; quantity: number; have: number }[]
    newRecipes: string[]
  } | null
}

export type BenchError =
  | 'bench_locked'
  | 'pokemon_not_found'
  | 'in_daycare'
  | 'in_pc'
  | 'in_team'
  | 'wrong_type'
  | 'bench_busy'
  | 'bench_upgrading'
  | 'no_operator'
  | 'invalid_quantity'
  | 'invalid_recipe'
  | 'recipe_locked'
  | 'no_apricorn'
  | 'no_job'
  | 'nothing_ready'
  | 'max_level'
  | 'milestone_needed'
  | 'missing_items'
  | 'operating'
  | 'not_placed'

type Result<T> = ({ ok: true } & T) | { ok: false; error: BenchError }

const rowWhere = (userId: number, id: number) => and(eq(gardenStructures.userId, userId), eq(gardenStructures.id, id))

/**
 * A bancada `id` do jogador (sem `id`: a primeira). Um upgrade vencido é
 * concluído aqui. null = não existe ou não é bancada.
 */
function loadBench(userId: number, id: number | undefined, now: number): StructureRow | null {
  const found = id === undefined ? (structuresOf(userId, BENCH_KEY)[0] ?? null) : structureById(userId, id)
  if (!found || found.key !== BENCH_KEY) return null
  if (found.upgradeTo !== null && found.upgradeEndsAt !== null && found.upgradeEndsAt <= now) {
    const done = { level: found.upgradeTo, upgradeTo: null, upgradeEndsAt: null, since: found.upgradeEndsAt }
    getDb().update(gardenStructures).set(done).where(rowWhere(userId, found.id)).run()
    return { ...found, ...done }
  }
  return found
}

function activeJob(userId: number, benchId: number): BenchJobView | null {
  const row = getDb()
    .select({
      id: craftJobs.id,
      recipeKey: craftJobs.recipeKey,
      quantity: craftJobs.quantity,
      unitMs: craftJobs.unitMs,
      startedAt: craftJobs.startedAt,
      collected: craftJobs.collected,
    })
    .from(craftJobs)
    .where(
      and(
        eq(craftJobs.userId, userId),
        eq(craftJobs.structureId, benchId),
        isNull(craftJobs.cancelledAt),
        lt(craftJobs.collected, craftJobs.quantity),
      ),
    )
    .get()
  if (!row) return null
  const recipe = recipeDef(row.recipeKey) ?? RECIPES[0]!
  return { ...row, perUnit: recipe.perUnit, output: recipe.output }
}

/** Quantas do lote já ficaram prontas em `now`. */
export function jobDone(job: Pick<BenchJobView, 'quantity' | 'unitMs' | 'startedAt'>, now: number): number {
  return Math.max(0, Math.min(job.quantity, Math.floor((now - job.startedAt) / job.unitMs)))
}

function viewOf(userId: number, bench: StructureRow, cleared: ReadonlySet<string>): BenchView {
  const config = apricornConfig.bench
  const level = bench.level
  const nextDef = config.levels[level]
  return {
    id: bench.id,
    placed: isPlaced(bench.id),
    level,
    maxLevel: config.levels.length,
    batchSize: benchLevel(level).batchSize,
    speedBonus: config.speedBonus,
    operatorTypes: config.operatorTypes,
    operatorId: bench.operatorPokemonId,
    recipes: RECIPES.map((recipe) => ({
      key: recipe.key,
      input: recipe.input,
      output: recipe.output,
      perUnit: recipe.perUnit,
      unitMs: recipeUnitMs(recipe, level),
      minBenchLevel: recipe.minBenchLevel,
      unlocked: level >= recipe.minBenchLevel,
    })),
    job: activeJob(userId, bench.id),
    upgrade:
      bench.upgradeTo !== null && bench.upgradeEndsAt !== null
        ? { toLevel: bench.upgradeTo, endsAt: bench.upgradeEndsAt, startedAt: bench.since }
        : null,
    next: nextDef?.upgrade
      ? {
          level: level + 1,
          batchSize: nextDef.batchSize,
          speed: nextDef.speed,
          unlockAt: benchLevelAt(cleared, level + 1),
          ms: nextDef.upgrade.ms,
          cost: nextDef.upgrade.cost.map((item) => ({ ...item, have: itemQty(userId, item.itemKey) })),
          newRecipes: RECIPES.filter((recipe) => recipe.minBenchLevel === level + 1).map((recipe) => recipe.key),
        }
      : null,
  }
}

/** As bancadas do jogador, colocadas ou guardadas, na ordem em que vieram. */
export function benchesView(userId: number, now: number): BenchView[] {
  const cleared = clearedMilestones(userId)
  return structuresOf(userId, BENCH_KEY).flatMap((row) => {
    const bench = loadBench(userId, row.id, now)
    return bench ? [viewOf(userId, bench, cleared)] : []
  })
}

/** Uma bancada (sem `id`: a primeira). */
export function benchView(userId: number, now: number, id?: number): BenchView | null {
  const bench = loadBench(userId, id, now)
  return bench ? viewOf(userId, bench, clearedMilestones(userId)) : null
}

/** Quem está operando, entre `ids` (para travar time, PC, daycare e soltar). */
export function operatorAmong(userId: number, ids: readonly number[]): number | null {
  if (ids.length === 0) return null
  const row = getDb()
    .select({ id: gardenStructures.operatorPokemonId })
    .from(gardenStructures)
    .where(
      and(
        eq(gardenStructures.userId, userId),
        inArray(gardenStructures.key, [BENCH_KEY, 'daycare_keeper']),
        inArray(gardenStructures.operatorPokemonId, [...ids]),
      ),
    )
    .get()
  return row?.id ?? null
}

/** Põe (ou tira, com `null`) o operador. Só com a bancada parada. */
export function setOperator(userId: number, pokemonId: number | null, now: number, id?: number): Result<{}> {
  const bench = loadBench(userId, id, now)
  if (!bench) return { ok: false, error: 'bench_locked' }
  if (activeJob(userId, bench.id)) return { ok: false, error: 'bench_busy' }
  if (pokemonId !== null && !isPlaced(bench.id)) return { ok: false, error: 'not_placed' }
  if (pokemonId !== null) {
    const mon = getDb()
      .select({
        location: pokemon.location,
        inPc: pokemon.inPc,
        teamSlot: pokemon.teamSlot,
        type1: species.type1,
        type2: species.type2,
      })
      .from(pokemon)
      .innerJoin(species, eq(pokemon.speciesId, species.id))
      .where(and(eq(pokemon.id, pokemonId), eq(pokemon.userId, userId)))
      .get()
    if (!mon) return { ok: false, error: 'pokemon_not_found' }
    if (mon.location === 'daycare') return { ok: false, error: 'in_daycare' }
    if (mon.inPc) return { ok: false, error: 'in_pc' }
    if (mon.teamSlot !== null) return { ok: false, error: 'in_team' }
    const types = apricornConfig.bench.operatorTypes
    if (!types.includes(mon.type1) && !(mon.type2 !== null && types.includes(mon.type2))) {
      return { ok: false, error: 'wrong_type' }
    }
    // Quem cuida do daycare ou opera outra bancada não opera esta ao mesmo tempo.
    const busy = getDb()
      .select({ id: gardenStructures.id })
      .from(gardenStructures)
      .where(
        and(
          eq(gardenStructures.userId, userId),
          inArray(gardenStructures.key, [BENCH_KEY, 'daycare_keeper']),
          eq(gardenStructures.operatorPokemonId, pokemonId),
          ne(gardenStructures.id, bench.id),
        ),
      )
      .get()
    if (busy) return { ok: false, error: 'operating' }
  }
  getDb().update(gardenStructures).set({ operatorPokemonId: pokemonId }).where(rowWhere(userId, bench.id)).run()
  return { ok: true }
}

/** Começa um lote: os Apricorns saem agora; o tempo de cada um fica fixo. */
export function startJob(
  userId: number,
  recipeKey: string,
  quantity: number,
  now: number,
  id?: number,
): Result<{ job: BenchJobView }> {
  const bench = loadBench(userId, id, now)
  if (!bench) return { ok: false, error: 'bench_locked' }
  if (!isPlaced(bench.id)) return { ok: false, error: 'not_placed' }
  if (bench.upgradeTo !== null) return { ok: false, error: 'bench_upgrading' }
  if (bench.operatorPokemonId === null) return { ok: false, error: 'no_operator' }
  if (activeJob(userId, bench.id)) return { ok: false, error: 'bench_busy' }
  const recipe = recipeDef(recipeKey)
  if (!recipe) return { ok: false, error: 'invalid_recipe' }
  if (bench.level < recipe.minBenchLevel) return { ok: false, error: 'recipe_locked' }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > benchLevel(bench.level).batchSize) {
    return { ok: false, error: 'invalid_quantity' }
  }
  if (!debitItem(userId, recipe.input, quantity)) return { ok: false, error: 'no_apricorn' }
  const operator = getDb()
    .select({ happiness: pokemon.happiness })
    .from(pokemon)
    .where(eq(pokemon.id, bench.operatorPokemonId))
    .get()
  const unitMs = benchUnitMs(recipeUnitMs(recipe, bench.level), operator?.happiness ?? 0)
  const row = getDb()
    .insert(craftJobs)
    .values({ userId, structureKey: BENCH_KEY, structureId: bench.id, recipeKey: recipe.key, quantity, unitMs, startedAt: now })
    .returning({ id: craftJobs.id })
    .get()
  if (!row) throw new Error('failed to start craft job')
  return {
    ok: true,
    job: {
      id: row.id,
      recipeKey: recipe.key,
      perUnit: recipe.perUnit,
      output: recipe.output,
      quantity,
      unitMs,
      startedAt: now,
      collected: 0,
    },
  }
}

/** Entrega as bolas prontas; o resto do lote segue. O lote conta Apricorns. */
export function collectJob(userId: number, now: number, id?: number): Result<{ balls: number; itemKey: string }> {
  const bench = loadBench(userId, id, now)
  const job = bench ? activeJob(userId, bench.id) : null
  if (!job) return { ok: false, error: 'no_job' }
  const done = jobDone(job, now)
  const balls = (done - job.collected) * job.perUnit
  if (balls <= 0) return { ok: false, error: 'nothing_ready' }
  getDb().update(craftJobs).set({ collected: done }).where(eq(craftJobs.id, job.id)).run()
  creditItems(userId, [{ itemKey: job.output, quantity: balls }])
  recordEvent(userId, 'balls_made', balls, now)
  return { ok: true, balls, itemKey: job.output }
}

/** Para o lote: entrega as prontas e devolve os Apricorns das que faltavam. */
export function cancelJob(userId: number, now: number, id?: number): Result<{ balls: number; refunded: number; itemKey: string }> {
  const bench = loadBench(userId, id, now)
  const job = bench ? activeJob(userId, bench.id) : null
  if (!job) return { ok: false, error: 'no_job' }
  const recipe = recipeDef(job.recipeKey) ?? RECIPES[0]!
  const done = jobDone(job, now)
  const balls = (done - job.collected) * job.perUnit
  const refunded = job.quantity - done
  getDb().update(craftJobs).set({ collected: done, cancelledAt: now }).where(eq(craftJobs.id, job.id)).run()
  creditItems(
    userId,
    [
      { itemKey: job.output, quantity: balls },
      { itemKey: recipe.input, quantity: refunded },
    ].filter((item) => item.quantity > 0),
  )
  recordEvent(userId, 'balls_made', balls, now)
  return { ok: true, balls, refunded, itemKey: job.output }
}

/**
 * Começa o upgrade para o próximo nível: confere o marco e os itens, gasta
 * tudo agora e a bancada fica parada até terminar.
 */
export function startUpgrade(userId: number, now: number, id?: number): Result<{ endsAt: number; toLevel: number }> {
  const bench = loadBench(userId, id, now)
  if (!bench) return { ok: false, error: 'bench_locked' }
  if (!isPlaced(bench.id)) return { ok: false, error: 'not_placed' }
  if (bench.upgradeTo !== null) return { ok: false, error: 'bench_upgrading' }
  if (activeJob(userId, bench.id)) return { ok: false, error: 'bench_busy' }
  const next = apricornConfig.bench.levels[bench.level]
  if (!next?.upgrade) return { ok: false, error: 'max_level' }
  if (gardenUnlocksOf(userId).benchMaxLevel < bench.level + 1) return { ok: false, error: 'milestone_needed' }
  if (next.upgrade.cost.some((item) => itemQty(userId, item.itemKey) < item.quantity)) {
    return { ok: false, error: 'missing_items' }
  }
  for (const item of next.upgrade.cost) {
    if (!debitItem(userId, item.itemKey, item.quantity)) throw new Error(`debit failed: ${item.itemKey}`)
  }
  const endsAt = now + next.upgrade.ms
  getDb()
    .update(gardenStructures)
    .set({ upgradeTo: bench.level + 1, upgradeEndsAt: endsAt, since: now })
    .where(rowWhere(userId, bench.id))
    .run()
  return { ok: true, endsAt, toLevel: bench.level + 1 }
}

/**
 * Antes de guardar a bancada: só parada (sem lote nem melhoria). Ao guardar, o
 * operador volta para o passeio.
 */
export function storeBench(userId: number, id: number, now: number): { ok: true } | { ok: false; error: BenchError } {
  const bench = loadBench(userId, id, now)
  if (!bench) return { ok: false, error: 'bench_locked' }
  if (activeJob(userId, bench.id)) return { ok: false, error: 'bench_busy' }
  if (bench.upgradeTo !== null) return { ok: false, error: 'bench_upgrading' }
  getDb().update(gardenStructures).set({ operatorPokemonId: null }).where(rowWhere(userId, bench.id)).run()
  return { ok: true }
}
