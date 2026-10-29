import { and, eq, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { GENERIC_PER_CANDY, evolveTrainerXp } from '../config/progression.js'
import { trainerXpToNext } from '../config/trainer.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { grantTrainerLevelRewards } from '../db/inventory.js'
import { bumpMaxLevelReached } from '../game/pokedex.js'
import { candies, evolutions, pokedexEntries, pokemon, species, trainers } from '../db/schema.js'
import { applyLevelMovesToPokemon, rerollMovesOnEvolve, type MoveView } from '../game/levelMoves.js'
import { evolutionBlock, parseNickname, planFeed, planRelease } from '../game/progression.js'
import { canLearnMove, moveFitsSlot } from '../game/traits.js'
import { grantXp } from '../game/xp.js'
import { leaveTeam } from '../db/team.js'
import { learnsetFor, movesByName } from '../seed/traitsData.js'
import { type Failure, fail, parseId, readObject } from './http.js'
import { devToolsEnabled } from './dev.js'

type Ok<T> = { ok: true } & T

export const pokemonRoutes = new Hono<AuthEnv>()

pokemonRoutes.post('/release', requireUser, async (c) => {
  const body = await readObject(c)
  if (!body || !Array.isArray(body.pokemonIds)) return c.json({ error: 'invalid_body' }, 400)
  const ids = parseIds(body.pokemonIds)
  if (!ids) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => releaseMany(c.get('userId'), ids, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.release)
})

pokemonRoutes.post('/:id/release', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const result = immediate(() => releaseMany(c.get('userId'), [id], Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.release)
})

// PC: some do jardim e fica parado. Sai do time; o time não pode ficar vazio.
pokemonRoutes.post('/:id/pc', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const result = immediate(() => moveToPc(c.get('userId'), id, true))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json({ inPc: true })
})

pokemonRoutes.post('/:id/garden', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const result = immediate(() => moveToPc(c.get('userId'), id, false))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json({ inPc: false })
})

pokemonRoutes.post('/:id/feed', requireUser, async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const body = await readObject(c)
  if (!body) return c.json({ error: 'invalid_body' }, 400)
  const doses = body.candies
  if (typeof doses !== 'number') return c.json({ error: 'invalid_body' }, 400)
  if (body.useGeneric !== undefined && typeof body.useGeneric !== 'boolean') return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => feedOne(c.get('userId'), id, doses, body.useGeneric === true, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.feed)
})

pokemonRoutes.post('/:id/evolve', requireUser, async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const body = await readObject(c)
  if (!body) return c.json({ error: 'invalid_body' }, 400)
  const toSpeciesId = body.toSpeciesId
  if (typeof toSpeciesId !== 'number' || !Number.isInteger(toSpeciesId)) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const result = immediate(() => evolveOne(c.get('userId'), id, toSpeciesId, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.evolution)
})

