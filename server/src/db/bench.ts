import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import { RECIPES, apricornConfig, benchLevel, benchUnitMs, recipeDef, recipeUnitMs } from '../config/apricorn.js'
import { getDb } from './client.js'
import { recordEvent } from './events.js'
import { creditItems, debitItem, itemQty } from './inventory.js'
import { craftJobs, gardenStructures, pokemon, species } from './schema.js'

// Bancada de bolas (PLANNING.md, seção 5.23): um operador do jardim transforma
// Apricorns em bolas, em lotes, pela receita escolhida. As bolas ficam prontas
// uma a uma, por timestamp. A bancada sobe de nível (lote maior, mais rápida,
// receitas novas); o upgrade leva tempo e ela fica parada enquanto isso.
// Chamar dentro de immediate(), depois do catch-up.

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
  unlocked: boolean
  unlockLevel: number
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
    trainerLevel: number
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
  | 'trainer_level'
  | 'missing_items'
  | 'operating'

type Result<T> = ({ ok: true } & T) | { ok: false; error: BenchError }

const benchWhere = (userId: number) =>
  and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, 'ball_bench'))

type BenchRow = {
  level: number
  operatorId: number | null
  upgradeTo: number | null
  upgradeEndsAt: number | null
  since: number
}

/** A bancada do jogador; nasce quando o nível abre. Um upgrade vencido é concluído aqui. */
function ensureBench(userId: number, trainerLevel: number, now: number): BenchRow | null {
  if (trainerLevel < apricornConfig.unlockLevel) return null
  const db = getDb()
  const found = db
    .select({
      level: gardenStructures.level,
      operatorId: gardenStructures.operatorPokemonId,
      upgradeTo: gardenStructures.upgradeTo,
      upgradeEndsAt: gardenStructures.upgradeEndsAt,
      since: gardenStructures.since,
    })
    .from(gardenStructures)
    .where(benchWhere(userId))
    .get()
  if (!found) {
    db.insert(gardenStructures).values({ userId, key: 'ball_bench', since: now }).run()
    return { level: 1, operatorId: null, upgradeTo: null, upgradeEndsAt: null, since: now }
  }
  if (found.upgradeTo !== null && found.upgradeEndsAt !== null && found.upgradeEndsAt <= now) {
    db.update(gardenStructures)
      .set({ level: found.upgradeTo, upgradeTo: null, upgradeEndsAt: null, since: found.upgradeEndsAt })
      .where(benchWhere(userId))
      .run()
    return { ...found, level: found.upgradeTo, upgradeTo: null, upgradeEndsAt: null, since: found.upgradeEndsAt }
  }
  return found
}

function activeJob(userId: number): BenchJobView | null {
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
        eq(craftJobs.structureKey, 'ball_bench'),
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

export function benchView(userId: number, trainerLevel: number, now: number): BenchView {
  const config = apricornConfig.bench
  const bench = ensureBench(userId, trainerLevel, now)
  const level = bench?.level ?? 1
  const nextDef = config.levels[level]
  return {
    unlocked: bench !== null,
    unlockLevel: apricornConfig.unlockLevel,
    level,
    maxLevel: config.levels.length,
    batchSize: benchLevel(level).batchSize,
    speedBonus: config.speedBonus,
    operatorTypes: config.operatorTypes,
    operatorId: bench?.operatorId ?? null,
    recipes: RECIPES.map((recipe) => ({
      key: recipe.key,
      input: recipe.input,
      output: recipe.output,
      perUnit: recipe.perUnit,
      unitMs: recipeUnitMs(recipe, level),
      minBenchLevel: recipe.minBenchLevel,
      unlocked: level >= recipe.minBenchLevel,
    })),
    job: bench ? activeJob(userId) : null,
    upgrade:
      bench && bench.upgradeTo !== null && bench.upgradeEndsAt !== null
        ? { toLevel: bench.upgradeTo, endsAt: bench.upgradeEndsAt, startedAt: bench.since }
        : null,
    next:
      nextDef?.upgrade && bench
        ? {
            level: level + 1,
            batchSize: nextDef.batchSize,
            speed: nextDef.speed,
            trainerLevel: nextDef.upgrade.trainerLevel,
            ms: nextDef.upgrade.ms,
            cost: nextDef.upgrade.cost.map((item) => ({ ...item, have: itemQty(userId, item.itemKey) })),
            newRecipes: RECIPES.filter((recipe) => recipe.minBenchLevel === level + 1).map((recipe) => recipe.key),
          }
        : null,
  }
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
        inArray(gardenStructures.key, ['ball_bench', 'daycare_keeper']),
        inArray(gardenStructures.operatorPokemonId, [...ids]),
      ),
    )
    .get()
  return row?.id ?? null
}

