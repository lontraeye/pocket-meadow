import { and, eq, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { TREES, treeDef } from '../config/apricorn.js'
import { berries } from '../config/berries.js'
import { harvestApricorns, treesView } from '../db/apricorn.js'
import { benchView, cancelJob, collectJob, setOperator, startJob, startUpgrade } from '../db/bench.js'
import { healMachinesView, useHealMachine } from '../db/healMachine.js'
import { GENERIC_CANDY_GIFT, petConfig } from '../config/pets.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { recordEvent } from '../db/events.js'
import { creditItems, debitItem } from '../db/inventory.js'
import { gardenGifts, pokemon, species, trainers } from '../db/schema.js'
import { checkedHabitats, residentsOf } from '../db/habitat.js'
import { currentChapter } from '../db/visitors.js'
import { habitatVisitors } from '../db/schema.js'
import { loadRegions } from '../config/regions.js'
import { createEncounter } from './encounters.js'
import { canLiveInKind } from '../game/habitat/index.js'
import { petReadyAt } from '../game/pets.js'
import { type Failure, fail, parseId, readObject } from './http.js'

// Cuidado como pet (PLANNING.md, seção 5.21): carinho, berry como comida e
// presentes no chão. O catch-up liquida o jardim antes de cada ação.
export const gardenRoutes = new Hono<AuthEnv>()

type PetView = { pokemonId: number; hunger: number; affection: number; happiness: number; petReadyAt: number | null }

gardenRoutes.post('/pets/:id/pet', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => pet(c.get('userId'), id, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.pet)
})

gardenRoutes.post('/pets/:id/snack', requireUser, async (c) => {
  const id = parseId(c.req.param('id'))
  const body = await readObject(c)
  const berryKey = body?.berryKey
  if (id === null || typeof berryKey !== 'string' || !(berryKey in berries)) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const result = immediate(() => snack(c.get('userId'), id, berryKey, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.pet)
})

// Casa no habitat (PLANNING 5.22): `habitatId` do habitat, ou null para sair.
// O habitat precisa estar pronto, ser de um dos tipos dele (ou básico) e ter vaga.
gardenRoutes.post('/pets/:id/home', requireUser, async (c) => {
  const id = parseId(c.req.param('id'))
  const habitatId = (await readObject(c))?.habitatId
  const valid = habitatId === null || (typeof habitatId === 'number' && Number.isInteger(habitatId))
  if (id === null || !valid) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => setHome(c.get('userId'), id, habitatId as number | null, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json({ habitatId })
})

function setHome(userId: number, pokemonId: number, habitatId: number | null, now: number): { ok: true } | Failure {
  persistCatchUp(userId, now)
  const found = gardenPet(userId, pokemonId)
  if (!found.ok) return found
  const db = getDb()
  if (habitatId !== null) {
    const home = checkedHabitats(userId).find((row) => row.id === habitatId)
    if (!home) return fail('habitat_not_found', 404)
    if (!home.check.ready) return fail('habitat_not_ready', 400)
    const kinds = db
      .select({ type1: species.type1, type2: species.type2 })
      .from(pokemon)
      .innerJoin(species, eq(species.id, pokemon.speciesId))
      .where(eq(pokemon.id, pokemonId))
      .get()!
    if (!canLiveInKind(kinds.type2 ? [kinds.type1, kinds.type2] : [kinds.type1], home.kind)) return fail('wrong_habitat', 400)
    if (residentsOf(userId, habitatId, pokemonId) >= home.check.capacity) return fail('habitat_full', 400)
  }
  db.update(pokemon).set({ habitatId }).where(eq(pokemon.id, pokemonId)).run()
  return { ok: true }
}

// Visitante (5.22): tocar abre o encontro com ele, sem energia (o mesmo
// encontro do campo: luta e captura). Ele sai do habitat ao começar.
gardenRoutes.post('/visitors/:id/encounter', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => {
    persistCatchUp(userId, now)
    const db = getDb()
    const visitor = db
      .select()
      .from(habitatVisitors)
      .where(and(eq(habitatVisitors.id, id), eq(habitatVisitors.userId, userId)))
      .get()
    if (!visitor) return fail('visitor_not_found', 404)
    // A área de onde ele vem: a primeira aberta em que a espécie aparece.
    const chapter = currentChapter(userId)
    const open = loadRegions().filter((region) => region.chapter !== null && region.chapter <= chapter)
    const region =
      open.find((row) =>
        [row.slots, ...Object.values(row.methods)].some((table) => table?.some((slot) => slot.speciesId === visitor.speciesId)),
      ) ?? open[0]
    if (!region) return fail('region_not_found', 404)
    const created = createEncounter(
      userId,
      region,
      now,
      { speciesId: visitor.speciesId, level: visitor.level, isShiny: visitor.isShiny },
      { free: true },
    )
    if (!created.ok) return created
    db.delete(habitatVisitors).where(eq(habitatVisitors.id, id)).run()
    return created
  })
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.encounter, 201)
})

