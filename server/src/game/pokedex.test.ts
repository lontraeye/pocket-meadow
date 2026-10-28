import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createPlayer } from '../auth/accounts.js'
import { hashToken } from '../auth/session.js'
import { authConfig } from '../config/auth.js'
import { obtainableSpeciesIds, pokedexConfig, rarityBand } from '../config/pokedex.js'
import { getDb, getSqlite, immediate } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'
import { pokedexClaims, pokedexEntries, pokemon, sessions, trainers } from '../db/schema.js'
import {
  buildAlbumBlockDefs,
  bumpMaxLevelReached,
  countClaimableBlocks,
  dexLayer,
  loadSpeciesRows,
  speciesDexView,
} from './pokedex.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-meadow-pokedex-'))
process.env.DATABASE_PATH = path.join(dir, 'meadow.sqlite')
const { pokedexRoutes } = await import('../routes/pokedex.js')

const app = new Hono().route('/pokedex', pokedexRoutes)
const env = { incoming: { socket: { remoteAddress: '203.0.113.7', remotePort: 1, remoteFamily: 'IPv4' } } }

function send(url: string, init: RequestInit = {}) {
  return app.request(url, init, env)
}

function loginCookie(username: string): { cookie: string; userId: number } {
  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  let userId = 0
  immediate(() => {
    const created = createPlayer({ username, googleSub: null, starter: 'bulbasaur', now })
    userId = created.userId
    getDb()
      .insert(sessions)
      .values({
        id: hashToken(token),
        userId,
        createdAt: now,
        expiresAt: now + authConfig.sessionTtlMs,
      })
      .run()
  })
  return { cookie: `${authConfig.cookieName}=${token}`, userId }
}