// Troca livre na ficha: só em teste (DEV_TOOLS). Em produção o golpe muda
// só pelos offers ao subir de nível / evoluir.
pokemonRoutes.post('/:id/moves', requireUser, async (c) => {
  if (!devToolsEnabled()) return c.json({ error: 'not_found' }, 404)
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const body = await readObject(c)
  if (!body) return c.json({ error: 'invalid_body' }, 400)
  const slot = body.slot
  const move = body.move
  if ((slot !== 'fast' && slot !== 'charged') || typeof move !== 'string') {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const result = immediate(() => changeMove(c.get('userId'), id, slot, move, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.moves)
})

// ---- Debug da ficha (só DEV_TOOLS; em produção respondem 404) -------------

// Evolui sem conferir o nível. Mesmo caminho da evolução normal (golpes,
// Pokédex, XP de treinador), só sem a trava.
pokemonRoutes.post('/:id/dev/evolve', requireUser, async (c) => {
  if (!devToolsEnabled()) return c.json({ error: 'not_found' }, 404)
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const body = await readObject(c)
  const toSpeciesId = body?.toSpeciesId
  if (typeof toSpeciesId !== 'number' || !Number.isInteger(toSpeciesId)) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const result = immediate(() => evolveOne(c.get('userId'), id, toSpeciesId, Date.now(), true))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.evolution)
})

// Sobe `levels` níveis (XP zera no nível novo), com os golpes de nível.
pokemonRoutes.post('/:id/dev/level', requireUser, async (c) => {
  if (!devToolsEnabled()) return c.json({ error: 'not_found' }, 404)
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const body = await readObject(c)
  const levels = body?.levels
  if (typeof levels !== 'number' || !Number.isInteger(levels) || levels < 1 || levels > progressConfig.levelCap) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const result = immediate(() => devLevelUp(c.get('userId'), id, levels, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.level)
})

// Liga/desliga o shiny.
pokemonRoutes.post('/:id/dev/shiny', requireUser, (c) => {
  if (!devToolsEnabled()) return c.json({ error: 'not_found' }, 404)
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const result = immediate(() => devToggleShiny(c.get('userId'), id, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.shiny)
})

// Apaga do roster sem dar doces. Mesmas travas do soltar: fora do daycare e
// nunca o último.
pokemonRoutes.post('/:id/dev/delete', requireUser, (c) => {
  if (!devToolsEnabled()) return c.json({ error: 'not_found' }, 404)
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const result = immediate(() => devDelete(c.get('userId'), id, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json({ deleted: id })
})

pokemonRoutes.patch('/:id', requireUser, async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'pokemon_not_found' }, 404)
  const body = await readObject(c)
  if (!body) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => patchOne(c.get('userId'), id, body, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.pokemon)
})

function devLevelUp(
  userId: number,
  id: number,
  levels: number,
  now: number,
): Ok<{ level: { level: number; levelsGained: number; learnedMove: MoveView | null } }> | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const mon = db
    .select({
      speciesId: pokemon.speciesId,
      level: pokemon.level,
      location: pokemon.location,
      fastMove: pokemon.fastMove,
      chargedMove: pokemon.chargedMove,
    })
    .from(pokemon)
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .get()
  if (!mon) return fail('pokemon_not_found', 404)
  if (mon.location === 'daycare') return fail('in_daycare', 400)
  const level = Math.min(progressConfig.levelCap, mon.level + levels)
  db.update(pokemon)
    .set({ level, xp: 0 })
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .run()
  bumpMaxLevelReached(userId, mon.speciesId, level)
  const learnedMove =
    level > mon.level && mon.fastMove
      ? applyLevelMovesToPokemon({
          userId,
          pokemonId: id,
          speciesId: mon.speciesId,
          fromLevel: mon.level,
          toLevel: level,
          chargedMove: mon.chargedMove,
        }).learned
      : null
  return { ok: true, level: { level, levelsGained: level - mon.level, learnedMove } }
}

function devToggleShiny(userId: number, id: number, now: number): Ok<{ shiny: { isShiny: boolean } }> | Failure {
  const db = getDb()
  const mon = db
    .select({ isShiny: pokemon.isShiny, speciesId: pokemon.speciesId, level: pokemon.level })
    .from(pokemon)
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .get()
  if (!mon) return fail('pokemon_not_found', 404)
  const isShiny = !mon.isShiny
  db.update(pokemon)
    .set({ isShiny })
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .run()
  // Pokédex: virar shiny conta como shiny capturado (como seria na captura).
  if (isShiny) markCaught(userId, mon.speciesId, true, now, mon.level)
  return { ok: true, shiny: { isShiny } }
}

function moveToPc(userId: number, id: number, toPc: boolean): { ok: true } | Failure {
  const db = getDb()
  const mon = db
    .select({ location: pokemon.location, inPc: pokemon.inPc })
    .from(pokemon)
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .get()
  if (!mon) return fail('pokemon_not_found', 404)
  if (mon.location === 'daycare') return fail('in_daycare', 400)
  if (mon.inPc === toPc) return { ok: true }
  if (toPc) {
    // O time sai junto e nunca fica vazio, então o jardim também não.
    const left = leaveTeam(userId, [id])
    if (!left.ok) return fail(left.error, 400)
  }
  db.update(pokemon)
    .set({ inPc: toPc })
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .run()
  return { ok: true }
}

function devDelete(userId: number, id: number, now: number): { ok: true } | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const owned = db
    .select({ id: pokemon.id, location: pokemon.location })
    .from(pokemon)
    .where(eq(pokemon.userId, userId))
    .all()
  const mon = owned.find((row) => row.id === id)
  if (!mon) return fail('pokemon_not_found', 404)
  if (mon.location === 'daycare') return fail('in_daycare', 400)
  if (owned.length <= 1) return fail('last_pokemon', 400)
  const left = leaveTeam(userId, [id])
  if (!left.ok) return fail(left.error, 400)
  db.delete(pokemon)
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .run()
  return { ok: true }
}

