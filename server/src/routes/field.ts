import { and, asc, eq } from 'drizzle-orm'
import { SqliteError } from 'better-sqlite3'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { battleConfig } from '../config/battle.js'
import { dropsOf, spotDropsConfig } from '../config/spotDrops.js'
import { trainerConfig } from '../config/trainer.js'
import { bestRod, type Progress, RODS, toolBlock } from '../config/milestones.js'
import { placeBySlug } from '../config/places.js'
import { type FieldMethod, methodSlots, regionBySlug, regionOpen, type Region, type RegionSlot } from '../config/regions.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { loadProgress } from '../db/milestones.js'
import { creditItems } from '../db/inventory.js'
import { encounters, fieldSpawns, species, trainers } from '../db/schema.js'
import { rollWeighted, rollWild } from '../game/battle.js'
import { mulberry32, randomSeed } from '../game/rng.js'
import { createEncounter, markSeen, peekBonus } from './encounters.js'
import { type Failure, fail, parseSlot, readObject } from './http.js'
import { currentPlaceOf } from './places.js'

// Campo de encontro (PLANNING.md 5.14, JORNADA.md seção 11): ao entrar numa
// área, alguns Pokémon dela andam no gramado e o jogador escolhe quem
// enfrentar. Quem é enfrentado sai do campo e a vaga fica vazia; os outros
// ficam. O campo se enche ao chegar na área (se estiver vazio) ou pelo
// "Explorar de novo", que só vale com o campo vazio. Cada um é sorteado e salvo
// antes de aparecer (sem rerolar) e já conta como visto.
//
// Lugar só de água (rotas do mar, lagos): quem nada no campo vem da tabela de
// Surf, e só com o Surf liberado; sem ele o campo fica vazio, com o motivo.
//
// Manchas (JORNADA.md, seção 4): água (só pesca), árvore e pedra, quando a
// área tem a tabela do método. Usar a ferramenta sorteia na hora, da tabela dela, e já
// começa o encontro (o Pokémon só se revela quando morde, cai ou sai da pedra).
// Árvore e pedra às vezes soltam um item no lugar do Pokémon (spotDrops.ts).

export const fieldRoutes = new Hono<AuthEnv>()

fieldRoutes.get('/', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => fieldView(userId, now))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.field)
})

fieldRoutes.post('/use', requireUser, async (c) => {
  const body = await readObject(c)
  if (!body || typeof body.method !== 'string') return c.json({ error: 'invalid_body' }, 400)
  const method = body.method as FieldMethod
  const userId = c.get('userId')
  const now = Date.now()
  try {
    const result = immediate(() => useSpot(userId, method, now))
    if (!result.ok) return c.json({ error: result.error }, result.status)
    if ('drop' in result) return c.json({ drop: result.drop })
    return c.json(result.encounter, 201)
  } catch (error) {
    if (error instanceof SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'encounter_pending' }, 409)
    }
    throw error
  }
})

fieldRoutes.post('/explore', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => explore(userId, now))
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

/** A área (ou água) onde o jogador está, se estiver aberta. */
function hereArea(userId: number, level: number): { ok: true; region: Region; progress: Progress } | Failure {
  const here = currentPlaceOf(userId)
  const place = placeBySlug(here)
  const region = regionBySlug(here)
  if (!place || place.kind === 'town' || !region) return fail('no_field_here', 400)
  const progress = loadProgress(userId, level)
  if (!regionOpen(region, progress)) return fail('region_locked', 400)
  return { ok: true, region, progress }
}

type SpotKind = 'water' | 'tree' | 'rock'
type SpotAction = { method: FieldMethod; label: string; open: boolean; reason: string | null }
export type FieldSpot = { kind: SpotKind; actions: SpotAction[] }

function action(method: FieldMethod, label: string, progress: Progress): SpotAction {
  const reason = toolBlock(method, progress)
  return { method, label, open: reason === null, reason }
}

/**
 * As manchas da área e o que dá para fazer em cada uma. Pesca: a melhor vara
 * que o jogador tem e que a água da área aceita; sem vara, a Velha, fechada.
 */
export function spotsOf(region: Region, progress: Progress): FieldSpot[] {
  const spots: FieldSpot[] = []
  const water: SpotAction[] = []
  const rods = RODS.filter((rod) => region.methods[rod])
  if (rods.length > 0) {
    const best = bestRod(progress)
    const usable = best ? rods.filter((rod) => RODS.indexOf(rod) <= RODS.indexOf(best)) : []
    const rod = usable.at(-1) ?? rods[0]!
    water.push(action(rod, 'Pescar', progress))
  }
  if (water.length > 0) spots.push({ kind: 'water', actions: water })
  if (region.methods.headbutt) spots.push({ kind: 'tree', actions: [action('headbutt', 'Sacudir a árvore', progress)] })
  if (region.methods.rockSmash) spots.push({ kind: 'rock', actions: [action('rockSmash', 'Quebrar a pedra', progress)] })
  return spots
}

/**
 * De onde vêm os Pokémon do campo: o mato; no lugar só de água, o Surf (se
 * der para usar). `block` diz por que o campo de água está fechado.
 */
