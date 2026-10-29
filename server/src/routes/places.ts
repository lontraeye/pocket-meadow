import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import {
  chapterOpen,
  currentChapter,
  milestoneByKey,
  milestoneOfChapter,
  type Progress,
  TOOL_NAMES,
  toolOpen,
} from '../config/milestones.js'
import { CHAPTER_TITLES, linksOf, lockReason, placeBySlug, placeConfigs, START_PLACE } from '../config/places.js'
import { regionBySlug } from '../config/regions.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { loadProgress } from '../db/milestones.js'
import { encounters, pokedexEntries, species, trainerMilestones, trainerPlaces, trainers } from '../db/schema.js'
import { type Failure, fail, readObject } from './http.js'

// Jornada: onde o treinador está, para onde pode ir, o que tem em cada lugar
// e o marco do capítulo (JORNADA.md, seções 6 e 11). O servidor decide o que
// está aberto.

export const placeRoutes = new Hono<AuthEnv>()

type SpeciesStatus = 'caught' | 'seen' | 'unknown'

placeRoutes.get('/', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  return c.json(immediate(() => placesView(userId, now)))
})

placeRoutes.post('/travel', requireUser, async (c) => {
  const body = await readObject(c)
  if (!body || typeof body.to !== 'string') return c.json({ error: 'invalid_body' }, 400)
  const to = body.to
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => travel(userId, to, now))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ current: result.current, firstVisit: result.firstVisit, flew: result.flew })
})

placeRoutes.post('/milestones/:key/claim', requireUser, (c) => {
  const key = c.req.param('key')
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => claimMilestone(userId, key, now))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.claimed)
})

/** Lugar atual do treinador; volta ao início se o slug salvo sumiu do config. */
export function currentPlaceOf(userId: number): string {
  const row = getDb().select({ place: trainers.currentPlace }).from(trainers).where(eq(trainers.userId, userId)).get()
  const slug = row?.place ?? START_PLACE
  return placeBySlug(slug) ? slug : START_PLACE
}

function visitedOf(userId: number, here: string): Set<string> {
  const visited = new Set(
    getDb()
      .select({ slug: trainerPlaces.placeSlug })
      .from(trainerPlaces)
      .where(eq(trainerPlaces.userId, userId))
      .all()
      .map((row) => row.slug),
  )
  visited.add(here)
  return visited
}

/** Voo: cidade já visitada e aberta, com o Voo liberado. */
function canFlyTo(slug: string, visited: ReadonlySet<string>, progress: Progress): boolean {
  const place = placeBySlug(slug)
  return (
    place !== undefined &&
    place.kind === 'town' &&
    visited.has(slug) &&
    toolOpen('fly', progress) &&
    lockReason(place, progress) === null
  )
}

function travel(
  userId: number,
  to: string,
  now: number,
): { ok: true; current: string; firstVisit: boolean; flew: boolean } | Failure {
  const clock = persistCatchUp(userId, now)
  const progress = loadProgress(userId, clock.level)
  const target = placeBySlug(to)
  if (!target) return fail('place_not_found', 404)
  const db = getDb()
  const pending = db
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
  if (pending) return fail('encounter_pending', 409)

  const here = currentPlaceOf(userId)
  if (to === here) return { ok: true, current: here, firstVisit: false, flew: false }
  const link = linksOf(here).find((entry) => entry.to === to)
  let flew = false
  if (link) {
    if (lockReason(target, progress, link.requires) !== null) return fail('place_locked', 400)
  } else if (canFlyTo(to, visitedOf(userId, here), progress)) {
    flew = true
  } else {
    return fail('place_not_linked', 400)
  }

  db.update(trainers).set({ currentPlace: to, updatedAt: now }).where(eq(trainers.userId, userId)).run()
  const inserted = db
    .insert(trainerPlaces)
    .values({ userId, placeSlug: to, firstVisitAt: now })
    .onConflictDoNothing()
    .run()
  return { ok: true, current: to, firstVisit: inserted.changes === 1, flew }
}

/** Espécies das áreas de um capítulo (sem repetir). */
function chapterSpecies(chapter: number): Set<number> {
  const ids = new Set<number>()
  for (const place of placeConfigs) {
    if (place.chapter !== chapter) continue
    for (const slot of regionBySlug(place.slug)?.slots ?? []) ids.add(slot.speciesId)
  }
  return ids
}

