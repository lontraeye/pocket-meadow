import { and, eq, inArray, sql } from 'drizzle-orm'
import { SqliteError } from 'better-sqlite3'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { battleConfig } from '../config/battle.js'
import { type Region, regionBySlug } from '../config/regions.js'
import { trainerCatchXp, trainerWinXp, trainerXpToNext } from '../config/trainer.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import {
  activeEffects,
  encounterFighters,
  encounters,
  pokedexEntries,
  pokemon,
  species,
  trainers,
} from '../db/schema.js'
import { creditItems, grantTrainerLevelRewards } from '../db/inventory.js'
import {
  catchChance,
  fighterXp,
  power,
  rollChance,
  rollWild,
  skipWildRolls,
  teamPower,
  winChance,
} from '../game/battle.js'
import { rollBattleSeed } from '../game/berries.js'
import { applyLevelMovesToPokemon } from '../game/levelMoves.js'
import { mulberry32, randomSeed } from '../game/rng.js'
import { traitColumns } from '../game/traitValues.js'
import { rollTraits, traitsRngSeed } from '../game/traits.js'
import { grantXp } from '../game/xp.js'
import { abilitiesFor, learnsetFor, movesByName } from '../seed/traitsData.js'
import { toEncounterView } from './encounterView.js'
import { type Failure, fail, parseId, readObject } from './http.js'

export const encounterRoutes = new Hono<AuthEnv>()

encounterRoutes.post('/', requireUser, async (c) => {
  const body = await readObject(c)
  if (!body || typeof body.regionSlug !== 'string') return c.json({ error: 'invalid_body' }, 400)
  const region = regionBySlug(body.regionSlug)
  if (!region) return c.json({ error: 'region_not_found' }, 404)

  const userId = c.get('userId')
  const now = Date.now()
  try {
    const result = immediate(() => createEncounter(userId, region, now))
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json(result.encounter, 201)
  } catch (error) {
    if (error instanceof SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'encounter_pending' }, 409)
    }
    throw error
  }
})

encounterRoutes.post('/:id/battle', requireUser, async (c) => {
  const encounterId = parseId(c.req.param('id'))
  if (encounterId === null) return c.json({ error: 'encounter_not_found' }, 404)
  const body = await readObject(c)
  if (!body || !Array.isArray(body.pokemonIds)) return c.json({ error: 'invalid_body' }, 400)
  const pokemonIds = parseTeam(body.pokemonIds)
  if (!pokemonIds) return c.json({ error: 'invalid_team' }, 400)

  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => resolveBattle(userId, encounterId, pokemonIds, now))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.battle)
})

encounterRoutes.post('/:id/flee', requireUser, (c) => {
  const encounterId = parseId(c.req.param('id'))
  if (encounterId === null) return c.json({ error: 'encounter_not_found' }, 404)
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => fleeEncounter(userId, encounterId, now))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ status: 'fled' as const, encounterId })
})

function createEncounter(userId: number, region: Region, now: number) {
  const clock = persistCatchUp(userId, now)
  if (clock.level < region.minTrainerLevel) return fail('region_locked', 400)
  const db = getDb()
  const pending = db
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
  if (pending) return fail('encounter_pending', 409)
  if (clock.energy < 1) return fail('no_energy', 400)

  const shinyBonus = takeBonus(userId, 'shiny_boost')
  const rareBonus = takeBonus(userId, 'rare_boost')
  const rngSeed = randomSeed()
  const rng = mulberry32(rngSeed)
  const wild = rollWild(rng, {
    slots: region.slots,
    shinyRate: Math.min(1, battleConfig.shinyRate * shinyBonus),
    rareMultiplier: rareBonus,
  })

  const spec = db
    .select({
      id: species.id,
      name: species.name,
      displayName: species.displayName,
      baseStatTotal: species.baseStatTotal,
    })
    .from(species)
    .where(eq(species.id, wild.speciesId))
    .get()
  if (!spec) throw new Error(`species ${wild.speciesId} is not seeded`)

  const expiresAt = now + battleConfig.encounterTtlMs
  const inserted = db
    .insert(encounters)
    .values({
      userId,
      regionSlug: region.slug,
      speciesId: spec.id,
      level: wild.level,
      isShiny: wild.isShiny,
      rngSeed,
      status: 'pending',
      createdAt: now,
      expiresAt,
    })
    .returning({ id: encounters.id })
    .get()
  if (!inserted) throw new Error('failed to create encounter')

  db.update(trainers)
    .set({
      energy: clock.energy - 1,
      totalEncounters: sql`${trainers.totalEncounters} + 1`,
      updatedAt: now,
    })
    .where(eq(trainers.userId, userId))
    .run()

  db.insert(pokedexEntries)
    .values({
      userId,
      speciesId: spec.id,
      seenCount: 1,
      caughtCount: 0,
      firstSeenAt: now,
      shinyCaught: false,
    })
    .onConflictDoUpdate({
      target: [pokedexEntries.userId, pokedexEntries.speciesId],
      set: { seenCount: sql`${pokedexEntries.seenCount} + 1` },
    })
    .run()

  return {
    ok: true as const,
    encounter: toEncounterView({
      id: inserted.id,
      regionSlug: region.slug,
      speciesId: spec.id,
      name: spec.name,
      displayName: spec.displayName,
      level: wild.level,
      isShiny: wild.isShiny,
      expiresAt,
      baseStatTotal: spec.baseStatTotal,
    }),
  }
}