/** Põe (ou tira, com `null`) o operador. Só com a bancada parada. */
export function setOperator(userId: number, level: number, pokemonId: number | null, now: number): Result<{}> {
  const bench = ensureBench(userId, level, now)
  if (!bench) return { ok: false, error: 'bench_locked' }
  if (activeJob(userId)) return { ok: false, error: 'bench_busy' }
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
    // Quem cuida do daycare não opera a bancada ao mesmo tempo.
    const keeper = getDb()
      .select({ id: gardenStructures.operatorPokemonId })
      .from(gardenStructures)
      .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, 'daycare_keeper')))
      .get()
    if (keeper?.id === pokemonId) return { ok: false, error: 'operating' }
  }
  getDb().update(gardenStructures).set({ operatorPokemonId: pokemonId }).where(benchWhere(userId)).run()
  return { ok: true }
}

/** Começa um lote: os Apricorns saem agora; o tempo de cada um fica fixo. */
export function startJob(
  userId: number,
  trainerLevel: number,
  recipeKey: string,
  quantity: number,
  now: number,
): Result<{ job: BenchJobView }> {
  const bench = ensureBench(userId, trainerLevel, now)
  if (!bench) return { ok: false, error: 'bench_locked' }
  if (bench.upgradeTo !== null) return { ok: false, error: 'bench_upgrading' }
  if (bench.operatorId === null) return { ok: false, error: 'no_operator' }
  if (activeJob(userId)) return { ok: false, error: 'bench_busy' }
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
    .where(eq(pokemon.id, bench.operatorId))
    .get()
  const unitMs = benchUnitMs(recipeUnitMs(recipe, bench.level), operator?.happiness ?? 0)
  const row = getDb()
    .insert(craftJobs)
    .values({ userId, structureKey: 'ball_bench', recipeKey: recipe.key, quantity, unitMs, startedAt: now })
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
export function collectJob(userId: number, now: number): Result<{ balls: number; itemKey: string }> {
  const job = activeJob(userId)
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
export function cancelJob(userId: number, now: number): Result<{ balls: number; refunded: number; itemKey: string }> {
  const job = activeJob(userId)
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
 * Começa o upgrade para o próximo nível: confere o nível de treinador e os
 * itens, gasta tudo agora e a bancada fica parada até terminar.
 */
export function startUpgrade(userId: number, trainerLevel: number, now: number): Result<{ endsAt: number; toLevel: number }> {
  const bench = ensureBench(userId, trainerLevel, now)
  if (!bench) return { ok: false, error: 'bench_locked' }
  if (bench.upgradeTo !== null) return { ok: false, error: 'bench_upgrading' }
  if (activeJob(userId)) return { ok: false, error: 'bench_busy' }
  const next = apricornConfig.bench.levels[bench.level]
  if (!next?.upgrade) return { ok: false, error: 'max_level' }
  if (trainerLevel < next.upgrade.trainerLevel) return { ok: false, error: 'trainer_level' }
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
    .where(benchWhere(userId))
    .run()
  return { ok: true, endsAt, toLevel: bench.level + 1 }
}
