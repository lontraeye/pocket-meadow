import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { berryKeyFromItem, energyBerryOff, getBerry } from '../config/berries.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { debitItem } from '../db/inventory.js'
import { activeEffects, trainers } from '../db/schema.js'
import { planBerryUse } from '../game/berries.js'
import { type Failure, fail } from './http.js'

type Ok<T> = { ok: true } & T

export const itemRoutes = new Hono<AuthEnv>()

itemRoutes.post('/:key/use', requireUser, (c) => {
  // O Hono já decodifica o parâmetro; decodificar de novo dá 500 com "%" solto.
  const itemKey = c.req.param('key')
  const result = immediate(() => useItem(c.get('userId'), itemKey, Date.now()))
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json(result.used)
})

function useItem(
  userId: number,
  itemKey: string,
  now: number,
): Ok<{
  used: {
    itemKey: string
    berryKey: string
    energy?: { energy: number; energyUpdatedAt: number; gained: number }
    effect?: {
      effectKey: string
      multiplier: number
      charges: number | null
      expiresAt: number | null
      renewed: boolean
    }
  }
}> | Failure {
  const clock = persistCatchUp(userId, now)
  const berryKey = berryKeyFromItem(itemKey)
  if (!berryKey) return fail('unknown_item', 400)
  const berry = getBerry(berryKey)
  if (!berry) return fail('unknown_item', 400)
  if (!berry.effect || energyBerryOff(berry)) return fail('berry_not_usable', 400)

  const db = getDb()
  const effectKey = berry.effect.kind === 'energy' ? null : berry.effect.effectKey
  const same =
    effectKey === null
      ? undefined
      : db
          .select({ id: activeEffects.id })
          .from(activeEffects)
          .where(and(eq(activeEffects.userId, userId), eq(activeEffects.effectKey, effectKey)))
          .get()

  const planned = planBerryUse(
    berry,
    {
      energy: clock.energy,
      energyUpdatedAt: clock.energyUpdatedAt,
      hasSameEffect: same !== undefined,
    },
    now,
  )
  if (!planned.ok) return fail(planned.error, 400)

  if (!debitItem(userId, itemKey, 1)) return fail('no_item', 400)

  if (planned.apply.kind === 'energy') {
    db.update(trainers)
      .set({
        energy: planned.apply.energy,
        energyUpdatedAt: planned.apply.energyUpdatedAt,
        updatedAt: now,
      })
      .where(eq(trainers.userId, userId))
      .run()
    return {
      ok: true,
      used: {
        itemKey,
        berryKey: berry.key,
        energy: {
          energy: planned.apply.energy,
          energyUpdatedAt: planned.apply.energyUpdatedAt,
          gained: planned.apply.gained,
        },
      },
    }
  }

  const apply = planned.apply
  if (same) {
    db.delete(activeEffects).where(eq(activeEffects.id, same.id)).run()
  }
  db.insert(activeEffects)
    .values({
      userId,
      effectKey: apply.effectKey,
      multiplier: apply.multiplier,
      charges: apply.charges,
      expiresAt: apply.expiresAt,
      createdAt: now,
    })
    .run()

  return {
    ok: true,
    used: {
      itemKey,
      berryKey: berry.key,
      effect: {
        effectKey: apply.effectKey,
        multiplier: apply.multiplier,
        charges: apply.charges,
        expiresAt: apply.expiresAt,
        renewed: apply.renewed,
      },
    },
  }
}
