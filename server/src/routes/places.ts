import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import {
  CHAPTER_TITLES,
  chapterOpen,
  linksOf,
  lockReason,
  placeBySlug,
  placeConfigs,
  START_PLACE,
} from '../config/places.js'
import { CHAPTER_MIN_LEVEL, regionBySlug } from '../config/regions.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { encounters, pokedexEntries, species, trainerPlaces, trainers } from '../db/schema.js'
import { type Failure, fail, readObject } from './http.js'

// Jornada: onde o treinador está, para onde pode ir e o que tem em cada lugar
// (JORNADA.md, seção 11). O servidor decide o que está aberto.

export const placeRoutes = new Hono<AuthEnv>()

type SpeciesStatus = 'caught' | 'seen' | 'unknown'

type DexRow = { seen: boolean; caught: boolean }

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
  return c.json({ current: result.current, firstVisit: result.firstVisit })
})

/** Lugar atual do treinador; volta ao início se o slug salvo sumiu do config. */
export function currentPlaceOf(userId: number): string {
  const row = getDb().select({ place: trainers.currentPlace }).from(trainers).where(eq(trainers.userId, userId)).get()
  const slug = row?.place ?? START_PLACE
  return placeBySlug(slug) ? slug : START_PLACE
}

function travel(
  userId: number,
  to: string,
  now: number,
): { ok: true; current: string; firstVisit: boolean } | Failure {
  const clock = persistCatchUp(userId, now)
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
  if (to === here) return { ok: true, current: here, firstVisit: false }
  const link = linksOf(here).find((entry) => entry.to === to)
  if (!link) return fail('place_not_linked', 400)
  if (lockReason(target, clock.level, link.requires) !== null) return fail('place_locked', 400)

  db.update(trainers).set({ currentPlace: to, updatedAt: now }).where(eq(trainers.userId, userId)).run()
  const inserted = db
    .insert(trainerPlaces)
    .values({ userId, placeSlug: to, firstVisitAt: now })
    .onConflictDoNothing()
    .run()
  return { ok: true, current: to, firstVisit: inserted.changes === 1 }
}

function placesView(userId: number, now: number) {
  const clock = persistCatchUp(userId, now)
  const level = clock.level
  const db = getDb()
  const here = currentPlaceOf(userId)
  const visited = new Set(
    db
      .select({ slug: trainerPlaces.placeSlug })
      .from(trainerPlaces)
      .where(eq(trainerPlaces.userId, userId))
      .all()
      .map((row) => row.slug),
  )
  visited.add(here)
  const dex = new Map<number, DexRow>(
    db
      .select({ speciesId: pokedexEntries.speciesId, seen: pokedexEntries.seenCount, caught: pokedexEntries.caughtCount })
      .from(pokedexEntries)
      .where(eq(pokedexEntries.userId, userId))
      .all()
      .map((row) => [row.speciesId, { seen: row.seen > 0, caught: row.caught > 0 }]),
  )
  const statusOf = (speciesId: number): SpeciesStatus => {
    const row = dex.get(speciesId)
    return row?.caught ? 'caught' : row?.seen ? 'seen' : 'unknown'
  }
  const speciesIn = (slug: string): number[] => {
    const region = regionBySlug(slug)
    return region ? [...new Set(region.slots.map((slot) => slot.speciesId))] : []
  }

  const places = placeConfigs.map((place) => {
    const region = regionBySlug(place.slug)
    const ids = speciesIn(place.slug)
    const reason = lockReason(place, level)
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
      wildLevelRange: region ? region.wildLevelRange : null,
      speciesTotal: ids.length,
      speciesCaught: ids.filter((id) => statusOf(id) === 'caught').length,
      links: linksOf(place.slug).map((link) => {
        const target = placeBySlug(link.to)!
        const why = lockReason(target, level, link.requires)
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
    trainerLevel: level,
    chapter: chapterProgress(level, statusOf),
    places,
    here: { species: hereSpecies },
  }
}

function order(status: SpeciesStatus): number {
  return status === 'caught' ? 0 : status === 'seen' ? 1 : 2
}

/**
 * Objetivo do momento, até os marcos (parte 3): o maior capítulo aberto, quantas
 * espécies das áreas dele já foram capturadas e o nível que abre o próximo.
 */
function chapterProgress(level: number, statusOf: (id: number) => SpeciesStatus) {
  const chapters = [...new Set(placeConfigs.map((place) => place.chapter))].sort((a, b) => a - b)
  const current = [...chapters].reverse().find((chapter) => chapterOpen(chapter, level)) ?? chapters[0]!
  const ids = new Set<number>()
  for (const place of placeConfigs) {
    if (place.chapter !== current) continue
    const region = regionBySlug(place.slug)
    for (const slot of region?.slots ?? []) ids.add(slot.speciesId)
  }
  const next = chapters.find((chapter) => chapter > current) ?? null
  return {
    number: current,
    title: CHAPTER_TITLES[current] ?? `Capítulo ${current}`,
    caught: [...ids].filter((id) => statusOf(id) === 'caught').length,
    total: ids.size,
    nextChapter: next,
    nextTitle: next === null ? null : (CHAPTER_TITLES[next] ?? null),
    nextLevel: next === null ? null : (CHAPTER_MIN_LEVEL[next] ?? null),
  }
}