function errorBody(result: Failure): { error: string; pokemonId?: number; min?: number } {
  return {
    error: result.error,
    ...(result.pokemonId !== undefined ? { pokemonId: result.pokemonId } : {}),
    ...(result.min !== undefined ? { min: result.min } : {}),
  }
}

function parseIds(value: unknown[]): number[] | null {
  const ids: number[] = []
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry <= 0) return null
    ids.push(entry)
  }
  return ids
}

function releaseMany(userId: number, ids: number[], now: number): Ok<{ release: ReleaseResult }> | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const owned = db
    .select({
      id: pokemon.id,
      location: pokemon.location,
      level: pokemon.level,
      isShiny: pokemon.isShiny,
      evolutionChainId: species.evolutionChainId,
    })
    .from(pokemon)
    .innerJoin(species, eq(pokemon.speciesId, species.id))
    .where(eq(pokemon.userId, userId))
    .all()

  const plan = planRelease(ids, owned)
  if (!plan.ok) {
    const status = plan.error === 'pokemon_not_found' ? 404 : 400
    return fail(plan.error, status, plan.pokemonId !== undefined ? { pokemonId: plan.pokemonId } : undefined)
  }
  const left = leaveTeam(userId, ids)
  if (!left.ok) return fail(left.error, 400)

  db.delete(pokemon)
    .where(and(eq(pokemon.userId, userId), inArray(pokemon.id, ids)))
    .run()

  const gainedByChain = new Map<number, number>()
  let genericGained = 0
  for (const row of plan.releases) {
    gainedByChain.set(row.evolutionChainId, (gainedByChain.get(row.evolutionChainId) ?? 0) + row.chain)
    genericGained += row.generic
  }

  const lines = [...gainedByChain.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([evolutionChainId, gained]) => {
      const current = db
        .select({ amount: candies.amount })
        .from(candies)
        .where(and(eq(candies.userId, userId), eq(candies.evolutionChainId, evolutionChainId)))
        .get()
      const amount = (current?.amount ?? 0) + gained
      if (current) {
        db.update(candies)
          .set({ amount })
          .where(and(eq(candies.userId, userId), eq(candies.evolutionChainId, evolutionChainId)))
          .run()
      } else {
        db.insert(candies).values({ userId, evolutionChainId, amount: gained }).run()
      }
      return { evolutionChainId, gained, amount }
    })

  const trainer = db
    .select({ genericCandies: trainers.genericCandies, totalReleases: trainers.totalReleases })
    .from(trainers)
    .where(eq(trainers.userId, userId))
    .get()
  if (!trainer) throw new Error(`trainer missing for user ${userId}`)
  const genericCandies = trainer.genericCandies + genericGained
  const totalReleases = trainer.totalReleases + ids.length
  db.update(trainers)
    .set({ genericCandies, totalReleases, updatedAt: now })
    .where(eq(trainers.userId, userId))
    .run()

  return {
    ok: true,
    release: { pokemonIds: ids, lines, genericGained, genericCandies, totalReleases },
  }
}

