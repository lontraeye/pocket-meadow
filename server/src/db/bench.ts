import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import { APRICORN_ITEM, apricornConfig, benchLevel, benchUnitMs } from '../config/apricorn.js'
import { getDb } from './client.js'
import { recordEvent } from './events.js'
import { creditItems, debitItem } from './inventory.js'
import { craftJobs, gardenStructures, pokemon, species } from './schema.js'

// Bancada de bolas (PLANNING.md, seção 5.23): um operador do jardim transforma
// cada Apricorn numa Poké Ball, em lotes. As bolas ficam prontas uma a uma, por
// timestamp. Chamar dentro de immediate(), depois do catch-up.

const RECIPE = 'poke_ball'

export type BenchJobView = { id: number; quantity: number; unitMs: number; startedAt: number; collected: number }

export type BenchView = {
  unlocked: boolean
  unlockLevel: number
  level: number
  batchSize: number
  /** Tempo de cada bola no nível, antes do bônus do operador. */
  unitMs: number
  speedBonus: number
  /** Poké Balls que saem de cada Apricorn. */
  ballsPerApricorn: number
  operatorTypes: string[]
  operatorId: number | null
  job: BenchJobView | null
}

export type BenchError =
  | 'bench_locked'
  | 'pokemon_not_found'
  | 'in_daycare'
  | 'in_pc'
  | 'in_team'
  | 'wrong_type'
  | 'bench_busy'
  | 'no_operator'
  | 'invalid_quantity'
  | 'no_apricorn'
  | 'no_job'
  | 'nothing_ready'

type Result<T> = ({ ok: true } & T) | { ok: false; error: BenchError }

const benchWhere = (userId: number) =>
  and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, 'ball_bench'))

/** A bancada do jogador; nasce quando o nível abre. */
function ensureBench(userId: number, level: number, now: number): { level: number; operatorId: number | null } | null {
  if (level < apricornConfig.tree.unlockLevel) return null
  const db = getDb()
  const found = db
    .select({ level: gardenStructures.level, operatorId: gardenStructures.operatorPokemonId })
    .from(gardenStructures)
    .where(benchWhere(userId))
    .get()
  if (found) return found
  db.insert(gardenStructures).values({ userId, key: 'ball_bench', since: now }).run()
  return { level: 1, operatorId: null }
}

function activeJob(userId: number): BenchJobView | null {
  const row = getDb()
    .select({
      id: craftJobs.id,
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
  return row ?? null
}

/** Quantas do lote já ficaram prontas em `now`. */
export function jobDone(job: Pick<BenchJobView, 'quantity' | 'unitMs' | 'startedAt'>, now: number): number {
  return Math.max(0, Math.min(job.quantity, Math.floor((now - job.startedAt) / job.unitMs)))
}

export function benchView(userId: number, level: number, now: number): BenchView {
  const config = apricornConfig.bench
  const bench = ensureBench(userId, level, now)
  const tier = benchLevel(bench?.level ?? 1)
  return {
    unlocked: bench !== null,
    unlockLevel: apricornConfig.tree.unlockLevel,
    level: bench?.level ?? 1,
    batchSize: tier.batchSize,
    unitMs: tier.unitMs,
    speedBonus: config.speedBonus,
    ballsPerApricorn: config.ballsPerApricorn,
    operatorTypes: config.operatorTypes,
    operatorId: bench?.operatorId ?? null,
    job: bench ? activeJob(userId) : null,
  }
}

/** Quem está operando, entre `ids` (para travar time, PC, daycare e soltar). */
export function operatorAmong(userId: number, ids: readonly number[]): number | null {
  if (ids.length === 0) return null
  const row = getDb()
    .select({ id: gardenStructures.operatorPokemonId })
    .from(gardenStructures)
    .where(and(benchWhere(userId), inArray(gardenStructures.operatorPokemonId, [...ids])))
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
  }
  getDb().update(gardenStructures).set({ operatorPokemonId: pokemonId }).where(benchWhere(userId)).run()
  return { ok: true }
}

/** Começa um lote: os Apricorns saem agora; o tempo de cada bola fica fixo. */
export function startJob(userId: number, level: number, quantity: number, now: number): Result<{ job: BenchJobView }> {
  const bench = ensureBench(userId, level, now)
  if (!bench) return { ok: false, error: 'bench_locked' }
  if (bench.operatorId === null) return { ok: false, error: 'no_operator' }
  if (activeJob(userId)) return { ok: false, error: 'bench_busy' }
  const tier = benchLevel(bench.level)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > tier.batchSize) {
    return { ok: false, error: 'invalid_quantity' }
  }
  if (!debitItem(userId, APRICORN_ITEM, quantity)) return { ok: false, error: 'no_apricorn' }
  const operator = getDb()
    .select({ happiness: pokemon.happiness })
    .from(pokemon)
    .where(eq(pokemon.id, bench.operatorId))
    .get()
  const unitMs = benchUnitMs(tier.unitMs, operator?.happiness ?? 0)
  const row = getDb()
    .insert(craftJobs)
    .values({ userId, structureKey: 'ball_bench', recipeKey: RECIPE, quantity, unitMs, startedAt: now })
    .returning({ id: craftJobs.id })
    .get()
  if (!row) throw new Error('failed to start craft job')
  return { ok: true, job: { id: row.id, quantity, unitMs, startedAt: now, collected: 0 } }
}

/** Entrega as bolas prontas; o resto do lote segue. O lote conta Apricorns. */
export function collectJob(userId: number, now: number): Result<{ balls: number }> {
  const job = activeJob(userId)
  if (!job) return { ok: false, error: 'no_job' }
  const done = jobDone(job, now)
  const balls = (done - job.collected) * apricornConfig.bench.ballsPerApricorn
  if (balls <= 0) return { ok: false, error: 'nothing_ready' }
  getDb().update(craftJobs).set({ collected: done }).where(eq(craftJobs.id, job.id)).run()
  creditItems(userId, [{ itemKey: apricornConfig.bench.output, quantity: balls }])
  recordEvent(userId, 'balls_made', balls, now)
  return { ok: true, balls }
}

/** Para o lote: entrega as prontas e devolve os Apricorns das que faltavam. */
export function cancelJob(userId: number, now: number): Result<{ balls: number; refunded: number }> {
  const job = activeJob(userId)
  if (!job) return { ok: false, error: 'no_job' }
  const done = jobDone(job, now)
  const balls = (done - job.collected) * apricornConfig.bench.ballsPerApricorn
  const refunded = job.quantity - done
  getDb().update(craftJobs).set({ collected: done, cancelledAt: now }).where(eq(craftJobs.id, job.id)).run()
  creditItems(userId, [
    { itemKey: apricornConfig.bench.output, quantity: balls },
    { itemKey: APRICORN_ITEM, quantity: refunded },
  ].filter((item) => item.quantity > 0))
  recordEvent(userId, 'balls_made', balls, now)
  return { ok: true, balls, refunded }
}
