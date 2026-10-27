import { Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic'
import { SqliteError } from 'better-sqlite3'
import { and, eq, gt, lte } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie } from 'hono/cookie'
import {
  asUsername,
  createPlayer,
  isStarter,
  newToken,
  openSession,
  requestMeta,
  setAuthCookie,
  setSessionCookie,
} from '../auth/accounts.js'
import { googleSubFromClaims, sameToken } from '../auth/google.js'
import { currentSession, hashToken } from '../auth/session.js'
import { authConfig, googleConfig } from '../config/auth.js'
import { trainerConfig } from '../config/trainer.js'
import { getDb, immediate } from '../db/client.js'
import { authEvents, googleSignups, sessions, users } from '../db/schema.js'
import { readObject } from './http.js'

// Login só pelo Google (PLANNING.md, seção 4.7). O app volta para "/" com
// ?auth=<motivo> quando algo dá errado, e o front traduz o motivo.
export const authRoutes = new Hono()

authRoutes.get('/google', (c) => {
  const config = googleConfig()
  if (!config) return c.redirect('/?auth=unavailable')
  const state = generateState()
  const verifier = generateCodeVerifier()
  // Só openid: o jogo guarda o ID da conta, sem e-mail, nome ou foto.
  const url = new Google(config.clientId, config.clientSecret, config.redirectUri).createAuthorizationURL(
    state,
    verifier,
    ['openid'],
  )
  url.searchParams.set('prompt', 'select_account')
  setAuthCookie(c, authConfig.oauthStateCookie, state, authConfig.oauthCookieTtlMs)
  setAuthCookie(c, authConfig.oauthVerifierCookie, verifier, authConfig.oauthCookieTtlMs)
  return c.redirect(url.toString())
})

authRoutes.get('/google/callback', async (c) => {
  const config = googleConfig()
  if (!config) return c.redirect('/?auth=unavailable')
  const state = getCookie(c, authConfig.oauthStateCookie)
  const verifier = getCookie(c, authConfig.oauthVerifierCookie)
  deleteCookie(c, authConfig.oauthStateCookie, { path: '/' })
  deleteCookie(c, authConfig.oauthVerifierCookie, { path: '/' })

  if (c.req.query('error')) return c.redirect('/?auth=cancelled')
  const code = c.req.query('code')
  if (!code || !verifier || !sameToken(c.req.query('state'), state)) return c.redirect('/?auth=failed')

  let googleSub: string | null
  try {
    const tokens = await new Google(config.clientId, config.clientSecret, config.redirectUri).validateAuthorizationCode(
      code,
      verifier,
    )
    googleSub = googleSubFromClaims(decodeIdToken(tokens.idToken()), config.clientId, Date.now())
  } catch (error) {
    console.error('google callback failed', error)
    return c.redirect('/?auth=failed')
  }
  if (!googleSub) return c.redirect('/?auth=failed')

  const sub = googleSub
  const now = Date.now()
  const db = getDb()
  const outcome = immediate(() => {
    const user = db.select({ id: users.id }).from(users).where(eq(users.googleSub, sub)).get()
    if (user) return { kind: 'login' as const, token: openSession(c, user.id, 'login', now) }
    // Conta nova: guarda o sub e pede nome e inicial no front.
    db.delete(googleSignups).where(lte(googleSignups.expiresAt, now)).run()
    const token = newToken()
    db.insert(googleSignups)
      .values({ id: hashToken(token), googleSub: sub, createdAt: now, expiresAt: now + authConfig.signupTtlMs })
      .run()
    return { kind: 'signup' as const, token }
  })

  if (outcome.kind === 'login') {
    setSessionCookie(c, outcome.token)
    return c.redirect('/')
  }
  setAuthCookie(c, authConfig.signupCookie, outcome.token, authConfig.signupTtlMs)
  return c.redirect('/?auth=signup')
})

// O front pergunta se há um cadastro esperando nome e inicial.
authRoutes.get('/signup', (c) => {
  if (!pendingSignup(c, Date.now())) return c.json({ error: 'signup_expired' }, 404)
  return c.json({ starters: Object.keys(trainerConfig.starters) })
})

authRoutes.post('/signup', async (c) => {
  const body = await readObject(c)
  if (!body) return c.json({ error: 'invalid_body' }, 400)
  const username = asUsername(body.username)
  if (!username) {
    return c.json({ error: 'invalid_username', min: authConfig.usernameMin, max: authConfig.usernameMax }, 400)
  }
  const starter = body.starter
  if (!isStarter(starter)) return c.json({ error: 'invalid_starter' }, 400)

  const now = Date.now()
  try {
    const result = immediate(() => {
      const signup = pendingSignup(c, now)
      if (!signup) return null
      const db = getDb()
      // Duas abas no mesmo cadastro: a segunda só entra na conta criada pela primeira.
      const existing = db.select({ id: users.id }).from(users).where(eq(users.googleSub, signup.googleSub)).get()
      const userId = existing
        ? existing.id
        : createPlayer({ username, googleSub: signup.googleSub, starter, now }).userId
      db.delete(googleSignups).where(eq(googleSignups.id, signup.id)).run()
      return { token: openSession(c, userId, existing ? 'login' : 'register', now) }
    })
    if (!result) return c.json({ error: 'signup_expired' }, 401)
    deleteCookie(c, authConfig.signupCookie, { path: '/' })
    setSessionCookie(c, result.token)
    return c.json({ username }, 201)
  } catch (error) {
    if (error instanceof SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'username_taken' }, 409)
    }
    throw error
  }
})

authRoutes.post('/logout', (c) => {
  const session = currentSession(c)
  if (!session) return c.json({ error: 'not_signed_in' }, 401)

  const meta = requestMeta(c)
  const now = Date.now()
  immediate(() => {
    getDb()
      .insert(authEvents)
      .values({ userId: session.userId, event: 'logout', ip: meta.ip, userAgent: meta.userAgent, createdAt: now })
      .run()
    getDb().delete(sessions).where(eq(sessions.id, session.id)).run()
  })

  deleteCookie(c, authConfig.cookieName, { path: '/' })
  return c.body(null, 204)
})

function pendingSignup(c: Context, now: number) {
  const token = getCookie(c, authConfig.signupCookie)
  if (!token) return undefined
  return getDb()
    .select()
    .from(googleSignups)
    .where(and(eq(googleSignups.id, hashToken(token)), gt(googleSignups.expiresAt, now)))
    .get()
}
