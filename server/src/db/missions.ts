import { and, eq, lt, sql } from 'drizzle-orm'
import { currentChapter } from '../config/milestones.js'
import { type MissionKind, type MissionReward, missionConfig } from '../config/missions.js'
import { loadRegions, regionOpen } from '../config/regions.js'
import { apricornConfig } from '../config/apricorn.js'
import { trainerXpToNext } from '../config/trainer.js'
import { pickSeedByWeight } from '../game/berries.js'
import { type MissionContext, type MissionParams, drawDay, drawMission, missionText } from '../game/missions.js'
import { mulberry32, randomSeed } from '../game/rng.js'
import { nextWeatherChangeAt, weatherDay } from '../game/weather.js'
import { grantXp } from '../game/xp.js'
import { getDb, getSqlite } from './client.js'
import { sumEvents } from './events.js'
import { creditItems, grantTrainerLevelRewards } from './inventory.js'
import { loadProgress } from './milestones.js'
import { dailyMissions, missionDays, pokedexEntries, species, trainers } from './schema.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** Dia de Brasília (o mesmo do clima) como AAAA-MM-DD. */
export function missionDay(now: number): string {
  return new Date(weatherDay(now) * DAY_MS).toISOString().slice(0, 10)
}

/** O que o sorteio olha: áreas abertas do capítulo atual, tipos delas, tipos do time. */
export function missionContext(userId: number, level: number): MissionContext {
  const progress = loadProgress(userId, level)
  const chapter = currentChapter(progress)
  const open = loadRegions().filter((region) => region.gameRegion === 'johto' && region.slots.length > 0 && regionOpen(region, progress))
  const current = open.filter((region) => region.chapter === chapter)
  const areas = current.length > 0 ? current : open
  const speciesIds = new Set(areas.flatMap((region) => region.slots.map((slot) => slot.speciesId)))
  const types = new Set<string>()
  if (speciesIds.size > 0) {
    for (const row of getDb().select({ id: species.id, type1: species.type1, type2: species.type2 }).from(species).all()) {
      if (!speciesIds.has(row.id)) continue
      types.add(row.type1)
      if (row.type2) types.add(row.type2)
    }
  }
  const caught = new Set(
    getDb()
      .select({ id: pokedexEntries.speciesId })
      .from(pokedexEntries)
      .where(and(eq(pokedexEntries.userId, userId), sql`${pokedexEntries.caughtCount} > 0`))
      .all()
      .map((row) => row.id),
  )
  return {
    level,
    areas: areas.map((region) => ({ slug: region.slug, name: region.name })),
    areaTypes: [...types].sort(),
    teamTypes: [...progress.teamTypes].sort(),
    hasNewSpecies: [...speciesIds].some((id) => !caught.has(id)),
    gardenOpen: level >= apricornConfig.unlockLevel,
  }
}

type MissionRow = typeof dailyMissions.$inferSelect

/** Garante as missões do dia (sorteadas e gravadas antes de aparecer). Chamar em transação. */
export function ensureMissionDay(userId: number, level: number, now: number): string {
  const db = getDb()
  const day = missionDay(now)
  const existing = db
    .select({ id: dailyMissions.id })
    .from(dailyMissions)
    .where(and(eq(dailyMissions.userId, userId), eq(dailyMissions.day, day)))
    .get()
  if (existing) return day
  const oldest = missionDay(now - missionConfig.keepDays * DAY_MS)
  db.delete(dailyMissions).where(and(eq(dailyMissions.userId, userId), lt(dailyMissions.day, oldest))).run()
  db.delete(missionDays).where(and(eq(missionDays.userId, userId), lt(missionDays.day, oldest))).run()
  const drafts = drawDay(missionContext(userId, level), mulberry32(randomSeed()))
  drafts.forEach((draft, slot) => {
    db.insert(dailyMissions)
      .values({ userId, day, slot, kind: draft.kind, params: JSON.stringify(draft.params), target: draft.target, assignedAt: now })
      .run()
  })
  db.insert(missionDays).values({ userId, day }).onConflictDoNothing().run()
  return day
}

/** Quanto da missão já foi feito (contado no que veio depois de ela aparecer). */
export function missionProgress(userId: number, row: Pick<MissionRow, 'kind' | 'params' | 'assignedAt'>): number {
  const sqlite = getSqlite()
  const params = JSON.parse(row.params) as MissionParams
  const since = row.assignedAt
  const count = (query: string, ...args: unknown[]) => (sqlite.prepare(query).get(...args) as { n: number }).n
  switch (row.kind as MissionKind) {
    case 'win_any':
      return count('select count(*) n from encounters where user_id = ? and won_at >= ?', userId, since)
    case 'win_area':
      return count('select count(*) n from encounters where user_id = ? and won_at >= ? and region_slug = ?', userId, since, params.region ?? '')
    case 'catch_any':
      return count("select count(*) n from encounters where user_id = ? and status = 'caught' and resolved_at >= ?", userId, since)
    case 'catch_type':
      return count(
        `select count(*) n from encounters e join species s on s.id = e.species_id
         where e.user_id = ? and e.status = 'caught' and e.resolved_at >= ? and (s.type1 = ? or s.type2 = ?)`,
        userId,
        since,
        params.type ?? '',
        params.type ?? '',
      )
    case 'catch_new':
      return count('select count(*) n from pokedex_entries where user_id = ? and first_caught_at >= ?', userId, since)
    case 'win_with_type':
      return count(
        `select count(distinct e.id) n from encounters e
         join encounter_fighters f on f.encounter_id = e.id
         join pokemon p on p.id = f.pokemon_id
         join species s on s.id = p.species_id
         where e.user_id = ? and e.won_at >= ? and (s.type1 = ? or s.type2 = ?)`,
        userId,
        since,
        params.type ?? '',
        params.type ?? '',
      )
    case 'harvest_apricorn':
      return sumEvents(userId, 'apricorn_harvest', since)
    case 'make_balls':
      return sumEvents(userId, 'balls_made', since)
    case 'harvest_berries':
      return sumEvents(userId, 'berry_harvest', since)
    case 'feed_pets':
      return sumEvents(userId, 'pet_fed', since)
  }
}

