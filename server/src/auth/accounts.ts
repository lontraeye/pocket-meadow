import { randomBytes } from 'node:crypto'
import { getConnInfo } from '@hono/node-server/conninfo'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { setCookie } from 'hono/cookie'
import { authConfig } from '../config/auth.js'
import { type StarterKey, trainerConfig } from '../config/trainer.js'
import { getDb } from '../db/client.js'
import { authEvents, inventory, pokedexEntries, pokemon, sessions, species, trainers, users } from '../db/schema.js'
import { mulberry32, randomSeed } from '../game/rng.js'
import { traitColumns } from '../game/traitValues.js'
import { rollTraits, traitsRngSeed } from '../game/traits.js'
import { abilitiesFor, learnsetFor, movesByName } from '../seed/traitsData.js'
import { hashToken } from './session.js'

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function asUsername(value: unknown): string | undefined {
  if (typeof value !== 'string' || !authConfig.usernamePattern.test(value)) return undefined
  if (value.length < authConfig.usernameMin || value.length > authConfig.usernameMax) return undefined
  return value
}

export function isStarter(value: unknown): value is StarterKey {
  return typeof value === 'string' && Object.hasOwn(trainerConfig.starters, value)
}

/** Usuário + treinador + inicial + itens. Chamar dentro de immediate(). */
export function createPlayer(input: {
  username: string
  googleSub: string | null
  starter: StarterKey
  now: number
}): { userId: number; starterSpeciesId: number } {
  const db = getDb()
  const starterId = trainerConfig.starters[input.starter]
  const starterSpecies = db.select({ id: species.id }).from(species).where(eq(species.id, starterId)).get()
  if (!starterSpecies) throw new Error(`starter species ${starterId} is not seeded`)
  const now = input.now
  const traits = rollTraits(mulberry32(traitsRngSeed(randomSeed())), {
    level: trainerConfig.starterLevel,
    learnset: learnsetFor(starterSpecies.id),
    abilities: abilitiesFor(starterSpecies.id),
    moves: movesByName(),
  })

  const user = db
    .insert(users)
    .values({ username: input.username, googleSub: input.googleSub, createdAt: now })
    .returning({ id: users.id })
    .get()
  if (!user) throw new Error('failed to create user')

  db.insert(trainers)
    .values({
      userId: user.id,
      energy: trainerConfig.energyMax,
      energyUpdatedAt: now,
      weatherSeed: randomSeed(),
      updatedAt: now,
    })
    .run()
  db.insert(pokemon)
    .values({
      userId: user.id,
      speciesId: starterSpecies.id,
      level: trainerConfig.starterLevel,
      caughtAt: now,
      caughtBall: 'poke',
      originalSpeciesId: starterSpecies.id,
      ...traitColumns(traits),
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
      maxLevelReached: trainerConfig.starterLevel,
    })
    .run()
  db.insert(inventory)
    .values(trainerConfig.startingItems.map((item) => ({ userId: user.id, ...item })))
    .run()
  return { userId: user.id, starterSpeciesId: starterSpecies.id }
}

/** Abre a sessão e registra o evento. Chamar dentro de immediate(); o cookie vai com setSessionCookie. */
export function openSession(
  c: Context,
  userId: number,
  event: 'register' | 'login',
  now: number,
): string {
  const token = newToken()
  const meta = requestMeta(c)
  const db = getDb()
  db.insert(sessions)
    .values({ id: hashToken(token), userId, createdAt: now, expiresAt: now + authConfig.sessionTtlMs })
    .run()
  db.insert(authEvents)
    .values({ userId, event, ip: meta.ip, userAgent: meta.userAgent, createdAt: now })
    .run()
  return token
}

export function setAuthCookie(c: Context, name: string, value: string, maxAgeMs: number): void {
  setCookie(c, name, value, {
    httpOnly: true,
    // Lax: a volta do Google é uma navegação de nível superior e precisa levar o cookie.
    sameSite: 'Lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(maxAgeMs / 1000),
  })
}

export function setSessionCookie(c: Context, token: string): void {
  setAuthCookie(c, authConfig.cookieName, token, authConfig.sessionTtlMs)
}

export function requestMeta(c: Context): { ip: string; userAgent: string | null } {
  const socketIp = getConnInfo(c).remote.address ?? 'unknown'
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = process.env.TRUST_PROXY === '1' && forwarded ? forwarded : socketIp
  const userAgent = c.req.header('user-agent')?.slice(0, authConfig.userAgentMax) ?? null
  return { ip, userAgent }
}