before(() => migrateDatabase())
after(() => {
  getSqlite().close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('rarityBand usa as faixas do config', () => {
  assert.equal(rarityBand(0.01), 'rare')
  assert.equal(rarityBand(pokedexConfig.rarity.rareMax), 'rare')
  assert.equal(rarityBand(0.05), 'uncommon')
  assert.equal(rarityBand(0.5), 'common')
})

test('dexLayer sobe só com progresso', () => {
  assert.equal(dexLayer(null), 'unknown')
  assert.equal(dexLayer({ seenCount: 1, caughtCount: 0, maxLevelReached: 99 }), 'seen')
  assert.equal(dexLayer({ seenCount: 1, caughtCount: 1, maxLevelReached: 5 }), 'caught')
  assert.equal(
    dexLayer({ seenCount: 1, caughtCount: 1, maxLevelReached: pokedexConfig.milestoneLocations }),
    'locations',
  )
  assert.equal(
    dexLayer({ seenCount: 1, caughtCount: 1, maxLevelReached: pokedexConfig.milestoneMoves }),
    'moves',
  )
})

test('speciesDexView não vaza camadas bloqueadas', () => {
  const sp = {
    id: 16,
    displayName: 'Pidgey',
    type1: 'normal',
    type2: 'flying',
    hp: 40,
    attack: 45,
    defense: 40,
    spAttack: 35,
    spDefense: 35,
    speed: 56,
    evolutionChainId: 10,
    evolutionStage: 1,
  }
  const unknown = speciesDexView(sp, null, [sp])
  assert.equal(unknown.layer, 'unknown')
  assert.equal(unknown.displayName, undefined)
  assert.equal(unknown.locations, undefined)
  assert.equal(unknown.moves, undefined)

  const seen = speciesDexView(sp, { speciesId: 16, seenCount: 1, caughtCount: 0, maxLevelReached: 0, shinyCaught: false }, [sp])
  assert.equal(seen.layer, 'seen')
  assert.equal(seen.displayName, 'Pidgey')
  assert.equal(seen.type1, undefined)
  assert.equal(seen.locations, undefined)

  const ivysaur = {
    id: 17,
    displayName: 'Pidgeotto',
    type1: 'normal',
    type2: 'flying',
    hp: 63,
    attack: 60,
    defense: 55,
    spAttack: 50,
    spDefense: 50,
    speed: 71,
    evolutionChainId: 6,
    evolutionStage: 2,
  }
  const pidgeot = {
    ...ivysaur,
    id: 18,
    displayName: 'Pidgeot',
    evolutionStage: 3,
  }
  const caught = speciesDexView(
    sp,
    { speciesId: 16, seenCount: 1, caughtCount: 1, maxLevelReached: 10, shinyCaught: false },
    [sp, ivysaur, pidgeot],
    new Set([16]),
  )
  assert.equal(caught.layer, 'caught')
  assert.equal(caught.type1, 'normal')
  assert.ok(caught.abilities)
  assert.equal(caught.locations, undefined)
  assert.equal(caught.moves, undefined)
  assert.equal(caught.nextUnlock?.unlocks, 'locations')
  assert.equal(caught.evolution?.[0]?.displayName, 'Pidgey')
  assert.equal(caught.evolution?.[1]?.displayName, undefined)
  assert.equal(caught.evolution?.[1]?.id, 17)
  assert.equal(caught.evolution?.[2]?.displayName, undefined)
})

test('blocos do álbum só têm espécies obtíveis; Kanto sem Mew nem iniciais', () => {
  assert.equal(pokedexConfig.albumVersion, 2)
  const obtainable = obtainableSpeciesIds()
  assert.equal(obtainable.has(151), false) // Mew
  assert.equal(obtainable.has(1), false) // Bulbasaur
  assert.equal(obtainable.has(4), false)
  assert.equal(obtainable.has(7), false)
  assert.equal(obtainable.has(16), true)

  const blocks = buildAlbumBlockDefs(loadSpeciesRows())
  for (const block of blocks) {
    for (const id of block.speciesIds) {
      assert.ok(obtainable.has(id), `${block.key} tem espécie não obtível ${id}`)
    }
  }
  const kanto = blocks.find((block) => block.key === `game:kanto:v${pokedexConfig.albumVersion}`)
  assert.ok(kanto)
  assert.ok(!kanto.speciesIds.includes(151))
  assert.ok(!kanto.speciesIds.includes(1))
  assert.ok(!kanto.speciesIds.includes(4))
  assert.ok(!kanto.speciesIds.includes(7))
  assert.ok(kanto.speciesIds.includes(16))
  assert.equal(
    blocks.some((block) => block.key === `chain:1:v${pokedexConfig.albumVersion}`),
    false,
  )
})

test('GET /pokedex devolve só o liberado e as contagens', async () => {
  const { cookie, userId } = loginCookie('dex-ash')
  immediate(() => {
    getDb()
      .insert(pokedexEntries)
      .values({
        userId,
        speciesId: 16,
        seenCount: 1,
        caughtCount: 0,
        firstSeenAt: Date.now(),
        maxLevelReached: 0,
      })
      .run()
  })

  const res = await send('/pokedex', { headers: { cookie } })
  assert.equal(res.status, 200)
  const body = (await res.json()) as {
    total: number
    seen: number
    caught: number
    species: { id: number; layer: string; displayName?: string; type1?: string }[]
  }
  assert.equal(body.total, 251)
  assert.ok(body.seen >= 2) // inicial + pidgey
  assert.ok(body.caught >= 1)
  const unknown = body.species.find((row) => row.id === 150)
  assert.equal(unknown?.layer, 'unknown')
  assert.equal(unknown?.displayName, undefined)
  const seen = body.species.find((row) => row.id === 16)
  assert.equal(seen?.layer, 'seen')
  assert.equal(seen?.displayName, 'Pidgey')
  assert.equal(seen?.type1, undefined)
  const starter = body.species.find((row) => row.id === 1)
  assert.ok(starter && starter.layer !== 'unknown')
})

test('claim do álbum: incompleto, ok e doble recusado', async () => {
  const { cookie, userId } = loginCookie('dex-claim')
  const blocksRes = await send('/pokedex/blocks', { headers: { cookie } })
  assert.equal(blocksRes.status, 200)
  const { blocks } = (await blocksRes.json()) as {
    blocks: { key: string; complete: boolean; claimed: boolean; total: number }[]
  }
  const chainKey = `chain:6:v${pokedexConfig.albumVersion}`
  const chain = blocks.find((block) => block.key === chainKey)
  assert.ok(chain)
  assert.equal(chain.complete, false)

  const denied = await send(`/pokedex/blocks/${chain.key}/claim`, {
    method: 'POST',
    headers: { cookie },
  })
  assert.equal(denied.status, 400)
  assert.deepEqual(await denied.json(), { error: 'block_incomplete' })

  // Completa a linha do Pidgey (16–17–18).
  immediate(() => {
    const now = Date.now()
    for (const speciesId of [16, 17, 18]) {
      getDb()
        .insert(pokedexEntries)
        .values({
          userId,
          speciesId,
          seenCount: 1,
          caughtCount: 1,
          firstSeenAt: now,
          firstCaughtAt: now,
          maxLevelReached: 20,
        })
        .onConflictDoUpdate({
          target: [pokedexEntries.userId, pokedexEntries.speciesId],
          set: { caughtCount: 1, maxLevelReached: 20 },
        })
        .run()
    }
  })
  const first = await send(`/pokedex/blocks/${chain.key}/claim`, {
    method: 'POST',
    headers: { cookie },
  })
  assert.equal(first.status, 200)
  const claimed = (await first.json()) as {
    reward: { genericCandies: number; energy: number; items: { itemKey: string; quantity: number }[] }
    genericCandies: number
  }
  assert.ok(claimed.reward.genericCandies > 0 || claimed.reward.items.length > 0)

  const again = await send(`/pokedex/blocks/${chain.key}/claim`, {
    method: 'POST',
    headers: { cookie },
  })
  assert.equal(again.status, 409)
  assert.deepEqual(await again.json(), { error: 'block_claimed' })

  const claims = getDb()
    .select()
    .from(pokedexClaims)
    .where(eq(pokedexClaims.userId, userId))
    .all()
  assert.equal(claims.filter((row) => row.blockKey === chain.key).length, 1)
})

test('countClaimableBlocks = completos menos resgatados', async () => {
  const { cookie, userId } = loginCookie('dex-claimable')
  assert.equal(countClaimableBlocks(userId), 0)

  immediate(() => {
    const now = Date.now()
    // Rota 1: Pidgey (16) e Rattata (19).
    for (const speciesId of [16, 19]) {
      getDb()
        .insert(pokedexEntries)
        .values({
          userId,
          speciesId,
          seenCount: 1,
          caughtCount: 1,
          firstSeenAt: now,
          firstCaughtAt: now,
          maxLevelReached: 5,
        })
        .onConflictDoUpdate({
          target: [pokedexEntries.userId, pokedexEntries.speciesId],
          set: { caughtCount: 1 },
        })
        .run()
    }
  })
  assert.equal(countClaimableBlocks(userId), 1)

  const key = `region:route-1:v${pokedexConfig.albumVersion}`
  const claimed = await send(`/pokedex/blocks/${key}/claim`, { method: 'POST', headers: { cookie } })
  assert.equal(claimed.status, 200)
  assert.equal(countClaimableBlocks(userId), 0)

  const blocksRes = await send('/pokedex/blocks', { headers: { cookie } })
  const { blocks } = (await blocksRes.json()) as {
    blocks: { complete: boolean; claimed: boolean }[]
  }
  const expected = blocks.filter((block) => block.complete && !block.claimed).length
  assert.equal(countClaimableBlocks(userId), expected)
})

test('GET /pokedex não devolve nome de evolução não vista', async () => {
  const { cookie } = loginCookie('dex-evo-names')
  const res = await send('/pokedex', { headers: { cookie } })
  assert.equal(res.status, 200)
  const body = (await res.json()) as {
    species: {
      id: number
      evolution?: { id: number; displayName?: string }[]
    }[]
  }
  const starter = body.species.find((row) => row.id === 1)
  assert.ok(starter?.evolution)
  const unseen = starter.evolution.filter((row) => row.id !== 1)
  assert.ok(unseen.length >= 1)
  for (const row of unseen) {
    assert.equal(row.displayName, undefined)
  }
  const self = starter.evolution.find((row) => row.id === 1)
  assert.equal(self?.displayName, 'Bulbasaur')
})

test('bumpMaxLevelReached sobe e não desce', () => {
  const { userId } = loginCookie('dex-bump')
  immediate(() => {
    bumpMaxLevelReached(userId, 1, 10)
    bumpMaxLevelReached(userId, 1, 8)
    bumpMaxLevelReached(userId, 1, 16)
  })
  const row = getDb()
    .select({ maxLevelReached: pokedexEntries.maxLevelReached })
    .from(pokedexEntries)
    .where(eq(pokedexEntries.userId, userId))
    .get()
  // createPlayer já botou o inicial no Nv 5; bump 16 deve vencer.
  assert.equal(row?.maxLevelReached, 16)

  immediate(() => {
    getDb()
      .update(pokemon)
      .set({ level: 18 })
      .where(eq(pokemon.userId, userId))
      .run()
    bumpMaxLevelReached(userId, 1, 18)
  })
  const again = getDb()
    .select({ maxLevelReached: pokedexEntries.maxLevelReached, energy: trainers.energy })
    .from(pokedexEntries)
    .innerJoin(trainers, eq(trainers.userId, pokedexEntries.userId))
    .where(eq(pokedexEntries.userId, userId))
    .get()
  assert.equal(again?.maxLevelReached, 18)
})
