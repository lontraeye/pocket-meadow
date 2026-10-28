import { Hono } from 'hono'
import { and, eq, sql } from 'drizzle-orm'
import type { AuthEnv } from '../auth/session.js'
import { requireUser } from '../auth/session.js'
import { pokedexConfig } from '../config/pokedex.js'
import { trainerConfig } from '../config/trainer.js'
import { getDb, immediate } from '../db/client.js'
import { creditItems } from '../db/inventory.js'
import { pokedexClaims, pokedexEntries, trainers } from '../db/schema.js'
import { persistCatchUp } from '../db/catchUp.js'
import {
  buildAlbumBlockDefs,
  loadSpeciesRows,
  rewardPayload,
  speciesDexView,
} from '../game/pokedex.js'

export const pokedexRoutes = new Hono<AuthEnv>()

pokedexRoutes.get('/', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  persistCatchUp(userId, now)

  const all = loadSpeciesRows()
  const entries = getDb()
    .select({
      speciesId: pokedexEntries.speciesId,
      seenCount: pokedexEntries.seenCount,
      caughtCount: pokedexEntries.caughtCount,
      maxLevelReached: pokedexEntries.maxLevelReached,
      shinyCaught: pokedexEntries.shinyCaught,
    })
    .from(pokedexEntries)
    .where(eq(pokedexEntries.userId, userId))
    .all()
  const byId = new Map(entries.map((row) => [row.speciesId, row]))

  const byChain = new Map<number, typeof all>()
  for (const sp of all) {
    const list = byChain.get(sp.evolutionChainId) ?? []
    list.push(sp)
    byChain.set(sp.evolutionChainId, list)
  }

  const seenIds = new Set(
    entries.filter((row) => row.seenCount > 0).map((row) => row.speciesId),
  )
  let seen = 0
  let caught = 0
  const species = all.map((sp) => {
    const entry = byId.get(sp.id) ?? null
    if (entry && entry.seenCount > 0) seen += 1
    if (entry && entry.caughtCount > 0) caught += 1
    const line = [...(byChain.get(sp.evolutionChainId) ?? [])].sort(
      (a, b) => a.evolutionStage - b.evolutionStage || a.id - b.id,
    )
    return speciesDexView(sp, entry, line, seenIds)
  })

  return c.json({
    total: pokedexConfig.lastId - pokedexConfig.firstId + 1,
    seen,
    caught,
    milestones: {
      locations: pokedexConfig.milestoneLocations,
      moves: pokedexConfig.milestoneMoves,
    },
    species,
  })
})

pokedexRoutes.get('/blocks', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  persistCatchUp(userId, now)

  const all = loadSpeciesRows()
  const defs = buildAlbumBlockDefs(all)
  const caught = new Set(
    getDb()
      .select({ speciesId: pokedexEntries.speciesId })
      .from(pokedexEntries)
      .where(and(eq(pokedexEntries.userId, userId), sql`${pokedexEntries.caughtCount} > 0`))
      .all()
      .map((row) => row.speciesId),
  )
  const claimed = new Set(
    getDb()
      .select({ blockKey: pokedexClaims.blockKey })
      .from(pokedexClaims)
      .where(eq(pokedexClaims.userId, userId))
      .all()
      .map((row) => row.blockKey),
  )

  const blocks = defs.map((block) => {
    const done = block.speciesIds.filter((id) => caught.has(id)).length
    const complete = done >= block.speciesIds.length && block.speciesIds.length > 0
    return {
      key: block.key,
      kind: block.kind,
      title: block.title,
      total: block.speciesIds.length,
      caught: done,
      complete,
      claimed: claimed.has(block.key),
      reward: rewardPayload(block.reward),
    }
  })

  return c.json({ blocks })
})

pokedexRoutes.post('/blocks/:key/claim', requireUser, async (c) => {
  const userId = c.get('userId')
  const key = c.req.param('key')
  const now = Date.now()

  const result = immediate(() => {
    persistCatchUp(userId, now)

    const all = loadSpeciesRows()
    const block = buildAlbumBlockDefs(all).find((row) => row.key === key)
    if (!block) return { ok: false as const, error: 'block_not_found' as const, status: 404 as const }

    const db = getDb()
    const already = db
      .select({ blockKey: pokedexClaims.blockKey })
      .from(pokedexClaims)
      .where(and(eq(pokedexClaims.userId, userId), eq(pokedexClaims.blockKey, key)))
      .get()
    if (already) return { ok: false as const, error: 'block_claimed' as const, status: 409 as const }

    const caught = new Set(
      db
        .select({ speciesId: pokedexEntries.speciesId })
        .from(pokedexEntries)
        .where(and(eq(pokedexEntries.userId, userId), sql`${pokedexEntries.caughtCount} > 0`))
        .all()
        .map((row) => row.speciesId),
    )
    if (!block.speciesIds.every((id) => caught.has(id))) {
      return { ok: false as const, error: 'block_incomplete' as const, status: 400 as const }
    }

    const inserted = db
      .insert(pokedexClaims)
      .values({ userId, blockKey: key, claimedAt: now })
      .run()
    if (inserted.changes !== 1) {
      return { ok: false as const, error: 'block_claimed' as const, status: 409 as const }
    }

    creditItems(userId, block.reward.items)

    const trainer = db
      .select({
        energy: trainers.energy,
        energyUpdatedAt: trainers.energyUpdatedAt,
        genericCandies: trainers.genericCandies,
      })
      .from(trainers)
      .where(eq(trainers.userId, userId))
      .get()
    if (!trainer) throw new Error('trainer missing')

    let energy = trainer.energy
    let energyUpdatedAt = trainer.energyUpdatedAt
    if (block.reward.energy > 0) {
      const next = Math.min(trainerConfig.energyMax, trainer.energy + block.reward.energy)
      if (next !== trainer.energy) {
        energy = next
        if (energy >= trainerConfig.energyMax) energyUpdatedAt = now
        db.update(trainers)
          .set({ energy, energyUpdatedAt, updatedAt: now })
          .where(eq(trainers.userId, userId))
          .run()
      }
    }

    let genericCandies = trainer.genericCandies
    if (block.reward.genericCandies > 0) {
      genericCandies = trainer.genericCandies + block.reward.genericCandies
      db.update(trainers)
        .set({ genericCandies, updatedAt: now })
        .where(eq(trainers.userId, userId))
        .run()
    }

    return {
      ok: true as const,
      claim: {
        key: block.key,
        title: block.title,
        reward: rewardPayload(block.reward),
        energy,
        genericCandies,
      },
    }
  })

  if (!result.ok) {
    if (result.status === 404) return c.json({ error: result.error }, 404)
    if (result.status === 409) return c.json({ error: result.error }, 409)
    return c.json({ error: result.error }, 400)
  }
  return c.json(result.claim)
})
