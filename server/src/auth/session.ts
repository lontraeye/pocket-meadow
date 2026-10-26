import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { authConfig } from '../config/auth.js'
import { getDb } from '../db/client.js'
import { sessions } from '../db/schema.js'

export type AuthEnv = { Variables: { userId: number } }

export const requireUser = createMiddleware<AuthEnv>(async (c, next) => {
  const session = currentSession(c)
  if (!session) return c.json({ error: 'not_signed_in' }, 401)
  c.set('userId', session.userId)
  await next()
})

export function currentSession(c: Context) {
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

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}