function fieldSource(region: Region, progress: Progress): { slots: readonly RegionSlot[]; block: string | null } {
  if (region.slots.length > 0) return { slots: region.slots, block: null }
  if (!region.methods.surf) return { slots: [], block: null }
  const block = toolBlock('surf', progress)
  return block ? { slots: [], block } : { slots: methodSlots(region, 'surf'), block: null }
}

/**
 * Sorteia um Pokémon para a vaga e salva. A semente fica com ele: o encontro
 * usa a mesma, então o selvagem sai igual no replay. Razz e Lum valem no
 * sorteio (lidos sem gastar); a carga é gasta quando o encontro começa.
 */
function spawn(userId: number, region: Region, slots: readonly RegionSlot[], slot: number, now: number): void {
  const rngSeed = randomSeed()
  const wild = rollWild(mulberry32(rngSeed), {
    slots,
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

function isEmpty(userId: number, region: Region): boolean {
  const row = getDb()
    .select({ id: fieldSpawns.id })
    .from(fieldSpawns)
    .where(and(eq(fieldSpawns.userId, userId), eq(fieldSpawns.regionSlug, region.slug)))
    .get()
  return row === undefined
}

/**
 * Enche o campo, só se estiver vazio (os que já estão ficam até serem
 * enfrentados). Lugar só de água: enche pelo Surf, se der. Devolve se encheu.
 */
function fillIfEmpty(userId: number, region: Region, progress: Progress, now: number): boolean {
  const { slots } = fieldSource(region, progress)
  if (slots.length === 0 || !isEmpty(userId, region)) return false
  for (let slot = 0; slot < battleConfig.fieldSize; slot += 1) spawn(userId, region, slots, slot, now)
  return true
}

/** Chegou numa área (viagem): o campo vazio se enche. Cidade ou área fechada: nada. */
export function fillOnArrival(userId: number, slug: string, progress: Progress, now: number): void {
  const place = placeBySlug(slug)
  const region = regionBySlug(slug)
  if (!place || place.kind === 'town' || !region || !regionOpen(region, progress)) return
  fillIfEmpty(userId, region, progress, now)
}

function explore(userId: number, now: number) {
  const clock = persistCatchUp(userId, now)
  const area = hereArea(userId, clock.level)
  if (!area.ok) return area
  if (fieldSource(area.region, area.progress).slots.length === 0) return fail('no_field_here', 400)
  if (!fillIfEmpty(userId, area.region, area.progress, now)) return fail('field_not_empty', 409)
  return fieldView(userId, now)
}

function fieldView(userId: number, now: number) {
  const clock = persistCatchUp(userId, now)
  const area = hereArea(userId, clock.level)
  if (!area.ok) return area
  const source = fieldSource(area.region, area.progress)
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
  return {
    ok: true as const,
    field: {
      regionSlug: area.region.slug,
      spawns,
      spots: spotsOf(area.region, area.progress),
      // Campo vazio numa área com mato: dá para explorar de novo.
      canExplore: spawns.length === 0 && source.slots.length > 0,
      // Lugar só de água sem Surf: por que ninguém nada aqui.
      fieldBlock: source.block,
    },
  }
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
  // Saiu do gramado para a luta; a vaga fica vazia (os outros continuam).
  db.delete(fieldSpawns).where(eq(fieldSpawns.id, chosen.id)).run()
  return created
}

/** Usa a ferramenta numa mancha: sorteia da tabela do método e começa o encontro. */
function useSpot(userId: number, method: FieldMethod, now: number) {
  const clock = persistCatchUp(userId, now)
  const area = hereArea(userId, clock.level)
  if (!area.ok) return area
  const chosen = spotsOf(area.region, area.progress)
    .flatMap((spot) => spot.actions)
    .find((entry) => entry.method === method)
  if (!chosen) return fail('spot_not_found', 404)
  if (!chosen.open) return fail('tool_locked', 400)

  if (dropsOf(method)) {
    const rng = mulberry32(randomSeed())
    if (rng() < spotDropsConfig.chance) {
      const table = spotDropsConfig.tables[method].map((row, index) => ({ ...row, speciesId: index + 1 }))
      return dropItem(userId, clock.energy, rollWeighted(table, rng).itemKey, now)
    }
  }

  const rngSeed = randomSeed()
  const wild = rollWild(mulberry32(rngSeed), {
    slots: methodSlots(area.region, method),
    shinyRate: Math.min(1, battleConfig.shinyRate * peekBonus(userId, 'shiny_boost')),
    rareMultiplier: peekBonus(userId, 'rare_boost'),
  })
  return createEncounter(userId, area.region, now, wild, { rngSeed })
}

/**
 * Caiu um item em vez de um Pokémon: gasta a energia como um encontro (com as
 * mesmas travas: sem encontro pendente, com energia) e credita o item.
 */
function dropItem(userId: number, energy: number, itemKey: string, now: number) {
  const db = getDb()
  const pending = db
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
  if (pending) return fail('encounter_pending', 409)
  if (trainerConfig.energyEnabled && energy < 1) return fail('no_energy', 400)
  if (trainerConfig.energyEnabled) {
    db.update(trainers).set({ energy: energy - 1, updatedAt: now }).where(eq(trainers.userId, userId)).run()
  }
  creditItems(userId, [{ itemKey, quantity: 1 }])
  return { ok: true as const, drop: { itemKey, quantity: 1 } }
}