export type MissionView = {
  id: number
  slot: number
  kind: MissionKind
  text: string
  progress: number
  target: number
  done: boolean
  claimed: boolean
  reward: MissionReward
  /** Área da missão (o mapa pode levar até ela). */
  region: string | null
}

export type MissionsView = {
  day: string
  renewsAt: number
  list: MissionView[]
  chest: { ready: boolean; claimed: boolean; reward: MissionReward }
  rerollsLeft: number
  /** Missões completas esperando resgate (+1 se o baú está pronto): o selo do botão. */
  claimable: number
}

export function missionsView(userId: number, level: number, now: number): MissionsView {
  const db = getDb()
  const day = ensureMissionDay(userId, level, now)
  const rows = db
    .select()
    .from(dailyMissions)
    .where(and(eq(dailyMissions.userId, userId), eq(dailyMissions.day, day)))
    .all()
    .sort((a, b) => a.slot - b.slot)
  const meta = db
    .select()
    .from(missionDays)
    .where(and(eq(missionDays.userId, userId), eq(missionDays.day, day)))
    .get()
  const list = rows.map((row): MissionView => {
    const params = JSON.parse(row.params) as MissionParams
    const progress = Math.min(row.target, missionProgress(userId, row))
    return {
      id: row.id,
      slot: row.slot,
      kind: row.kind as MissionKind,
      text: missionText(row.kind as MissionKind, params, row.target),
      progress,
      target: row.target,
      done: progress >= row.target,
      claimed: row.claimedAt !== null,
      reward: missionConfig.reward(row.kind as MissionKind, level),
      region: params.region ?? null,
    }
  })
  const allClaimed = list.length > 0 && list.every((mission) => mission.claimed)
  const chestClaimed = meta?.chestClaimedAt != null
  const chestReady = allClaimed && !chestClaimed
  return {
    day,
    renewsAt: nextWeatherChangeAt(now),
    list,
    chest: { ready: chestReady, claimed: chestClaimed, reward: missionConfig.chest(level) },
    rerollsLeft: Math.max(0, missionConfig.rerollsPerDay - (meta?.rerollsUsed ?? 0)),
    claimable: list.filter((mission) => mission.done && !mission.claimed).length + (chestReady ? 1 : 0),
  }
}

export type GrantedReward = {
  trainerXp: number
  genericCandies: number
  items: { itemKey: string; quantity: number }[]
  trainer: { level: number; xp: number; levelsGained: number }
  levelRewards: { itemKey: string; quantity: number }[]
}

/** Entrega uma recompensa (XP de treinador com recompensas de nível, doces, itens). Em transação. */
export function grantMissionReward(userId: number, reward: MissionReward, now: number): GrantedReward {
  const db = getDb()
  const trainer = db.select().from(trainers).where(eq(trainers.userId, userId)).get()
  if (!trainer) throw new Error(`trainer missing for user ${userId}`)
  const items = [...reward.items]
  if (reward.randomSeed) items.push({ itemKey: `seed:${pickSeedByWeight(mulberry32(randomSeed()))}`, quantity: 1 })
  creditItems(userId, items)
  const next = grantXp(trainer.level, trainer.xp, reward.trainerXp, trainerXpToNext)
  const levelRewards = next.levelsGained > 0 ? grantTrainerLevelRewards(userId, trainer.level, next.level) : []
  db.update(trainers)
    .set({
      level: next.level,
      xp: next.xp,
      genericCandies: trainer.genericCandies + reward.genericCandies,
      updatedAt: now,
    })
    .where(eq(trainers.userId, userId))
    .run()
  return { trainerXp: reward.trainerXp, genericCandies: reward.genericCandies, items, trainer: next, levelRewards }
}

/** Troca uma missão ainda não resgatada por outra de tipo diferente das do dia. */
export function rerollMission(userId: number, level: number, row: MissionRow, now: number): boolean {
  const db = getDb()
  const others = db
    .select({ kind: dailyMissions.kind })
    .from(dailyMissions)
    .where(and(eq(dailyMissions.userId, userId), eq(dailyMissions.day, row.day)))
    .all()
    .map((other) => other.kind as MissionKind)
  const draft = drawMission(missionContext(userId, level), mulberry32(randomSeed()), new Set(others))
  if (!draft) return false
  db.update(dailyMissions)
    .set({ kind: draft.kind, params: JSON.stringify(draft.params), target: draft.target, assignedAt: now })
    .where(eq(dailyMissions.id, row.id))
    .run()
  return true
}
