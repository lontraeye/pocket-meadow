import { SqliteError } from 'better-sqlite3'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { leagueTrainers } from '../config/league.js'
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
  type LeagueMember,
} from '../db/league.js'
import { loadProgress } from '../db/milestones.js'
import { encounters, leagueRuns, pokemon, species } from '../db/schema.js'
import { clampRatio } from '../game/heal.js'
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
  const names = speciesNames(leagueTrainers.flatMap((trainer) => trainer.foes.map((foe) => foe.speciesId)))
  const run = activeLeagueRun(userId)
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
    champion: progress.cleared.has('league'),
    wins,
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
  if (progress.cleared.has('league')) return fail('milestone_cleared', 409)
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
  insertLeagueRun(userId, members, now)
  return { ok: true as const, view: leagueView(userId, now) }
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
  const trainer = leagueTrainers[run.stage]
  if (!trainer) return fail('league_not_active', 400)
  return { ok: true as const, encounter: createTrainerEncounter(userId, trainer, 'indigo-plateau', now) }
}

function abandonLeague(userId: number, now: number) {
  persistCatchUp(userId, now)
  if (!activeLeagueRun(userId)) return fail('league_not_active', 400)
  if (pendingEncounter(userId)) return fail('encounter_pending', 409)
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