// Alimentar todos (PROGRESSAO.md, 4.2): 1 berry por Pokémon com fome, do mais
// faminto ao menos, até a berry acabar. `ids` limita (ex.: só o time).
gardenRoutes.post('/pets/feed-all', requireUser, async (c) => {
  const body = await readObject(c)
  const berryKey = body?.berryKey
  const ids = body?.ids
  if (typeof berryKey !== 'string' || !(berryKey in berries)) return c.json({ error: 'invalid_body' }, 400)
  if (ids !== undefined && (!Array.isArray(ids) || !ids.every((id) => typeof id === 'number' && Number.isInteger(id)))) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  const userId = c.get('userId')
  const now = Date.now()
  const fed = immediate(() => {
    persistCatchUp(userId, now)
    const db = getDb()
    const only = ids ? new Set(ids as number[]) : null
    const hungry = db
      .select({ id: pokemon.id, hunger: pokemon.hunger })
      .from(pokemon)
      .where(and(eq(pokemon.userId, userId), eq(pokemon.location, 'garden'), eq(pokemon.inPc, false)))
      .all()
      .filter((row) => row.hunger < petConfig.fullAt && (!only || only.has(row.id)))
      .sort((a, b) => a.hunger - b.hunger)
    let count = 0
    for (const row of hungry) {
      if (!debitItem(userId, `berry:${berryKey}`)) break
      db.update(pokemon)
        .set({ hunger: Math.min(100, row.hunger + petConfig.berryFill) })
        .where(eq(pokemon.id, row.id))
        .run()
      count += 1
    }
    if (count > 0) recordEvent(userId, 'pet_fed', count, now)
    return { fed: count, hungry: hungry.length }
  })
  if (fed.fed === 0) return c.json({ error: fed.hungry === 0 ? 'not_hungry' : 'no_berry' }, 400)
  return c.json(fed)
})

gardenRoutes.post('/gifts/:id/collect', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => collect(c.get('userId'), id, Date.now()))
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json(result.gift)
})

/** Um `id` inteiro opcional no corpo: ausente = undefined; inválido = null. */
function optionalId(body: Record<string, unknown> | null): number | undefined | null {
  const id = body?.id
  if (id === undefined) return undefined
  return typeof id === 'number' && Number.isInteger(id) ? id : null
}

