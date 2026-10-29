import { and, eq, inArray, sql } from 'drizzle-orm'
import { SqliteError } from 'better-sqlite3'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { ballItemKey, ballMultiplier, getBall, isMasterBall } from '../config/balls.js'
import { battleConfig, parseThrowQuality, throwAimMult, type ThrowQuality } from '../config/battle.js'
import { berryItemKey, getBerry } from '../config/berries.js'
import { type Region, regionBySlug } from '../config/regions.js'
import { trainerCatchXp, trainerWinXp, trainerXpToNext } from '../config/trainer.js'
import { persistCatchUp, type PlayerClock } from '../db/catchUp.js'
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
import { creditChainCandies, creditItems, debitItem, grantTrainerLevelRewards } from '../db/inventory.js'
import { battleXpSharers, catchChance, fighterXp, rollWild } from '../game/battle.js'
import { rollBattleSeed } from '../game/berries.js'
import {
  applyEvYield,
  buildBattleSetup,
  evYieldFromSpecies,
  runAutoEncounterBattle,
  runManualEncounterBattle,
  type TeamMonRow,
  type WildSpeciesRow,
} from '../game/encounterBattle.js'
import { applyLevelMovesToPokemon } from '../game/levelMoves.js'
import { bumpMaxLevelReached } from '../game/pokedex.js'
import { mulberry32, randomSeed } from '../game/rng.js'
import { isFinishTooEarly, simConfig } from '../game/sim/config.js'
import { battleRngSeed, seedDropRngSeed, wildTraitsSeed } from '../game/sim/seeds.js'
import { parseBattleSetup, serializeBattleSetup } from '../game/sim/setupJson.js'
import type { BattleEvent, BattleInput, BattleResult, BattleSetup } from '../game/sim/types.js'
import { calmAgitation, fleeChanceAt } from '../game/flee.js'
import { rollThrow } from '../game/throwCapture.js'
import { traitColumns } from '../game/traitValues.js'
import { rollTraits, type AbilitySlot } from '../game/traits.js'
import { grantXp } from '../game/xp.js'
import { abilitiesFor, learnsetFor, movesByName } from '../seed/traitsData.js'
import { toEncounterView } from './encounterView.js'
import { type Failure, fail, parseId, readObject } from './http.js'

export const encounterRoutes = new Hono<AuthEnv>()

type TeamBattleRow = TeamMonRow & {
  xp: number
  location: string
}

type WildBattleRow = WildSpeciesRow & {
  baseExperience: number
  captureRate: number
  evolutionChainId: number
}

type EncounterRow = typeof encounters.$inferSelect

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

encounterRoutes.post('/:id/battle/start', requireUser, async (c) => {
  const encounterId = parseId(c.req.param('id'))
  if (encounterId === null) return c.json({ error: 'encounter_not_found' }, 404)
  const body = await readObject(c)
  if (!body || !Array.isArray(body.pokemonIds)) return c.json({ error: 'invalid_body' }, 400)
  const pokemonIds = parseTeam(body.pokemonIds)
  if (!pokemonIds) return c.json({ error: 'invalid_team' }, 400)

  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => startBattle(userId, encounterId, pokemonIds, now))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.start)
})

encounterRoutes.post('/:id/battle/finish', requireUser, async (c) => {
  const encounterId = parseId(c.req.param('id'))
  if (encounterId === null) return c.json({ error: 'encounter_not_found' }, 404)
  const body = await readObject(c)
  if (!body || !Array.isArray(body.inputs)) return c.json({ error: 'invalid_body' }, 400)
  const inputs = parseInputs(body.inputs)
  if (!inputs) return c.json({ error: 'invalid_body' }, 400)

  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => finishBattle(userId, encounterId, inputs, now))
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
  return c.json({ status: result.status, encounterId })
})

