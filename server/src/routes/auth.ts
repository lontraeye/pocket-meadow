import { createHash, randomBytes } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import { SqliteError } from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { getConnInfo } from '@hono/node-server/conninfo'
import { authConfig } from '../config/auth.js'
import { type StarterKey, trainerConfig } from '../config/trainer.js'
import { getDb, immediate } from '../db/client.js'
import { authEvents, inventory, pokedexEntries, pokemon, sessions, species, trainers, users } from '../db/schema.js'

export const authRoutes = new Hono()

authRoutes.post('/register', async (c) => {
  const parsed = await readBody(c)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const username = asUsername(parsed.body.username)
  if (!username) {
    return c.json(
      { error: `username must be ${authConfig.usernameMin}–${authConfig.usernameMax} letters, numbers, or underscores` },
      400,
    )
  }
  const password = asPassword(parsed.body.password)
  if (!password) {
    return c.json(
      { error: `password must be ${authConfig.passwordMin}–${authConfig.passwordMax} characters` },
      400,
    )
  }
  const starter = parsed.body.starter
  if (!isStarter(starter)) return c.json({ error: 'choose bulbasaur, charmander, or squirtle' }, 400)

  const db = getDb()
  const starterSpecies = db.select({ id: species.id }).from(species).where(eq(species.id, trainerConfig.starters[starter])).get()
  if (!starterSpecies) return c.json({ error: 'starter species is not seeded' }, 500)

  const now = Date.now()
  const passwordHash = await hash(password)
  const meta = requestMeta(c)
  const token = randomBytes(32).toString('base64url')

  try {
    immediate(() => {
      const user = db
        .insert(users)
        .values({ username, passwordHash, createdAt: now })
        .returning({ id: users.id })
        .get()
      if (!user) throw new Error('failed to create user')

      db.insert(trainers)
        .values({
          userId: user.id,
          energy: trainerConfig.energyMax,
          energyUpdatedAt: now,
          updatedAt: now,
        })
        .run()

      db.insert(pokemon)
        .values({
          userId: user.id,
          speciesId: starterSpecies.id,
          level: trainerConfig.starterLevel,
          caughtAt: now,
          originalSpeciesId: starterSpecies.id,
        })
        .run()

      db.insert(pokedexEntries)
        .values({
          userId: user.id,
          speciesId: starterSpecies.id,
          seenCount: 1,
          caughtCount: 1,
          firstSeenAt: now,
          firstCaughtAt: now,
        })
        .run()

      db.insert(inventory)
        .values(trainerConfig.startingItems.map((item) => ({ userId: user.id, ...item })))
        .run()

      db.insert(sessions)
        .values({
          id: hashToken(token),
          userId: user.id,
          createdAt: now,
          expiresAt: now + authConfig.sessionTtlMs,
        })
        .run()

      db.insert(authEvents)
        .values({ userId: user.id, event: 'register', ip: meta.ip, userAgent: meta.userAgent, createdAt: now })
        .run()
    })
  } catch (error) {
    if (error instanceof SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'username is taken' }, 409)
    }
    throw error
  }

  setSessionCookie(c, token)
  return c.json(
    {
      username,
      starter: { speciesId: starterSpecies.id, level: trainerConfig.starterLevel },
    },
    201,
  )
})

authRoutes.post('/login', async (c) => {
  const parsed = await readBody(c)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const username = asUsername(parsed.body.username)
  const password = asPassword(parsed.body.password)
  if (!username || !password) return c.json({ error: 'invalid username or password' }, 401)

  const db = getDb()
  const user = db
    .select({ id: users.id, passwordHash: users.passwordHash, username: users.username })
    .from(users)
    .where(eq(users.username, username))
    .get()
  const valid = user !== undefined && (await verify(user.passwordHash, password))
  if (!user || !valid) return c.json({ error: 'invalid username or password' }, 401)

  const now = Date.now()
  const token = randomBytes(32).toString('base64url')
  const meta = requestMeta(c)
  immediate(() => {
    db.insert(sessions)
      .values({
        id: hashToken(token),
        userId: user.id,
        createdAt: now,
        expiresAt: now + authConfig.sessionTtlMs,
      })
      .run()
    db.insert(authEvents)
      .values({ userId: user.id, event: 'login', ip: meta.ip, userAgent: meta.userAgent, createdAt: now })
      .run()
  })

  setSessionCookie(c, token)
  return c.json({ username: user.username })
})

authRoutes.post('/logout', (c) => {
  const session = currentSession(c)
  if (!session) return c.json({ error: 'not signed in' }, 401)

  const meta = requestMeta(c)
  const now = Date.now()
  immediate(() => {
    getDb().insert(authEvents)
      .values({ userId: session.userId, event: 'logout', ip: meta.ip, userAgent: meta.userAgent, createdAt: now })
      .run()
    getDb().delete(sessions).where(eq(sessions.id, session.id)).run()
  })

  deleteCookie(c, authConfig.cookieName, { path: '/' })
  return c.body(null, 204)
})

function currentSession(c: Context) {
  const token = getCookie(c, authConfig.cookieName)
  if (!token) return undefined
  const id = hashToken(token)
  const db = getDb()
  const session = db.select().from(sessions).where(eq(sessions.id, id)).get()
  if (!session) return undefined
  if (session.expiresAt <= Date.now()) {
    db.delete(sessions).where(eq(sessions.id, id)).run()
    return undefined
  }
  return session
}

function setSessionCookie(c: Context, token: string) {
  setCookie(c, authConfig.cookieName, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: authConfig.sessionTtlMs / 1000,
  })
}

function requestMeta(c: Context): { ip: string; userAgent: string | null } {
  const socketIp = getConnInfo(c).remote.address ?? 'unknown'
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = process.env.TRUST_PROXY === '1' && forwarded ? forwarded : socketIp
  const userAgent = c.req.header('user-agent')?.slice(0, authConfig.userAgentMax) ?? null
  return { ip, userAgent }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

async function readBody(c: Context): Promise<{ ok: true; body: { username?: unknown; password?: unknown; starter?: unknown } } | { ok: false; error: string }> {
  try {
    const body = await c.req.json()
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, error: 'expected a JSON object' }
    }
    return { ok: true, body }
  } catch {
    return { ok: false, error: 'expected JSON' }
  }
}

function asUsername(value: unknown): string | undefined {
  if (typeof value !== 'string' || !authConfig.usernamePattern.test(value)) return undefined
  if (value.length < authConfig.usernameMin || value.length > authConfig.usernameMax) return undefined
  return value
}

function asPassword(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length < authConfig.passwordMin || value.length > authConfig.passwordMax) {
    return undefined
  }
  return value
}

function isStarter(value: unknown): value is StarterKey {
  return value === 'bulbasaur' || value === 'charmander' || value === 'squirtle'
}