type ReleaseResult = {
  pokemonIds: number[]
  lines: { evolutionChainId: number; gained: number; amount: number }[]
  genericGained: number
  genericCandies: number
  totalReleases: number
}

function feedOne(
  userId: number,
  id: number,
  doses: number,
  useGeneric: boolean,
  now: number,
): Ok<{ feed: FeedResult }> | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const mon = db
    .select({
      id: pokemon.id,
      speciesId: pokemon.speciesId,
      level: pokemon.level,
      xp: pokemon.xp,
      location: pokemon.location,
      fastMove: pokemon.fastMove,
      chargedMove: pokemon.chargedMove,
      evolutionChainId: species.evolutionChainId,
    })
    .from(pokemon)
    .innerJoin(species, eq(pokemon.speciesId, species.id))
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .get()
  if (!mon) return fail('pokemon_not_found', 404)
  if (mon.location === 'daycare') return fail('in_daycare', 400)

  const plan = planFeed(mon.level, mon.xp, doses)
  if (!plan.ok) return fail(plan.error, 400)

  const trainer = db
    .select({ genericCandies: trainers.genericCandies })
    .from(trainers)
    .where(eq(trainers.userId, userId))
    .get()
  if (!trainer) throw new Error(`trainer missing for user ${userId}`)

  let spent: number
  let balance: number
  if (useGeneric) {
    if (trainer.genericCandies < plan.doses * GENERIC_PER_CANDY) return fail('not_enough_candies', 400)
    spent = plan.doses * GENERIC_PER_CANDY
    balance = trainer.genericCandies - spent
    db.update(trainers).set({ genericCandies: balance, updatedAt: now }).where(eq(trainers.userId, userId)).run()
  } else {
    const row = db
      .select({ amount: candies.amount })
      .from(candies)
      .where(and(eq(candies.userId, userId), eq(candies.evolutionChainId, mon.evolutionChainId)))
      .get()
    if (!row || row.amount < plan.doses) return fail('not_enough_candies', 400)
    spent = plan.doses
    balance = row.amount - spent
    db.update(candies)
      .set({ amount: balance })
      .where(and(eq(candies.userId, userId), eq(candies.evolutionChainId, mon.evolutionChainId)))
      .run()
  }

  db.update(pokemon)
    .set({ level: plan.level, xp: plan.xp })
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .run()
  bumpMaxLevelReached(userId, mon.speciesId, plan.level)

  const learnedMove =
    plan.levelsGained > 0 && mon.fastMove
      ? applyLevelMovesToPokemon({
          userId,
          pokemonId: id,
          speciesId: mon.speciesId,
          fromLevel: mon.level,
          toLevel: plan.level,
          chargedMove: mon.chargedMove,
        }).learned
      : null

  return {
    ok: true,
    feed: {
      doses: plan.doses,
      spent,
      xpGained: plan.xpGained,
      levelsGained: plan.levelsGained,
      level: plan.level,
      xp: plan.xp,
      xpToNext: plan.level >= progressConfig.levelCap ? null : xpToNext(plan.level),
      useGeneric,
      balance,
      learnedMove,
    },
  }
}

type FeedResult = {
  doses: number
  spent: number
  xpGained: number
  levelsGained: number
  level: number
  xp: number
  xpToNext: number | null
  useGeneric: boolean
  balance: number
  learnedMove: MoveView | null
}