encounterRoutes.post('/:id/throw', requireUser, async (c) => {
  const encounterId = parseId(c.req.param('id'))
  if (encounterId === null) return c.json({ error: 'encounter_not_found' }, 404)
  const body = (await readObject(c)) ?? {}
  const ball = body.ball
  if (typeof ball !== 'string') return c.json({ error: 'invalid_body' }, 400)
  const berry =
    body.berry === undefined || body.berry === null
      ? null
      : typeof body.berry === 'string'
        ? body.berry
        : undefined
  if (berry === undefined) return c.json({ error: 'invalid_body' }, 400)
  const quality =
    body.quality === undefined || body.quality === null
      ? 'normal'
      : parseThrowQuality(body.quality)
  if (quality === null) return c.json({ error: 'invalid_throw_quality' }, 400)
  const curve =
    body.curve === undefined || body.curve === null
      ? false
      : typeof body.curve === 'boolean'
        ? body.curve
        : undefined
  if (curve === undefined) return c.json({ error: 'invalid_body' }, 400)
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => throwBall(userId, encounterId, now, ball, berry, quality, curve))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.throw)
})

/** Errou o alvo: gasta a bola, sem rolagem, sem agitação, sem throw_count. */
encounterRoutes.post('/:id/miss', requireUser, async (c) => {
  const encounterId = parseId(c.req.param('id'))
  if (encounterId === null) return c.json({ error: 'encounter_not_found' }, 404)
  const body = (await readObject(c)) ?? {}
  const ball = body.ball
  if (typeof ball !== 'string') return c.json({ error: 'invalid_body' }, 400)
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => missBall(userId, encounterId, now, ball))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.miss)
})

encounterRoutes.post('/:id/release', requireUser, (c) => {
  const encounterId = parseId(c.req.param('id'))
  if (encounterId === null) return c.json({ error: 'encounter_not_found' }, 404)
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => releaseWild(userId, encounterId, now))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ status: 'escaped' as const, encounterId })
})

/** Só para a rota de teste (/dev/encounter): fixa espécie, nível e shiny no lugar do sorteio. */
export type ForcedWild = { speciesId: number; level: number; isShiny: boolean }