function claimMilestone(
  userId: number,
  key: string,
  now: number,
): { ok: true; claimed: { key: string; opens: number; grants: string[] } } | Failure {
  const clock = persistCatchUp(userId, now)
  const progress = loadProgress(userId, clock.level)
  const milestone = milestoneByKey(key)
  if (!milestone) return fail('milestone_not_found', 404)
  if (progress.cleared.has(key)) return fail('milestone_cleared', 409)
  if (!chapterOpen(milestone.chapter, progress)) return fail('milestone_locked', 400)
  if (currentPlaceOf(userId) !== milestone.town) return fail('milestone_not_here', 400)
  if (clock.level < milestone.minLevel) return fail('milestone_level', 400)

  getDb().insert(trainerMilestones).values({ userId, milestoneKey: key, clearedAt: now }).run()
  return {
    ok: true,
    claimed: {
      key,
      opens: milestone.chapter + 1,
      grants: (milestone.grants ?? []).map((tool) => TOOL_NAMES[tool]),
    },
  }
}

function placesView(userId: number, now: number) {
  const clock = persistCatchUp(userId, now)
  const progress = loadProgress(userId, clock.level)
  const db = getDb()
  const here = currentPlaceOf(userId)
  const visited = visitedOf(userId, here)
  const dex = new Map(
    db
      .select({ speciesId: pokedexEntries.speciesId, seen: pokedexEntries.seenCount, caught: pokedexEntries.caughtCount })
      .from(pokedexEntries)
      .where(eq(pokedexEntries.userId, userId))
      .all()
      .map((row) => [row.speciesId, { seen: row.seen > 0, caught: row.caught > 0 }] as const),
  )
  const statusOf = (speciesId: number): SpeciesStatus => {
    const row = dex.get(speciesId)
    return row?.caught ? 'caught' : row?.seen ? 'seen' : 'unknown'
  }
  const speciesIn = (slug: string): number[] => {
    const region = regionBySlug(slug)
    return region ? [...new Set(region.slots.map((slot) => slot.speciesId))] : []
  }
  const flyOpen = toolOpen('fly', progress)

  const places = placeConfigs.map((place) => {
    const region = regionBySlug(place.slug)
    const ids = speciesIn(place.slug)
    const reason = lockReason(place, progress)
    return {
      slug: place.slug,
      name: place.name,
      kind: place.kind,
      chapter: place.chapter,
      blurb: place.blurb,
      x: place.x,
      y: place.y,
      open: reason === null,
      reason,
      visited: visited.has(place.slug),
      flyable: flyOpen && place.slug !== here && canFlyTo(place.slug, visited, progress),
      wildLevelRange: region ? region.wildLevelRange : null,
      speciesTotal: ids.length,
      speciesCaught: ids.filter((id) => statusOf(id) === 'caught').length,
      links: linksOf(place.slug).map((link) => {
        const target = placeBySlug(link.to)!
        const why = lockReason(target, progress, link.requires)
        return { to: link.to, open: why === null, reason: why, isNew: why === null && !visited.has(link.to) }
      }),
    }
  })

  // Espécies do lugar atual: as não vistas vão sem id (o "?" da tela).
  const hereIds = speciesIn(here)
  const names = new Map(
    hereIds.length === 0
      ? []
      : db
          .select({ id: species.id, displayName: species.displayName })
          .from(species)
          .all()
          .filter((row) => hereIds.includes(row.id))
          .map((row) => [row.id, row.displayName] as const),
  )
  const hereSpecies = hereIds
    .map((id) => {
      const status = statusOf(id)
      return status === 'unknown'
        ? { speciesId: null, displayName: null, status }
        : { speciesId: id, displayName: names.get(id) ?? null, status }
    })
    .sort((a, b) => order(a.status) - order(b.status) || (a.speciesId ?? 0) - (b.speciesId ?? 0))

  return {
    current: here,
    trainerLevel: clock.level,
    canFly: flyOpen,
    goal: goalView(progress, here, statusOf),
    places,
    here: { species: hereSpecies },
  }
}

function order(status: SpeciesStatus): number {
  return status === 'caught' ? 0 : status === 'seen' ? 1 : 2
}

/** O objetivo do momento: o marco do capítulo aberto mais alto. */
function goalView(progress: Progress, here: string, statusOf: (id: number) => SpeciesStatus) {
  const chapter = currentChapter(progress)
  const ids = chapterSpecies(chapter)
  const caught = [...ids].filter((id) => statusOf(id) === 'caught').length
  const milestone = milestoneOfChapter(chapter)
  const open = milestone && !progress.cleared.has(milestone.key) ? milestone : null
  return {
    chapter,
    title: CHAPTER_TITLES[chapter] ?? `Capítulo ${chapter}`,
    caught,
    total: ids.size,
    milestone: open
      ? {
          key: open.key,
          name: open.name,
          typeLabel: open.typeLabel,
          town: open.town,
          townName: placeBySlug(open.town)?.name ?? open.town,
          needLevel: open.minLevel,
          level: progress.level,
          ready: progress.level >= open.minLevel,
          here: here === open.town,
          grants: (open.grants ?? []).map((tool) => TOOL_NAMES[tool]),
        }
      : null,
  }
}
