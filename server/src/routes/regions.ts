import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { loadRegions, regionStatus } from '../config/regions.js'
import { persistCatchUp } from '../db/catchUp.js'
import { immediate } from '../db/client.js'

export const regionRoutes = new Hono<AuthEnv>()

regionRoutes.get('/', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  const body = immediate(() => {
    const clock = persistCatchUp(userId, now)
    return { regions: loadRegions().map((region) => regionStatus(region, clock.level)) }
  })
  return c.json(body)
})