export function createEncounter(userId: number, region: Region, now: number, forced?: ForcedWild) {
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
  const wild =
    forced ??
    rollWild(rng, {
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
      secretSeed: randomSeed(),
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
  const encounter = loadPendingEncounter(userId, encounterId)
  if (!encounter.ok) return encounter
  if (encounter.row.wonAt != null) return fail('battle_already_won', 409)
  if (encounter.row.battleStartedAt !== null) return fail('battle_already_started', 409)

  const team = loadBattleTeam(userId, pokemonIds)
  if (!team.ok) return team
  const wild = loadWildSpecies(encounter.row.speciesId)
  const built = buildBattleSetup({
    team: team.rows,
    wild,
    wildLevel: encounter.row.level,
    encounterSeed: encounter.row.rngSeed,
    abilitiesFor,
    learnsetFor,
    moves: movesByName(),
  })
  const result = runAutoEncounterBattle(built.setup, encounter.row.rngSeed)
  insertFighters(encounter.row.id, team.rows, built.powers)
  return applyBattleOutcome({
    userId,
    clock,
    encounter: encounter.row,
    team: team.rows.map((row, slot) => ({ ...row, slot })),
    wild,
    won: result.result === 'win',
    enteredSlots: result.enteredSlots,
    faintedSlots: result.snapshot.team.filter((side) => side.fainted).map((side) => side.slot),
    now,
    log: result.log,
  })
}

function startBattle(userId: number, encounterId: number, pokemonIds: number[], now: number) {
  persistCatchUp(userId, now)
  const encounter = loadPendingEncounter(userId, encounterId)
  if (!encounter.ok) return encounter
  if (encounter.row.wonAt != null) return fail('battle_already_won', 409)
  if (encounter.row.battleStartedAt !== null) return fail('battle_already_started', 409)

  const team = loadBattleTeam(userId, pokemonIds)
  if (!team.ok) return team
  const wild = loadWildSpecies(encounter.row.speciesId)
  const built = buildBattleSetup({
    team: team.rows,
    wild,
    wildLevel: encounter.row.level,
    encounterSeed: encounter.row.rngSeed,
    abilitiesFor,
    learnsetFor,
    moves: movesByName(),
  })

  insertFighters(encounter.row.id, team.rows, built.powers)
  const setupPayload = serializeBattleSetup(built.setup)
  getDb()
    .update(encounters)
    .set({ battleStartedAt: now, battleSetupJson: JSON.stringify(setupPayload) })
    .where(and(eq(encounters.id, encounter.row.id), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .run()

  return {
    ok: true as const,
    start: {
      encounterId: encounter.row.id,
      seed: battleRngSeed(encounter.row.rngSeed),
      setup: setupPayload,
      timeLimitMs: simConfig.timeLimitMs,
    },
  }
}

function finishBattle(userId: number, encounterId: number, inputs: BattleInput[], now: number) {
  const clock = persistCatchUp(userId, now)
  const encounter = loadPendingEncounter(userId, encounterId)
  if (!encounter.ok) return encounter
  if (encounter.row.wonAt != null) return fail('battle_already_won', 409)
  if (encounter.row.battleStartedAt === null) return fail('battle_not_started', 400)
  if (!encounter.row.battleSetupJson) return fail('battle_not_started', 400)

  const startedAt = encounter.row.battleStartedAt
  const abandoned = now > startedAt + simConfig.timeLimitMs + simConfig.abandonSlackMs

  let setup: BattleSetup
  try {
    setup = parseBattleSetup(encounter.row.battleSetupJson)
  } catch {
    return fail('invalid_battle_setup', 400)
  }

  const wild = loadWildSpecies(encounter.row.speciesId)
  const team = loadRewardTeamFromSetup(userId, setup)

  if (abandoned) {
    return applyBattleOutcome({
      userId,
      clock,
      encounter: encounter.row,
      team,
      wild,
      won: false,
      enteredSlots: [],
      faintedSlots: [],
      now,
      log: [{ t: 0, kind: 'end', result: 'lose' }],
    })
  }

  let result: BattleResult
  try {
    result = runManualEncounterBattle(setup, encounter.row.rngSeed, inputs)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (
      message === 'invalid_input_time' ||
      message === 'inputs_out_of_order' ||
      message === 'invalid_switch_slot'
    ) {
      return fail(message, 400)
    }
    throw error
  }

  const elapsed = now - startedAt
  if (isFinishTooEarly(elapsed, result.durationMs)) {
    return fail('finish_too_early', 400)
  }

      return applyBattleOutcome({
        userId,
        clock,
        encounter: encounter.row,
        team,
        wild,
        won: result.result === 'win',
        enteredSlots: result.enteredSlots,
        faintedSlots: result.snapshot.team.filter((side) => side.fainted).map((side) => side.slot),
        now,
        log: result.log,
      })
}

type RewardTeamRow = TeamBattleRow & { slot: number }

function applyBattleOutcome(input: {
  userId: number
  clock: PlayerClock
  encounter: EncounterRow
  /** Só Pokémon que ainda existem e são do jogador. */
  team: RewardTeamRow[]
  wild: WildBattleRow
  won: boolean
  enteredSlots: number[]
  /** Slots que terminaram desmaiados (não recebem XP). */
  faintedSlots: number[]
  now: number
  log: BattleEvent[]
}) {
  const { userId, clock, encounter, team, wild, won, enteredSlots, faintedSlots, now, log } = input
  const db = getDb()
  const yieldEvs = evYieldFromSpecies(wild)
  // Só quem entrou e não desmaiou. Bench e KO ficam de fora; Exp Share (futuro) muda isso.
  const sharers = battleXpSharers(enteredSlots, faintedSlots)
  const sharerSet = new Set(sharers)

  const fighters = team.map((mon) => {
    const getsShare = won && sharerSet.has(mon.slot)
    const share = getsShare
      ? fighterXp(wild.baseExperience, encounter.level, mon.level, sharers.length)
      : 0
    const granted = grantXp(mon.level, mon.xp, share)
    const nextEvs = getsShare
      ? applyEvYield(
          {
            hp: mon.evHp,
            attack: mon.evAttack,
            defense: mon.evDefense,
            spAttack: mon.evSpAttack,
            spDefense: mon.evSpDefense,
            speed: mon.evSpeed,
          },
          yieldEvs,
        )
      : null
    let learnedMove: ReturnType<typeof applyLevelMovesToPokemon>['learned'] = null
    if (share > 0 || nextEvs) {
      db.update(pokemon)
        .set({
          ...(share > 0 ? { level: granted.level, xp: granted.xp } : {}),
          ...(nextEvs
            ? {
                evHp: nextEvs.hp,
                evAttack: nextEvs.attack,
                evDefense: nextEvs.defense,
                evSpAttack: nextEvs.spAttack,
                evSpDefense: nextEvs.spDefense,
                evSpeed: nextEvs.speed,
              }
            : {}),
        })
        .where(and(eq(pokemon.id, mon.id), eq(pokemon.userId, userId)))
        .run()
      if (share > 0) bumpMaxLevelReached(userId, mon.speciesId, granted.level)
      if (share > 0 && granted.levelsGained > 0 && mon.fastMove) {
        learnedMove = applyLevelMovesToPokemon({
          userId,
          pokemonId: mon.id,
          speciesId: mon.speciesId,
          fromLevel: mon.level,
          toLevel: granted.level,
          chargedMove: mon.chargedMove,
        }).learned
      }
    }
    return {
      pokemonId: mon.id,
      xpGained: share,
      level: share > 0 ? granted.level : mon.level,
      xp: share > 0 ? granted.xp : mon.xp,
      levelsGained: share > 0 ? granted.levelsGained : 0,
      learnedMove,
    }
  })

  let catchOdds: number | null = null
  let seedDrop: { itemKey: string; berryKey: string } | null = null
  if (won) {
    // Chance só para a tela; o Pinap só gasta no 1º lançamento (throw).
    catchOdds = catchChance(wild.captureRate, peekBonus(userId, 'catch_boost'))
    seedDrop = rollBattleSeed(mulberry32(seedDropRngSeed(hiddenSeed(encounter))))
    if (seedDrop) creditItems(userId, [{ itemKey: seedDrop.itemKey, quantity: 1 }])
  }

  // XP de captura fica no throw; aqui só o da vitória.
  const trainerXpGained = won ? trainerWinXp(encounter.level) : 0
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
        updatedAt: now,
      })
      .where(eq(trainers.userId, userId))
      .run()
  }

  if (won) {
    const decisionUntil = now + battleConfig.decisionTtlMs
    db.update(encounters)
      .set({
        wonAt: now,
        throwCount: 0,
        winChance: null,
        catchChance: catchOdds,
        expiresAt: Math.max(encounter.expiresAt, decisionUntil),
      })
      .where(and(eq(encounters.id, encounter.id), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
      .run()
  } else {
    db.update(encounters)
      .set({
        status: 'lost',
        winChance: null,
        catchChance: null,
        resolvedAt: now,
      })
      .where(and(eq(encounters.id, encounter.id), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
      .run()
  }

  return {
    ok: true as const,
    battle: {
      encounterId: encounter.id,
      winChance: null,
      won,
      catchChance: catchOdds,
      caught: false,
      status: won ? ('pending' as const) : ('lost' as const),
      fighters,
      trainerXpGained,
      trainer: {
        level: trainerNext.level,
        xp: trainerNext.xp,
        levelsGained: trainerNext.levelsGained,
      },
      seedDrop,
      levelRewards,
      log,
    },
  }
}

/**
 * Lançamentos e semente da vitória saem da seed secreta, que nunca vai para o
 * front. A seed da luta enviada ao front permite recuperar a rng_seed (as
 * derivações são XOR), mas não esta. Encontros criados antes da coluna seguem
 * com a rng_seed, como antes.
 */
function hiddenSeed(encounter: Pick<EncounterRow, 'rngSeed' | 'secretSeed'>): number {
  return encounter.secretSeed ?? encounter.rngSeed
}

function loadPendingEncounter(userId: number, encounterId: number): { ok: true; row: EncounterRow } | Failure {
  const row = getDb()
    .select()
    .from(encounters)
    .where(and(eq(encounters.id, encounterId), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
  if (!row) return fail('encounter_not_found', 404)
  return { ok: true, row }
}

function loadBattleTeam(userId: number, pokemonIds: number[]): { ok: true; rows: TeamBattleRow[] } | Failure {
  const rows = selectTeamRows(userId, pokemonIds)
  if (rows.length !== pokemonIds.length) return fail('invalid_team', 400)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const team: TeamBattleRow[] = []
  for (const id of pokemonIds) {
    const mon = byId.get(id)
    if (!mon || mon.location !== 'garden') return fail('invalid_team', 400)
    const ready = toTeamBattleRow(mon)
    if (!ready) return fail('invalid_team', 400)
    team.push(ready)
  }
  return { ok: true, rows: team }
}

/** Carrega do banco só os lutadores do setup que ainda existem e são do jogador. */
function loadRewardTeamFromSetup(userId: number, setup: BattleSetup): RewardTeamRow[] {
  const ids = setup.team.flatMap((fighter) => (fighter.id !== null ? [fighter.id] : []))
  if (ids.length === 0) return []
  const rows = selectTeamRows(userId, ids)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const out: RewardTeamRow[] = []
  for (let slot = 0; slot < setup.team.length; slot += 1) {
    const fighter = setup.team[slot]!
    if (fighter.id === null) continue
    const row = byId.get(fighter.id)
    if (!row) continue
    const ready = toTeamBattleRow(row)
    if (!ready) continue
    out.push({ ...ready, slot })
  }
  return out
}

function selectTeamRows(userId: number, pokemonIds: number[]) {
  return getDb()
    .select({
      id: pokemon.id,
      speciesId: pokemon.speciesId,
      level: pokemon.level,
      xp: pokemon.xp,
      location: pokemon.location,
      type1: species.type1,
      type2: species.type2,
      hp: species.hp,
      attack: species.attack,
      defense: species.defense,
      spAttack: species.spAttack,
      spDefense: species.spDefense,
      speed: species.speed,
      ivHp: pokemon.ivHp,
      ivAttack: pokemon.ivAttack,
      ivDefense: pokemon.ivDefense,
      ivSpAttack: pokemon.ivSpAttack,
      ivSpDefense: pokemon.ivSpDefense,
      ivSpeed: pokemon.ivSpeed,
      evHp: pokemon.evHp,
      evAttack: pokemon.evAttack,
      evDefense: pokemon.evDefense,
      evSpAttack: pokemon.evSpAttack,
      evSpDefense: pokemon.evSpDefense,
      evSpeed: pokemon.evSpeed,
      nature: pokemon.nature,
      abilitySlot: pokemon.abilitySlot,
      fastMove: pokemon.fastMove,
      chargedMove: pokemon.chargedMove,
    })
    .from(pokemon)
    .innerJoin(species, eq(pokemon.speciesId, species.id))
    .where(and(eq(pokemon.userId, userId), inArray(pokemon.id, pokemonIds)))
    .all()
}

function toTeamBattleRow(row: ReturnType<typeof selectTeamRows>[number]): TeamBattleRow | null {
  if (
    row.ivHp === null ||
    row.ivAttack === null ||
    row.ivDefense === null ||
    row.ivSpAttack === null ||
    row.ivSpDefense === null ||
    row.ivSpeed === null ||
    row.nature === null ||
    row.abilitySlot === null ||
    row.fastMove === null ||
    !isAbilitySlot(row.abilitySlot)
  ) {
    return null
  }
  return {
    id: row.id,
    speciesId: row.speciesId,
    level: row.level,
    xp: row.xp,
    location: row.location,
    type1: row.type1,
    type2: row.type2,
    hp: row.hp,
    attack: row.attack,
    defense: row.defense,
    spAttack: row.spAttack,
    spDefense: row.spDefense,
    speed: row.speed,
    ivHp: row.ivHp,
    ivAttack: row.ivAttack,
    ivDefense: row.ivDefense,
    ivSpAttack: row.ivSpAttack,
    ivSpDefense: row.ivSpDefense,
    ivSpeed: row.ivSpeed,
    evHp: row.evHp,
    evAttack: row.evAttack,
    evDefense: row.evDefense,
    evSpAttack: row.evSpAttack,
    evSpDefense: row.evSpDefense,
    evSpeed: row.evSpeed,
    nature: row.nature,
    abilitySlot: row.abilitySlot,
    fastMove: row.fastMove,
    chargedMove: row.chargedMove,
  }
}

function loadWildSpecies(speciesId: number): WildBattleRow {
  const wild = getDb()
    .select({
      id: species.id,
      type1: species.type1,
      type2: species.type2,
      hp: species.hp,
      attack: species.attack,
      defense: species.defense,
      spAttack: species.spAttack,
      spDefense: species.spDefense,
      speed: species.speed,
      evHp: species.evHp,
      evAttack: species.evAttack,
      evDefense: species.evDefense,
      evSpAttack: species.evSpAttack,
      evSpDefense: species.evSpDefense,
      evSpeed: species.evSpeed,
      baseExperience: species.baseExperience,
      captureRate: species.captureRate,
      evolutionChainId: species.evolutionChainId,
    })
    .from(species)
    .where(eq(species.id, speciesId))
    .get()
  if (!wild) throw new Error(`species ${speciesId} missing`)
  return wild
}

function insertFighters(encounterId: number, team: TeamBattleRow[], powers: number[]) {
  getDb()
    .insert(encounterFighters)
    .values(team.map((mon, slot) => ({ encounterId, slot, pokemonId: mon.id, power: powers[slot] ?? 0 })))
    .run()
}

function fleeEncounter(
  userId: number,
  encounterId: number,
  now: number,
): { ok: true; status: 'fled' | 'escaped' } | Failure {
  persistCatchUp(userId, now)
  const row = getDb()
    .select({ id: encounters.id, wonAt: encounters.wonAt })
    .from(encounters)
    .where(and(eq(encounters.id, encounterId), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
  if (!row) return fail('encounter_not_found', 404)
  // Já venceu: fugir = deixar ir (escaped). Antes da luta: fled.
  const status = row.wonAt != null ? ('escaped' as const) : ('fled' as const)
  getDb()
    .update(encounters)
    .set({ status, resolvedAt: now })
    .where(and(eq(encounters.id, encounterId), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .run()
  return { ok: true, status }
}

function releaseWild(userId: number, encounterId: number, now: number): { ok: true } | Failure {
  persistCatchUp(userId, now)
  const row = getDb()
    .select({ id: encounters.id, wonAt: encounters.wonAt })
    .from(encounters)
    .where(and(eq(encounters.id, encounterId), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()
  if (!row) return fail('encounter_not_found', 404)
  if (row.wonAt == null) return fail('battle_not_won', 400)
  getDb()
    .update(encounters)
    .set({ status: 'escaped', resolvedAt: now })
    .where(and(eq(encounters.id, encounterId), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .run()
  return { ok: true }
}

function missBall(userId: number, encounterId: number, now: number, ballKey: string) {
  persistCatchUp(userId, now)
  const loaded = loadPendingEncounter(userId, encounterId)
  if (!loaded.ok) return loaded
  const encounter = loaded.row
  if (encounter.wonAt == null) return fail('battle_not_won', 400)

  const ball = getBall(ballKey)
  if (!ball) return fail('unknown_ball', 400)
  if (!debitItem(userId, ballItemKey(ball.key), 1)) return fail('no_ball', 400)

  return {
    ok: true as const,
    miss: {
      ball: ball.key,
      throwCount: encounter.throwCount,
      agitation: encounter.agitation,
    },
  }
}

function throwBall(
  userId: number,
  encounterId: number,
  now: number,
  ballKey: string,
  berryKey: string | null,
  quality: ThrowQuality,
  curve: boolean,
) {
  const clock = persistCatchUp(userId, now)
  const loaded = loadPendingEncounter(userId, encounterId)
  if (!loaded.ok) return loaded
  const encounter = loaded.row
  if (encounter.wonAt == null) return fail('battle_not_won', 400)

  const ball = getBall(ballKey)
  if (!ball) return fail('unknown_ball', 400)

  const captureBerry = berryKey ? getBerry(berryKey) : null
  if (berryKey) {
    if (!captureBerry?.capture) return fail('berry_not_usable', 400)
  }

  if (captureBerry && !debitItem(userId, berryItemKey(captureBerry.key), 1)) {
    return fail('no_item', 400)
  }
  if (!debitItem(userId, ballItemKey(ball.key), 1)) {
    if (captureBerry) creditItems(userId, [{ itemKey: berryItemKey(captureBerry.key), quantity: 1 }])
    return fail('no_ball', 400)
  }

  const wild = loadWildSpecies(encounter.speciesId)
  const throwIndex = encounter.throwCount
  const bagCatchBoost = takeBonus(userId, 'catch_boost')
  const berryCatchMult = captureBerry?.capture?.catchMult ?? 1
  const berryBonus = bagCatchBoost * berryCatchMult
  const types = [wild.type1, wild.type2].filter((t): t is string => Boolean(t))
  const ballMult = ballMultiplier({
    key: ball.key,
    throwIndex,
    wildLevel: encounter.level,
    types,
  })
  const throwMult = throwAimMult(quality, curve)
  const calmed = calmAgitation(encounter.agitation, captureBerry?.capture?.calm)
  const agitationIfMiss = calmed + 1
  const roll = rollThrow({
    encounterSeed: hiddenSeed(encounter),
    throwIndex,
    captureRate: wild.captureRate,
    berryBonus,
    ballMult,
    throwMult,
    guaranteed: isMasterBall(ball.key),
    fleeChance: fleeChanceAt(agitationIfMiss),
  })

  const db = getDb()
  const throwNumber = throwIndex + 1

  if (roll.caught) {
    const candyBonus = captureBerry?.capture?.candyOnCatch ?? 0
    const candiesGained =
      candyBonus > 0 ? creditChainCandies(userId, wild.evolutionChainId, candyBonus) : 0

    const traits = rollTraits(mulberry32(wildTraitsSeed(encounter.rngSeed)), {
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
        caughtBall: ball.key,
        originalSpeciesId: encounter.speciesId,
        ...traitColumns(traits),
      })
      .returning({ id: pokemon.id })
      .get()
    if (!inserted) throw new Error('failed to catch pokemon')

    const pokedex = db
      .update(pokedexEntries)
      .set({
        caughtCount: sql`${pokedexEntries.caughtCount} + 1`,
        firstCaughtAt: sql`coalesce(${pokedexEntries.firstCaughtAt}, ${now})`,
        shinyCaught: sql`(${pokedexEntries.shinyCaught} or ${encounter.isShiny ? 1 : 0})`,
        maxLevelReached: sql`max(${pokedexEntries.maxLevelReached}, ${encounter.level})`,
      })
      .where(and(eq(pokedexEntries.userId, userId), eq(pokedexEntries.speciesId, encounter.speciesId)))
      .run()
    if (pokedex.changes !== 1) throw new Error(`pokedex missing for species ${encounter.speciesId}`)

    const catchXp = trainerCatchXp(encounter.level)
    const trainerNext = grantXp(clock.level, clock.xp, catchXp, trainerXpToNext)
    const levelRewards =
      trainerNext.levelsGained > 0 ? grantTrainerLevelRewards(userId, clock.level, trainerNext.level) : []
    db.update(trainers)
      .set({
        level: trainerNext.level,
        xp: trainerNext.xp,
        totalCatches: sql`${trainers.totalCatches} + 1`,
        updatedAt: now,
      })
      .where(eq(trainers.userId, userId))
      .run()

    db.update(encounters)
      .set({
        status: 'caught',
        throwCount: throwNumber,
        catchChance: roll.catchChance,
        agitation: calmed,
        caughtPokemonId: inserted.id,
        resolvedAt: now,
      })
      .where(and(eq(encounters.id, encounter.id), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
      .run()

    return {
      ok: true as const,
      throw: {
        caught: true,
        fled: false,
        catchChance: roll.catchChance,
        throwNumber,
        agitation: calmed,
        status: 'caught' as const,
        pokemonId: inserted.id,
        candyBonus: candiesGained,
        trainerXpGained: catchXp,
        trainer: {
          level: trainerNext.level,
          xp: trainerNext.xp,
          levelsGained: trainerNext.levelsGained,
        },
        levelRewards,
      },
    }
  }

  if (roll.fled) {
    db.update(encounters)
      .set({
        status: 'escaped',
        throwCount: throwNumber,
        catchChance: roll.catchChance,
        agitation: agitationIfMiss,
        resolvedAt: now,
      })
      .where(and(eq(encounters.id, encounter.id), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
      .run()
    return {
      ok: true as const,
      throw: {
        caught: false,
        fled: true,
        catchChance: roll.catchChance,
        throwNumber,
        agitation: agitationIfMiss,
        status: 'escaped' as const,
      },
    }
  }

  db.update(encounters)
    .set({
      throwCount: throwNumber,
      catchChance: roll.catchChance,
      agitation: agitationIfMiss,
    })
    .where(and(eq(encounters.id, encounter.id), eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .run()

  return {
    ok: true as const,
    throw: {
      caught: false,
      fled: false,
      catchChance: roll.catchChance,
      throwNumber,
      agitation: agitationIfMiss,
      status: 'pending' as const,
    },
  }
}

/** Lê o multiplicador sem consumir cargas (tela de decisão). */
function peekBonus(userId: number, effectKey: string): number {
  const rows = getDb()
    .select()
    .from(activeEffects)
    .where(and(eq(activeEffects.userId, userId), eq(activeEffects.effectKey, effectKey)))
    .all()
    .sort((a, b) => a.id - b.id)
  const chosen = rows.find((row) => row.charges !== null) ?? rows[0]
  return chosen?.multiplier ?? 1
}

// Efeito por uso: consome o mais antigo. Efeito só por tempo aplica o
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

function parseInputs(value: unknown[]): BattleInput[] | null {
  if (value.length > simConfig.maxInputs) return null
  const inputs: BattleInput[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
    const row = entry as Record<string, unknown>
    if (typeof row.t !== 'number' || !Number.isInteger(row.t)) return null
    if (row.action !== 'fast' && row.action !== 'charged' && row.action !== 'switch') return null
    const input: BattleInput = { t: row.t, action: row.action }
    if (row.action === 'switch') {
      if (typeof row.slot !== 'number' || !Number.isInteger(row.slot)) return null
      input.slot = row.slot
    } else if (row.slot !== undefined) {
      if (typeof row.slot !== 'number' || !Number.isInteger(row.slot)) return null
      input.slot = row.slot
    }
    inputs.push(input)
  }
  return inputs
}

function isAbilitySlot(value: string): value is AbilitySlot {
  return value === '1' || value === '2' || value === 'hidden'
}
