import { and, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { type MissionKind, missionConfig } from '../config/missions.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { ensureMissionDay, grantMissionReward, missionProgress, missionsView, rerollMission } from '../db/missions.js'
import { dailyMissions, missionDays } from '../db/schema.js'
import { type Failure, fail, parseId } from './http.js'

// Quadro de missões diárias (PLANNING.md, seção 5.20). O servidor confere o
// progresso: o cliente nunca diz que completou.
export const missionRoutes = new Hono<AuthEnv>()

missionRoutes.post('/chest/claim', requireUser, (c) => {
  const result = immediate(() => claimChest(c.get('userId'), Date.now()))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.body)
})

missionRoutes.post('/:id/claim', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => claim(c.get('userId'), id, Date.now()))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.body)
})

missionRoutes.post('/:id/reroll', requireUser, (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'invalid_body' }, 400)
  const result = immediate(() => reroll(c.get('userId'), id, Date.now()))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.body)
})

type Ok = { ok: true; body: unknown }

/** Missão de hoje do jogador (as de dias passados não valem mais). */
function todaysMission(userId: number, id: number, level: number, now: number) {
  const day = ensureMissionDay(userId, level, now)
  const row = getDb()
    .select()
    .from(dailyMissions)
    .where(and(eq(dailyMissions.id, id), eq(dailyMissions.userId, userId)))
    .get()
  if (!row || row.day !== day) return null
  return row
}

function claim(userId: number, id: number, now: number): Ok | Failure {
  const clock = persistCatchUp(userId, now)
  const row = todaysMission(userId, id, clock.level, now)
  if (!row) return fail('mission_not_found', 404)
  if (row.claimedAt !== null) return fail('already_claimed', 409)
  if (missionProgress(userId, row) < row.target) return fail('mission_not_done', 400)
  const updated = getDb()
    .update(dailyMissions)
    .set({ claimedAt: now })
    .where(and(eq(dailyMissions.id, id), isNull(dailyMissions.claimedAt)))
    .run()
  if (updated.changes === 0) return fail('already_claimed', 409)
  const granted = grantMissionReward(userId, missionConfig.reward(row.kind as MissionKind, clock.level), now)
  return { ok: true, body: { granted, missions: missionsView(userId, granted.trainer.level, now) } }
}

function claimChest(userId: number, now: number): Ok | Failure {
  const clock = persistCatchUp(userId, now)
  const view = missionsView(userId, clock.level, now)
  if (view.chest.claimed) return fail('already_claimed', 409)
  if (!view.chest.ready) return fail('chest_locked', 400)
  getDb()
    .update(missionDays)
    .set({ chestClaimedAt: now })
    .where(and(eq(missionDays.userId, userId), eq(missionDays.day, view.day)))
    .run()
  const granted = grantMissionReward(userId, missionConfig.chest(clock.level), now)
  return { ok: true, body: { granted, missions: missionsView(userId, granted.trainer.level, now) } }
}

function reroll(userId: number, id: number, now: number): Ok | Failure {
  const clock = persistCatchUp(userId, now)
  const row = todaysMission(userId, id, clock.level, now)
  if (!row) return fail('mission_not_found', 404)
  if (row.claimedAt !== null) return fail('already_claimed', 409)
  const db = getDb()
  const meta = db
    .select({ rerollsUsed: missionDays.rerollsUsed })
    .from(missionDays)
    .where(and(eq(missionDays.userId, userId), eq(missionDays.day, row.day)))
    .get()
  if ((meta?.rerollsUsed ?? 0) >= missionConfig.rerollsPerDay) return fail('no_rerolls', 400)
  if (!rerollMission(userId, clock.level, row, now)) return fail('no_other_mission', 400)
  db.update(missionDays)
    .set({ rerollsUsed: sql`${missionDays.rerollsUsed} + 1` })
    .where(and(eq(missionDays.userId, userId), eq(missionDays.day, row.day)))
    .run()
  return { ok: true, body: { missions: missionsView(userId, clock.level, now) } }
}
