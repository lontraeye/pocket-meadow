import { and, asc, eq } from 'drizzle-orm'
import { SqliteError } from 'better-sqlite3'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { battleConfig } from '../config/battle.js'
import { placeBySlug } from '../config/places.js'
import { regionBySlug, regionOpen, type Region } from '../config/regions.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { loadProgress } from '../db/milestones.js'
import { fieldSpawns, species } from '../db/schema.js'
import { rollWild } from '../game/battle.js'
import { mulberry32, randomSeed } from '../game/rng.js'
import { createEncounter, markSeen, peekBonus } from './encounters.js'
import { type Failure, fail, parseSlot } from './http.js'
import { currentPlaceOf } from './places.js'

// Campo de encontro (PLANNING.md 5.14, JORNADA.md seção 11): ao entrar numa
// área, alguns Pokémon dela andam no gramado e o jogador escolhe quem
// enfrentar. O campo é vivo: quem é enfrentado sai e outro entra na vaga. Cada
// um é sorteado e salvo antes de aparecer (sem rerolar) e já conta como visto.

export const fieldRoutes = new Hono<AuthEnv>()

fieldRoutes.get('/', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => fieldView(userId, now))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.field)
})

fieldRoutes.post('/:slot/engage', requireUser, (c) => {
  const slot = parseSlot(c.req.param('slot'))
  if (slot === null) return c.json({ error: 'spawn_not_found' }, 404)
  const userId = c.get('userId')
  const now = Date.now()
  try {
    const result = immediate(() => engage(userId, slot, now))
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json(result.encounter, 201)
  } catch (error) {
    if (error instanceof SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'encounter_pending' }, 409)
    }
    throw error
  }
})

/** A área onde o jogador está, se for uma área aberta com mato. */
function hereArea(userId: number, level: number): { ok: true; region: Region } | Failure {
  const here = currentPlaceOf(userId)
  const place = placeBySlug(here)
  const region = regionBySlug(here)
  if (!place || place.kind !== 'area' || !region) return fail('no_field_here', 400)
  if (!regionOpen(region, loadProgress(userId, level))) return fail('region_locked', 400)
  return { ok: true, region }
}

/**
 * Sorteia um Pokémon para a vaga e salva. A semente fica com ele: o encontro
 * usa a mesma, então o selvagem sai igual no replay. Razz e Lum valem no
 * sorteio (lidos sem gastar); a carga é gasta quando o encontro começa.
 */
function spawn(userId: number, region: Region, slot: number, now: number): void {
  const rngSeed = randomSeed()
  const wild = rollWild(mulberry32(rngSeed), {
    slots: region.slots,
    shinyRate: Math.min(1, battleConfig.shinyRate * peekBonus(userId, 'shiny_boost')),
    rareMultiplier: peekBonus(userId, 'rare_boost'),
  })
  getDb()
    .insert(fieldSpawns)
    .values({
      userId,
      regionSlug: region.slug,
      slot,
      speciesId: wild.speciesId,
      level: wild.level,
      isShiny: wild.isShiny,
      rngSeed,
      createdAt: now,
    })
    .run()
  markSeen(userId, wild.speciesId, now)
}

/** Completa as vagas que faltam (campo novo ou depois de um encontro). */
function fill(userId: number, region: Region, now: number): void {
  const taken = new Set(
    getDb()
      .select({ slot: fieldSpawns.slot })
      .from(fieldSpawns)
      .where(and(eq(fieldSpawns.userId, userId), eq(fieldSpawns.regionSlug, region.slug)))
      .all()
      .map((row) => row.slot),
  )
  for (let slot = 0; slot < battleConfig.fieldSize; slot += 1) {
    if (!taken.has(slot)) spawn(userId, region, slot, now)
  }
}

function fieldView(userId: number, now: number) {
  const clock = persistCatchUp(userId, now)
  const area = hereArea(userId, clock.level)
  if (!area.ok) return area
  fill(userId, area.region, now)
  const spawns = getDb()
    .select({
      id: fieldSpawns.id,
      slot: fieldSpawns.slot,
      speciesId: fieldSpawns.speciesId,
      level: fieldSpawns.level,
      isShiny: fieldSpawns.isShiny,
      displayName: species.displayName,
      type1: species.type1,
      type2: species.type2,
    })
    .from(fieldSpawns)
    .innerJoin(species, eq(species.id, fieldSpawns.speciesId))
    .where(and(eq(fieldSpawns.userId, userId), eq(fieldSpawns.regionSlug, area.region.slug)))
    .orderBy(asc(fieldSpawns.slot))
    .all()
  return { ok: true as const, field: { regionSlug: area.region.slug, spawns } }
}

function engage(userId: number, slot: number, now: number) {
  const clock = persistCatchUp(userId, now)
  const area = hereArea(userId, clock.level)
  if (!area.ok) return area
  const db = getDb()
  const chosen = db
    .select()
    .from(fieldSpawns)
    .where(
      and(eq(fieldSpawns.userId, userId), eq(fieldSpawns.regionSlug, area.region.slug), eq(fieldSpawns.slot, slot)),
    )
    .get()
  if (!chosen) return fail('spawn_not_found', 404)

  const created = createEncounter(
    userId,
    area.region,
    now,
    { speciesId: chosen.speciesId, level: chosen.level, isShiny: chosen.isShiny },
    { rngSeed: chosen.rngSeed, countSeen: false },
  )
  if (!created.ok) return created
  // Saiu do gramado para a luta; outro entra na vaga.
  db.delete(fieldSpawns).where(eq(fieldSpawns.id, chosen.id)).run()
  spawn(userId, area.region, slot, now)
  return created
}
