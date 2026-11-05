import { SqliteError } from 'better-sqlite3'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { leagueConfig, leagueTrainersFor } from '../config/league.js'
import { rewardLabel } from '../config/rewardNames.js'
import { weekStartAt } from '../game/weather.js'
import { chapterOpen } from '../config/milestones.js'
import { petConfig } from '../config/pets.js'
import { trainerConfig } from '../config/trainer.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import {
  abandonLeagueRun,
  activeLeagueRun,
  insertLeagueRun,
  loseLeagueRun,
  parseLeagueTeam,
  rematchRewardTaken,
  type LeagueMember,
} from '../db/league.js'
import { healMachinesView } from '../db/healMachine.js'
import { loadProgress } from '../db/milestones.js'
import { encounters, leagueRuns, pokemon, species } from '../db/schema.js'
import { clampRatio } from '../game/heal.js'
import { trainerByKey } from '../config/trainers.js'
import { createTrainerEncounter } from './encounters.js'
import { fail } from './http.js'
import { currentPlaceOf } from './places.js'

// Liga (PLANNING 5.24, parte 2): cinco lutas no Indigo Plateau, sem curar
// entre elas. O HP da tentativa vive em league_runs.team.

export const leagueRoutes = new Hono<AuthEnv>()

leagueRoutes.get('/', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  const view = immediate(() => leagueView(userId, now))
  return c.json(view)
})

leagueRoutes.post('/start', requireUser, async (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  const body = (await c.req.json().catch(() => null)) as { pokemonIds?: unknown } | null
  const pokemonIds = body?.pokemonIds
  if (!Array.isArray(pokemonIds) || pokemonIds.some((id) => !Number.isInteger(id))) {
    return c.json({ error: 'invalid_team' }, 400)
  }
  try {
    const result = immediate(() => startLeague(userId, pokemonIds as number[], now))
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json(result.view, 201)
  } catch (error) {
    if (error instanceof SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'league_active' }, 409)
    }
    throw error
  }
})

leagueRoutes.post('/next', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  try {
    const result = immediate(() => nextLeagueFight(userId, now))
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json(result.encounter, 201)
  } catch (error) {
    if (error instanceof SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'encounter_pending' }, 409)
    }
    throw error
  }
})

leagueRoutes.post('/abandon', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => abandonLeague(userId, now))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ ok: true })
})

function leagueView(userId: number, now: number) {
  const clock = persistCatchUp(userId, now)
  const progress = loadProgress(userId, clock.level)
  const db = getDb()
  const run = activeLeagueRun(userId)
  const champion = progress.cleared.has('league')
  // Campeão vê a Liga da revanche (ou a tentativa que já está em andamento).
  const leagueTrainers = leagueTrainersFor(run ? run.rematch : champion)
  const names = speciesNames(leagueTrainers.flatMap((trainer) => trainer.foes.map((foe) => foe.speciesId)))
  const members = run ? parseLeagueTeam(run.team) : []
  const memberIds = members.map((member) => member.pokemonId)
  const owned =
    memberIds.length === 0
      ? []
      : db
          .select({
            id: pokemon.id,
            nickname: pokemon.nickname,
            displayName: species.displayName,
          })
          .from(pokemon)
          .innerJoin(species, eq(pokemon.speciesId, species.id))
          .where(and(eq(pokemon.userId, userId), inArray(pokemon.id, memberIds)))
          .all()
  const ownedById = new Map(owned.map((row) => [row.id, row]))
  const wins = db
    .select({ id: leagueRuns.id })
    .from(leagueRuns)
    .where(and(eq(leagueRuns.userId, userId), eq(leagueRuns.status, 'won')))
    .all().length
  const roster = db
    .select({
      id: pokemon.id,
      nickname: pokemon.nickname,
      displayName: species.displayName,
      level: pokemon.level,
      hpRatio: pokemon.hpRatio,
      faintedAt: pokemon.faintedAt,
      hunger: pokemon.hunger,
    })
    .from(pokemon)
    .innerJoin(species, eq(pokemon.speciesId, species.id))
    .where(and(eq(pokemon.userId, userId), eq(pokemon.location, 'garden'), eq(pokemon.inPc, false), isNotNull(pokemon.teamSlot)))
    .orderBy(asc(pokemon.teamSlot))
    .all()
  return {
    champion,
    wins,
    /** Cargas da máquina de cura colocada com mais cargas; null = nenhuma no jardim. Cura antes de começar. */
    healCharges: bestHealCharges(userId, now),
    /** Pós-jogo: a próxima tentativa é revanche (times +nível, prêmio semanal). */
    rematch: run ? run.rematch : champion,
    rematchReward: champion
      ? {
          items: [
            ...leagueConfig.rematchRewards.items.map(rewardLabel),
            `${leagueConfig.rematchRewards.genericCandies} doces`,
          ],
          /** Já venceu a revanche nesta semana: o prêmio volta na segunda. */
          taken: rematchRewardTaken(userId, now),
          resetsAt: weekStartAt(now) + 7 * 24 * 60 * 60 * 1000,
        }
      : null,
    trainers: leagueTrainers.map((trainer) => ({
      key: trainer.key,
      name: trainer.name,
      kind: trainer.kind,
      foes: trainer.foes.map((foe) => ({
        speciesId: foe.speciesId,
        displayName: names.get(foe.speciesId) ?? String(foe.speciesId),
        level: foe.level,
        ace: foe.ace ?? false,
      })),
    })),
    run: run
      ? {
          stage: run.stage,
          trainerName: leagueTrainers[run.stage]?.name ?? '',
          team: members.map((member) => ({
            pokemonId: member.pokemonId,
            name: ownedById.get(member.pokemonId)?.nickname || ownedById.get(member.pokemonId)?.displayName || 'Pokémon',
            hpRatio: member.hpRatio,
          })),
        }
      : null,
    roster: roster.map((mon) => ({
      pokemonId: mon.id,
      name: mon.nickname || mon.displayName,
      level: mon.level,
      hpRatio: clampRatio(mon.hpRatio),
      fainted: mon.faintedAt != null || mon.hpRatio <= 0,
      hungry: mon.hunger < petConfig.fightMinHunger,
    })),
  }
}

