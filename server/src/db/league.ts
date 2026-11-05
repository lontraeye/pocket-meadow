// Tentativa da Liga (PLANNING 5.24). O HP fica no JSON da tentativa: o
// descanso e a máquina de cura não mexem nele.

import { and, eq, sql } from 'drizzle-orm'
import { leagueConfig, leagueTrainerAt, leagueTrainers } from '../config/league.js'
import { milestoneByKey } from '../config/milestones.js'
import { rewardLabel } from '../config/rewardNames.js'
import type { TrainerConfig } from '../config/trainers.js'
import { creditItems } from './inventory.js'
import { getDb } from './client.js'
import { leagueRuns, trainerMilestones, trainers } from './schema.js'

export type LeagueMember = { pokemonId: number; hpRatio: number }

export type LeagueFightResult = {
  status: 'active' | 'won' | 'lost'
  nextName: string | null
  champion: boolean
  opens: number | null
  rewards: string[]
}

export function parseLeagueTeam(raw: string): LeagueMember[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const members: LeagueMember[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const pokemonId = (entry as { pokemonId?: unknown }).pokemonId
    const hpRatio = (entry as { hpRatio?: unknown }).hpRatio
    if (!Number.isInteger(pokemonId) || typeof hpRatio !== 'number') continue
    members.push({ pokemonId: pokemonId as number, hpRatio })
  }
  return members
}

export function activeLeagueRun(userId: number) {
  return getDb()
    .select()
    .from(leagueRuns)
    .where(and(eq(leagueRuns.userId, userId), eq(leagueRuns.status, 'active')))
    .get()
}

export function insertLeagueRun(userId: number, members: LeagueMember[], now: number): number {
  const inserted = getDb()
    .insert(leagueRuns)
    .values({
      userId,
      startedAt: now,
      stage: 0,
      status: 'active',
      team: JSON.stringify(members),
    })
    .returning({ id: leagueRuns.id })
    .get()
  if (!inserted) throw new Error('failed to start league')
  return inserted.id
}

export function abandonLeagueRun(userId: number, now: number): boolean {
  const updated = getDb()
    .update(leagueRuns)
    .set({ status: 'abandoned', finishedAt: now })
    .where(and(eq(leagueRuns.userId, userId), eq(leagueRuns.status, 'active')))
    .run()
  return updated.changes === 1
}

/** Todos desmaiados na tentativa: ela acaba, sem luta. */
export function loseLeagueRun(runId: number, members: LeagueMember[], now: number): void {
  getDb()
    .update(leagueRuns)
    .set({ status: 'lost', finishedAt: now, team: JSON.stringify(members) })
    .where(and(eq(leagueRuns.id, runId), eq(leagueRuns.status, 'active')))
    .run()
}

/**
 * Depois da luta: grava o HP da tentativa e avança, perde ou coroa.
 * Só na primeira vitória do campeão sai o prêmio.
 */
export function settleLeagueFight(input: {
  userId: number
  trainer: TrainerConfig
  won: boolean
  hpByPokemonId: ReadonlyMap<number, number>
  now: number
}): LeagueFightResult {
  const run = activeLeagueRun(input.userId)
  if (!run) throw new Error(`league run missing for ${input.trainer.key}`)
  const expected = leagueTrainerAt(run.stage)
  if (!expected || expected.key !== input.trainer.key) {
    throw new Error(`league stage mismatch: ${input.trainer.key}`)
  }
  const members = parseLeagueTeam(run.team)
  for (const member of members) {
    const hp = input.hpByPokemonId.get(member.pokemonId)
    if (hp !== undefined) member.hpRatio = hp
  }
  const team = JSON.stringify(members)
  if (!input.won) {
    getDb()
      .update(leagueRuns)
      .set({ status: 'lost', finishedAt: input.now, team })
      .where(eq(leagueRuns.id, run.id))
      .run()
    return { status: 'lost', nextName: null, champion: false, opens: null, rewards: [] }
  }
  const next = run.stage + 1
  if (next < leagueTrainers.length) {
    getDb().update(leagueRuns).set({ stage: next, team }).where(eq(leagueRuns.id, run.id)).run()
    return {
      status: 'active',
      nextName: leagueTrainers[next]!.name,
      champion: false,
      opens: null,
      rewards: [],
    }
  }
  const milestone = milestoneByKey('league')
  const inserted = getDb()
    .insert(trainerMilestones)
    .values({ userId: input.userId, milestoneKey: 'league', clearedAt: input.now })
    .onConflictDoNothing()
    .run()
  const rewards: string[] = []
  if (inserted.changes === 1) {
    creditItems(input.userId, leagueConfig.championRewards.items)
    getDb()
      .update(trainers)
      .set({
        genericCandies: sql`${trainers.genericCandies} + ${leagueConfig.championRewards.genericCandies}`,
        updatedAt: input.now,
      })
      .where(eq(trainers.userId, input.userId))
      .run()
    for (const item of leagueConfig.championRewards.items) rewards.push(rewardLabel(item))
    rewards.push(`${leagueConfig.championRewards.genericCandies} doces`)
  }
  getDb()
    .update(leagueRuns)
    .set({ status: 'won', finishedAt: input.now, team })
    .where(eq(leagueRuns.id, run.id))
    .run()
  return {
    status: 'won',
    nextName: null,
    champion: true,
    opens: milestone ? milestone.chapter + 1 : null,
    rewards,
  }
}