function resolveBattle(userId: number, encounterId: number, pokemonIds: number[], now: number) {
  const clock = persistCatchUp(userId, now)
  const db = getDb()
  const encounter = db
    .select()
    .from(encounters)
    .where(and(eq(encounters.id, encounterId), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
  if (!encounter) return fail('encounter_not_found', 404)

  const rows = db
    .select({
      id: pokemon.id,
      speciesId: pokemon.speciesId,
      level: pokemon.level,
      xp: pokemon.xp,
      location: pokemon.location,
      fastMove: pokemon.fastMove,
      chargedMove: pokemon.chargedMove,
      baseStatTotal: species.baseStatTotal,
    })
    .from(pokemon)
    .innerJoin(species, eq(pokemon.speciesId, species.id))
    .where(and(eq(pokemon.userId, userId), inArray(pokemon.id, pokemonIds)))
    .all()
  if (rows.length !== pokemonIds.length) return fail('invalid_team', 400)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const team = []
  for (const id of pokemonIds) {
    const mon = byId.get(id)
    if (!mon || mon.location !== 'garden') return fail('invalid_team', 400)
    team.push(mon)
  }

  const wild = db
    .select({
      baseStatTotal: species.baseStatTotal,
      baseExperience: species.baseExperience,
      captureRate: species.captureRate,
    })
    .from(species)
    .where(eq(species.id, encounter.speciesId))
    .get()
  if (!wild) throw new Error(`species ${encounter.speciesId} missing`)

  const roster = team.map((mon) => ({ ...mon, power: power(mon.baseStatTotal, mon.level) }))
  const chance = winChance(teamPower(roster.map((mon) => mon.power)), power(wild.baseStatTotal, encounter.level))
  const rng = mulberry32(encounter.rngSeed)
  skipWildRolls(rng)
  const won = rollChance(chance, rng)

  db.insert(encounterFighters)
    .values(roster.map((mon, slot) => ({ encounterId: encounter.id, slot, pokemonId: mon.id, power: mon.power })))
    .run()

  const fighters = roster.map((mon) => {
    const share = won ? fighterXp(wild.baseExperience, encounter.level, mon.level, roster.length) : 0
    const granted = grantXp(mon.level, mon.xp, share)
    let moveOffers: ReturnType<typeof applyLevelMovesToPokemon>['offers'] = []
    if (share > 0) {
      db.update(pokemon)
        .set({ level: granted.level, xp: granted.xp })
        .where(and(eq(pokemon.id, mon.id), eq(pokemon.userId, userId)))
        .run()
      if (granted.levelsGained > 0 && mon.fastMove) {
        moveOffers = applyLevelMovesToPokemon({
          userId,
          pokemonId: mon.id,
          speciesId: mon.speciesId,
          fromLevel: mon.level,
          toLevel: granted.level,
          fastMove: mon.fastMove,
          chargedMove: mon.chargedMove,
        }).offers
      }
    }
    return {
      pokemonId: mon.id,
      xpGained: share,
      level: granted.level,
      xp: granted.xp,
      levelsGained: granted.levelsGained,
      moveOffers,
    }
  })

  let catchOdds: number | null = null
  let caught = false
  let caughtPokemonId: number | null = null
  let seedDrop: { itemKey: string; berryKey: string } | null = null
  if (won) {
    const bonus = takeBonus(userId, 'catch_boost')
    catchOdds = catchChance(wild.captureRate, bonus)
    caught = rollChance(catchOdds, rng)
    if (caught) {
      const traits = rollTraits(mulberry32(traitsRngSeed(encounter.rngSeed)), {
        level: encounter.level,
        learnset: learnsetFor(encounter.speciesId),
        abilities: abilitiesFor(encounter.speciesId),
        moves: movesByName(),
      })
      const inserted = db
        .insert(pokemon)
        .values({
          userId,
          speciesId: encounter.speciesId,
          level: encounter.level,
          isShiny: encounter.isShiny,
          caughtAt: now,
          caughtRegion: encounter.regionSlug,
          originalSpeciesId: encounter.speciesId,
          ...traitColumns(traits),
        })
        .returning({ id: pokemon.id })
        .get()
      if (!inserted) throw new Error('failed to catch pokemon')
      caughtPokemonId = inserted.id
      const pokedex = db
        .update(pokedexEntries)
        .set({
          caughtCount: sql`${pokedexEntries.caughtCount} + 1`,
          firstCaughtAt: sql`coalesce(${pokedexEntries.firstCaughtAt}, ${now})`,
          shinyCaught: sql`(${pokedexEntries.shinyCaught} or ${encounter.isShiny ? 1 : 0})`,
        })
        .where(and(eq(pokedexEntries.userId, userId), eq(pokedexEntries.speciesId, encounter.speciesId)))
        .run()
      if (pokedex.changes !== 1) throw new Error(`pokedex missing for species ${encounter.speciesId}`)
    }
    // Depois da captura: chance de semente e, se ganhou, qual (PLANNING.md §7).
    seedDrop = rollBattleSeed(rng)
    if (seedDrop) creditItems(userId, [{ itemKey: seedDrop.itemKey, quantity: 1 }])
  }

  const trainerXpGained = won ? trainerWinXp(encounter.level) + (caught ? trainerCatchXp(encounter.level) : 0) : 0
  const trainerNext = grantXp(clock.level, clock.xp, trainerXpGained, trainerXpToNext)
  const levelRewards =
    won && trainerNext.levelsGained > 0
      ? grantTrainerLevelRewards(userId, clock.level, trainerNext.level)
      : []
  if (won) {
    db.update(trainers)
      .set({
        level: trainerNext.level,
        xp: trainerNext.xp,
        ...(caught ? { totalCatches: sql`${trainers.totalCatches} + 1` } : {}),
        updatedAt: now,
      })
      .where(eq(trainers.userId, userId))
      .run()
  }

  const status = won ? (caught ? 'caught' : 'escaped') : 'lost'
  db.update(encounters)
    .set({
      status,
      winChance: chance,
      catchChance: catchOdds,
      caughtPokemonId,
      resolvedAt: now,
    })
    .where(and(eq(encounters.id, encounter.id), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .run()

  return {
    ok: true as const,
    battle: {
      encounterId: encounter.id,
      winChance: chance,
      won,
      catchChance: catchOdds,
      caught,
      status,
      fighters,
      trainerXpGained,
      trainer: {
        level: trainerNext.level,
        xp: trainerNext.xp,
        levelsGained: trainerNext.levelsGained,
      },
      seedDrop,
      levelRewards,
    },
  }
}

function fleeEncounter(userId: number, encounterId: number, now: number): { ok: true } | Failure {
  persistCatchUp(userId, now)
  const updated = getDb()
    .update(encounters)
    .set({ status: 'fled', resolvedAt: now })
    .where(and(eq(encounters.id, encounterId), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .run()
  if (updated.changes !== 1) return fail('encounter_not_found', 404)
  return { ok: true }
}

// Efeito por cargas: consome o mais antigo. Efeito só por tempo aplica o
// multiplicador e fica até o catch-up apagar. Sem efeito, o bônus é 1.
function takeBonus(userId: number, effectKey: string): number {
  const db = getDb()
  const rows = db
    .select()
    .from(activeEffects)
    .where(and(eq(activeEffects.userId, userId), eq(activeEffects.effectKey, effectKey)))
    .all()
    .sort((a, b) => a.id - b.id)
  const chosen = rows.find((row) => row.charges !== null) ?? rows[0]
  if (!chosen) return 1
  if (chosen.charges !== null) {
    if (chosen.charges <= 1) {
      db.delete(activeEffects).where(eq(activeEffects.id, chosen.id)).run()
    } else {
      db.update(activeEffects)
        .set({ charges: chosen.charges - 1 })
        .where(eq(activeEffects.id, chosen.id))
        .run()
    }
  }
  return chosen.multiplier
}

function parseTeam(value: unknown[]): number[] | null {
  if (value.length < 1 || value.length > 3) return null
  const ids: number[] = []
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry <= 0) return null
    ids.push(entry)
  }
  if (new Set(ids).size !== ids.length) return null
  return ids
}