// Árvores de Apricorn (5.23): colhe tudo o que está pendurado. Cada árvore é
// uma peça: `id` diz qual. Sem `id`, a primeira do tipo `key` (sem `key`, a
// vermelha), de preferência a que está no jardim.
gardenRoutes.post('/tree/harvest', requireUser, async (c) => {
  const body = (await readObject(c)) ?? {}
  const id = optionalId(body)
  const key = body.key === undefined ? TREES[0]!.key : body.key
  const tree = typeof key === 'string' ? treeDef(key) : null
  if (id === null || (id === undefined && !tree)) return c.json({ error: 'invalid_body' }, 400)
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => {
    persistCatchUp(userId, now)
    const trees = treesView(userId, now)
    const ofKind = trees.filter((row) => row.key === tree?.key)
    const view = id !== undefined ? trees.find((row) => row.id === id) : (ofKind.find((row) => row.placed) ?? ofKind[0])
    if (!view) return fail('tree_locked', 400)
    if (!view.placed) return fail('not_placed', 400)
    const harvested = harvestApricorns(userId, now, view.id)
    if (harvested === null) return fail('nothing_ready', 400)
    return { ok: true as const, harvested, itemKey: view.itemKey, trees: treesView(userId, now) }
  })
  if (!result.ok) return c.json(errorBody(result), result.status)
  return c.json({ itemKey: result.itemKey, quantity: result.harvested, trees: result.trees })
})

// Bancada de bolas (5.23): operador, lote, coletar e cancelar. Cada bancada é
// uma peça: `id` no corpo diz qual (sem `id`, a primeira). Cada ação devolve a
// bancada atualizada.
gardenRoutes.post('/bench/operator', requireUser, async (c) => {
  const body = await readObject(c)
  const pokemonId = body?.pokemonId
  const id = optionalId(body)
  if ((pokemonId !== null && (typeof pokemonId !== 'number' || !Number.isInteger(pokemonId))) || id === null) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  return benchAction(c.get('userId'), id, (userId, now) => setOperator(userId, pokemonId, now, id), c)
})

gardenRoutes.post('/bench/start', requireUser, async (c) => {
  const body = await readObject(c)
  const quantity = body?.quantity
  const recipeKey = body?.recipeKey === undefined ? 'poke_ball' : body.recipeKey
  const id = optionalId(body)
  if (typeof quantity !== 'number' || typeof recipeKey !== 'string' || id === null) {
    return c.json({ error: 'invalid_body' }, 400)
  }
  return benchAction(c.get('userId'), id, (userId, now) => startJob(userId, recipeKey, quantity, now, id), c)
})

// Upgrade da bancada: gasta o custo agora e ela fica parada até terminar.
gardenRoutes.post('/bench/upgrade', requireUser, async (c) => {
  const id = optionalId(await readObject(c))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  return benchAction(c.get('userId'), id, (userId, now) => startUpgrade(userId, now, id), c)
})

gardenRoutes.post('/bench/collect', requireUser, async (c) => {
  const id = optionalId(await readObject(c))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  return benchAction(c.get('userId'), id, (userId, now) => collectJob(userId, now, id), c)
})

gardenRoutes.post('/bench/cancel', requireUser, async (c) => {
  const id = optionalId(await readObject(c))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  return benchAction(c.get('userId'), id, (userId, now) => cancelJob(userId, now, id), c)
})

// Máquina de cura (PROGRESSAO.md, item 4): 1 carga cura a equipe toda. `id`
// diz qual máquina; sem ele, a do jardim com mais cargas (a cura antes da luta).
gardenRoutes.post('/heal-machine/use', requireUser, async (c) => {
  const id = optionalId(await readObject(c))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  const userId = c.get('userId')
  const now = Date.now()
  const result = immediate(() => {
    persistCatchUp(userId, now)
    const out = useHealMachine(userId, now, id)
    if (!out.ok) return out
    return { ok: true as const, healed: out.healed, machineId: out.machineId, healMachines: healMachinesView(userId, now) }
  })
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ healed: result.healed, machineId: result.machineId, healMachines: result.healMachines })
})

function benchAction(
  userId: number,
  id: number | undefined,
  action: (userId: number, now: number) => { ok: true } | { ok: false; error: string },
  c: Context<AuthEnv>,
) {
  const now = Date.now()
  const result = immediate(() => {
    persistCatchUp(userId, now)
    const out = action(userId, now)
    if (!out.ok) return out
    return { ...out, bench: benchView(userId, now, id) }
  })
  if (!result.ok) return c.json({ error: result.error }, 400)
  const { ok: _ok, ...body } = result
  return c.json(body)
}