function evolveOne(
  userId: number,
  id: number,
  toSpeciesId: number,
  now: number,
  /** Dev: evolui sem conferir o nível mínimo (nem a evolução por troca). */
  force = false,
): Ok<{ evolution: EvolutionResult }> | Failure {
  const clock = persistCatchUp(userId, now)
  const db = getDb()
  const mon = db
    .select({
      id: pokemon.id,
      level: pokemon.level,
      xp: pokemon.xp,
      isShiny: pokemon.isShiny,
      nickname: pokemon.nickname,
      isFavorite: pokemon.isFavorite,
      location: pokemon.location,
      speciesId: pokemon.speciesId,
      fastMove: pokemon.fastMove,
      chargedMove: pokemon.chargedMove,
    })
    .from(pokemon)
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .get()
  if (!mon) return fail('pokemon_not_found', 404)
  if (mon.location !== 'garden') return fail('in_daycare', 400)

  const row = db
    .select({ minLevel: evolutions.minLevel })
    .from(evolutions)
    .where(and(eq(evolutions.fromSpeciesId, mon.speciesId), eq(evolutions.toSpeciesId, toSpeciesId)))
    .get()
  if (!row) return fail('evolution_not_found', 404)

  if (!force) {
    const block = evolutionBlock(mon.level, row.minLevel)
    if (!block.ok) return fail(block.error, 400, { min: block.min })
  }

  const next = db
    .select({
      id: species.id,
      name: species.name,
      displayName: species.displayName,
      evolutionStage: species.evolutionStage,
    })
    .from(species)
    .where(eq(species.id, toSpeciesId))
    .get()
  if (!next) throw new Error(`species ${toSpeciesId} is not seeded`)

  // IVs, EVs, nature e ability_slot ficam; o nome da habilidade resolve na
  // leitura. Os golpes são sorteados de novo pela espécie nova (seção 5.18).
  db.update(pokemon)
    .set({ speciesId: next.id })
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .run()
  markCaught(userId, next.id, mon.isShiny, now, mon.level)
  bumpMaxLevelReached(userId, next.id, mon.level)

  const newMoves = mon.fastMove
    ? rerollMovesOnEvolve({ userId, pokemonId: id, speciesId: next.id, level: mon.level })
    : null

  const trainerXpGained = evolveTrainerXp(next.evolutionStage)
  const trainerNext = grantXp(clock.level, clock.xp, trainerXpGained, trainerXpToNext)
  const levelRewards =
    trainerNext.levelsGained > 0
      ? grantTrainerLevelRewards(userId, clock.level, trainerNext.level)
      : []
  db.update(trainers)
    .set({ level: trainerNext.level, xp: trainerNext.xp, updatedAt: now })
    .where(eq(trainers.userId, userId))
    .run()

  return {
    ok: true,
    evolution: {
      pokemonId: id,
      speciesId: next.id,
      name: next.name,
      displayName: next.displayName,
      level: mon.level,
      xp: mon.xp,
      isShiny: mon.isShiny,
      nickname: mon.nickname,
      isFavorite: mon.isFavorite,
      trainerXpGained,
      trainer: {
        level: trainerNext.level,
        xp: trainerNext.xp,
        levelsGained: trainerNext.levelsGained,
      },
      levelRewards,
      newMoves,
      evolutions: evolutionsFrom(next.id),
    },
  }
}

type EvolutionResult = {
  pokemonId: number
  speciesId: number
  name: string
  displayName: string
  level: number
  xp: number
  isShiny: boolean
  nickname: string | null
  isFavorite: boolean
  trainerXpGained: number
  trainer: { level: number; xp: number; levelsGained: number }
  levelRewards: { itemKey: string; quantity: number }[]
  newMoves: { fast: MoveView | null; charged: MoveView | null } | null
  evolutions: { toSpeciesId: number; displayName: string; minLevel: number; viaTrade: boolean }[]
}

function changeMove(
  userId: number,
  id: number,
  slot: 'fast' | 'charged',
  move: string,
  now: number,
): Ok<{ moves: { fastMove: string; chargedMove: string | null } }> | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const mon = db
    .select({
      id: pokemon.id,
      level: pokemon.level,
      speciesId: pokemon.speciesId,
      fastMove: pokemon.fastMove,
      chargedMove: pokemon.chargedMove,
    })
    .from(pokemon)
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .get()
  if (!mon) return fail('pokemon_not_found', 404)
  if (!mon.fastMove) return fail('traits_missing', 400)

  const moves = movesByName()
  const info = moves.get(move)
  if (!info) return fail('move_not_found', 404)
  if (!moveFitsSlot(info.power, slot)) return fail('move_wrong_slot', 400)
  if (!canLearnMove(learnsetFor(mon.speciesId), mon.level, move, moves)) {
    return fail('move_not_learned', 400)
  }

  const patch =
    slot === 'fast' ? { fastMove: move } : { chargedMove: move }
  db.update(pokemon)
    .set(patch)
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .run()

  return {
    ok: true,
    moves: {
      fastMove: slot === 'fast' ? move : mon.fastMove,
      chargedMove: slot === 'charged' ? move : mon.chargedMove,
    },
  }
}