function bestHealCharges(userId: number, now: number): number | null {
  const placed = healMachinesView(userId, now).filter((machine) => machine.placed)
  return placed.length === 0 ? null : Math.max(...placed.map((machine) => machine.charges))
}

function speciesNames(ids: number[]): Map<number, string> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  return new Map(
    getDb()
      .select({ id: species.id, displayName: species.displayName })
      .from(species)
      .all()
      .filter((row) => unique.includes(row.id))
      .map((row) => [row.id, row.displayName] as const),
  )
}

function startLeague(userId: number, pokemonIds: number[], now: number) {
  const clock = persistCatchUp(userId, now)
  const progress = loadProgress(userId, clock.level)
  if (!chapterOpen(9, progress)) return fail('milestone_locked', 400)
  if (currentPlaceOf(userId) !== 'indigo-plateau') return fail('milestone_not_here', 400)
  if (activeLeagueRun(userId)) return fail('league_active', 409)
  if (pendingEncounter(userId)) return fail('encounter_pending', 409)
  if (pokemonIds.length < 1 || pokemonIds.length > trainerConfig.teamMax || new Set(pokemonIds).size !== pokemonIds.length) {
    return fail('invalid_team', 400)
  }
  const rows = getDb()
    .select({
      id: pokemon.id,
      hpRatio: pokemon.hpRatio,
      faintedAt: pokemon.faintedAt,
      hunger: pokemon.hunger,
      teamSlot: pokemon.teamSlot,
      location: pokemon.location,
      inPc: pokemon.inPc,
    })
    .from(pokemon)
    .where(and(eq(pokemon.userId, userId)))
    .all()
  const byId = new Map(rows.map((row) => [row.id, row]))
  const members: LeagueMember[] = []
  for (const id of pokemonIds) {
    const row = byId.get(id)
    if (!row || row.teamSlot == null || row.location !== 'garden' || row.inPc) return fail('invalid_team', 400)
    if (row.faintedAt != null || row.hpRatio <= 0) return fail('team_fainted', 400)
    if (row.hunger < petConfig.fightMinHunger) return fail('team_hungry', 400)
    members.push({ pokemonId: id, hpRatio: clampRatio(row.hpRatio) })
  }
  // Já campeão: a tentativa é a revanche.
  insertLeagueRun(userId, members, now, progress.cleared.has('league'))
  // Começar já abre a primeira luta: um toque a menos (escolher o time → luta).
  const first = nextLeagueFight(userId, now)
  if (!first.ok) return first
  return { ok: true as const, view: { ...leagueView(userId, now), encounter: first.encounter } }
}

function nextLeagueFight(userId: number, now: number) {
  persistCatchUp(userId, now)
  const run = activeLeagueRun(userId)
  if (!run) return fail('league_not_active', 400)
  if (pendingEncounter(userId)) return fail('encounter_pending', 409)
  const members = parseLeagueTeam(run.team)
  if (!members.some((member) => member.hpRatio > 0)) {
    loseLeagueRun(run.id, members, now)
    return fail('league_lost', 400)
  }
  const trainer = leagueTrainersFor(run.rematch)[run.stage]
  if (!trainer) return fail('league_not_active', 400)
  return { ok: true as const, encounter: createTrainerEncounter(userId, trainer, 'indigo-plateau', now) }
}

/**
 * Desistir encerra a Liga inteira de uma vez: o encontro da etapa (se ainda
 * não começou a luta) é fechado junto. Luta em andamento termina na luta.
 */
function abandonLeague(userId: number, now: number) {
  persistCatchUp(userId, now)
  if (!activeLeagueRun(userId)) return fail('league_not_active', 400)
  const pending = getDb()
    .select({ id: encounters.id, leaderKey: encounters.leaderKey, battleStartedAt: encounters.battleStartedAt })
    .from(encounters)
    .where(and(eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
  if (pending) {
    const trainer = pending.leaderKey ? trainerByKey(pending.leaderKey) : undefined
    const isLeague = trainer?.kind === 'elite' || trainer?.kind === 'champion'
    if (!isLeague) return fail('encounter_pending', 409)
    if (pending.battleStartedAt !== null) return fail('battle_in_progress', 409)
    getDb()
      .update(encounters)
      .set({ status: 'fled', resolvedAt: now })
      .where(and(eq(encounters.id, pending.id), eq(encounters.status, 'pending')))
      .run()
  }
  if (!abandonLeagueRun(userId, now)) return fail('league_not_active', 400)
  return { ok: true as const }
}

function pendingEncounter(userId: number) {
  return getDb()
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
}