function errorBody(result: Failure): { error: string; readyAt?: number } {
  return { error: result.error, ...(result.readyAt !== undefined ? { readyAt: result.readyAt } : {}) }
}

function gardenPet(userId: number, pokemonId: number) {
  const row = getDb()
    .select({
      id: pokemon.id,
      location: pokemon.location,
      inPc: pokemon.inPc,
      hunger: pokemon.hunger,
      affection: pokemon.affection,
      happiness: pokemon.happiness,
      lastPetAt: pokemon.lastPetAt,
    })
    .from(pokemon)
    .where(and(eq(pokemon.id, pokemonId), eq(pokemon.userId, userId)))
    .get()
  if (!row) return fail('pokemon_not_found', 404)
  if (row.inPc) return fail('in_pc', 400)
  if (row.location !== 'garden') return fail('in_daycare', 400)
  return { ok: true as const, row }
}

function pet(userId: number, pokemonId: number, now: number): { ok: true; pet: PetView } | Failure {
  persistCatchUp(userId, now)
  const found = gardenPet(userId, pokemonId)
  if (!found.ok) return found
  const readyAt = petReadyAt(found.row.lastPetAt, now)
  if (readyAt !== null) return fail('pet_cooldown', 400, { readyAt })
  const affection = Math.min(100, found.row.affection + petConfig.petAmount)
  getDb().update(pokemon).set({ affection, lastPetAt: now }).where(eq(pokemon.id, pokemonId)).run()
  return { ok: true, pet: view({ ...found.row, affection, lastPetAt: now }, now) }
}

function snack(userId: number, pokemonId: number, berryKey: string, now: number): { ok: true; pet: PetView } | Failure {
  persistCatchUp(userId, now)
  const found = gardenPet(userId, pokemonId)
  if (!found.ok) return found
  if (found.row.hunger >= petConfig.fullAt) return fail('not_hungry', 400)
  if (!debitItem(userId, `berry:${berryKey}`)) return fail('no_berry', 400)
  const hunger = Math.min(100, found.row.hunger + petConfig.berryFill)
  getDb().update(pokemon).set({ hunger }).where(eq(pokemon.id, pokemonId)).run()
  recordEvent(userId, 'pet_fed', 1, now)
  return { ok: true, pet: view({ ...found.row, hunger }, now) }
}

function collect(
  userId: number,
  giftId: number,
  now: number,
): { ok: true; gift: { itemKey: string; quantity: number } } | Failure {
  persistCatchUp(userId, now)
  const db = getDb()
  const gift = db
    .select({ itemKey: gardenGifts.itemKey, quantity: gardenGifts.quantity })
    .from(gardenGifts)
    .where(and(eq(gardenGifts.id, giftId), eq(gardenGifts.userId, userId)))
    .get()
  if (!gift) return fail('gift_not_found', 404)
  db.delete(gardenGifts).where(eq(gardenGifts.id, giftId)).run()
  if (gift.itemKey === GENERIC_CANDY_GIFT) {
    db.update(trainers)
      .set({ genericCandies: sql`${trainers.genericCandies} + ${gift.quantity}`, updatedAt: now })
      .where(eq(trainers.userId, userId))
      .run()
  } else {
    creditItems(userId, [{ itemKey: gift.itemKey, quantity: gift.quantity }])
  }
  return { ok: true, gift }
}

export function view(
  row: { id: number; hunger: number; affection: number; happiness: number; lastPetAt: number | null },
  now: number,
): PetView {
  return {
    pokemonId: row.id,
    hunger: Math.round(row.hunger),
    affection: Math.round(row.affection),
    happiness: Math.round(row.happiness),
    petReadyAt: petReadyAt(row.lastPetAt, now),
  }
}