function patchOne(
  userId: number,
  id: number,
  body: Record<string, unknown>,
  now: number,
): Ok<{ pokemon: { id: number; nickname: string | null; isFavorite: boolean } }> | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const mon = db
    .select({ id: pokemon.id, nickname: pokemon.nickname, isFavorite: pokemon.isFavorite })
    .from(pokemon)
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .get()
  if (!mon) return fail('pokemon_not_found', 404)

  const patch: { nickname?: string | null; isFavorite?: boolean } = {}
  if ('nickname' in body) {
    const parsed = parseNickname(body.nickname)
    if (!parsed.ok) return fail(parsed.error, 400)
    patch.nickname = parsed.nickname
  }
  if ('isFavorite' in body) {
    if (typeof body.isFavorite !== 'boolean') return fail('invalid_body', 400)
    patch.isFavorite = body.isFavorite
  }
  if (patch.nickname === undefined && patch.isFavorite === undefined) return fail('invalid_body', 400)

  db.update(pokemon)
    .set(patch)
    .where(and(eq(pokemon.id, id), eq(pokemon.userId, userId)))
    .run()

  return {
    ok: true,
    pokemon: {
      id,
      nickname: patch.nickname !== undefined ? patch.nickname : mon.nickname,
      isFavorite: patch.isFavorite !== undefined ? patch.isFavorite : mon.isFavorite,
    },
  }
}

function markCaught(
  userId: number,
  speciesId: number,
  isShiny: boolean,
  now: number,
  level = 0,
): void {
  const db = getDb()
  const existing = db
    .select({ speciesId: pokedexEntries.speciesId })
    .from(pokedexEntries)
    .where(and(eq(pokedexEntries.userId, userId), eq(pokedexEntries.speciesId, speciesId)))
    .get()
  if (!existing) {
    db.insert(pokedexEntries)
      .values({
        userId,
        speciesId,
        seenCount: 1,
        caughtCount: 1,
        firstSeenAt: now,
        firstCaughtAt: now,
        shinyCaught: isShiny,
        maxLevelReached: level,
      })
      .run()
    return
  }
  db.update(pokedexEntries)
    .set({
      seenCount: sql`${pokedexEntries.seenCount} + 1`,
      caughtCount: sql`${pokedexEntries.caughtCount} + 1`,
      firstSeenAt: sql`coalesce(${pokedexEntries.firstSeenAt}, ${now})`,
      firstCaughtAt: sql`coalesce(${pokedexEntries.firstCaughtAt}, ${now})`,
      shinyCaught: sql`(${pokedexEntries.shinyCaught} or ${isShiny ? 1 : 0})`,
      maxLevelReached: sql`max(${pokedexEntries.maxLevelReached}, ${level})`,
    })
    .where(and(eq(pokedexEntries.userId, userId), eq(pokedexEntries.speciesId, speciesId)))
    .run()
}

function evolutionsFrom(
  speciesId: number,
): { toSpeciesId: number; displayName: string; minLevel: number; viaTrade: boolean }[] {
  return getDb()
    .select({
      toSpeciesId: evolutions.toSpeciesId,
      displayName: species.displayName,
      minLevel: evolutions.minLevel,
      viaTrade: evolutions.viaTrade,
    })
    .from(evolutions)
    .innerJoin(species, eq(evolutions.toSpeciesId, species.id))
    .where(eq(evolutions.fromSpeciesId, speciesId))
    .all()
    .sort((a, b) => a.toSpeciesId - b.toSpeciesId)
}
