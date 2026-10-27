import { and, eq, sql } from 'drizzle-orm'
import { getDb } from './client.js'
import { inventory } from './schema.js'
import type { ItemCredit } from '../game/berries.js'
import { pickSeedByWeight, rewardsForLevelsGained } from '../game/berries.js'
import { unitRoll } from '../game/rng.js'

/** Credita itens no inventário (upsert por item_key). */
export function creditItems(userId: number, credits: readonly ItemCredit[]): void {
  if (credits.length === 0) return
  const db = getDb()
  for (const credit of credits) {
    if (credit.quantity <= 0) continue
    db.insert(inventory)
      .values({ userId, itemKey: credit.itemKey, quantity: credit.quantity })
      .onConflictDoUpdate({
        target: [inventory.userId, inventory.itemKey],
        set: { quantity: sql`${inventory.quantity} + ${credit.quantity}` },
      })
      .run()
  }
}

/** Debita `quantity`. Retorna false se não houver saldo. */
export function debitItem(userId: number, itemKey: string, quantity = 1): boolean {
  if (quantity <= 0) throw new Error('debit quantity must be > 0')
  const db = getDb()
  const updated = db
    .update(inventory)
    .set({ quantity: sql`${inventory.quantity} - ${quantity}` })
    .where(
      and(
        eq(inventory.userId, userId),
        eq(inventory.itemKey, itemKey),
        sql`${inventory.quantity} >= ${quantity}`,
      ),
    )
    .run()
  if (updated.changes !== 1) return false
  db.delete(inventory)
    .where(
      and(eq(inventory.userId, userId), eq(inventory.itemKey, itemKey), eq(inventory.quantity, 0)),
    )
    .run()
  return true
}

export function itemQty(userId: number, itemKey: string): number {
  const row = getDb()
    .select({ quantity: inventory.quantity })
    .from(inventory)
    .where(and(eq(inventory.userId, userId), eq(inventory.itemKey, itemKey)))
    .get()
  return row?.quantity ?? 0
}

/** Recompensas de nível de treinador: credita e devolve a lista. */
export function grantTrainerLevelRewards(userId: number, fromLevel: number, toLevel: number): ItemCredit[] {
  const rewards = rewardsForLevelsGained(fromLevel, toLevel, () => pickSeedByWeight(unitRoll))
  creditItems(userId, rewards)
  return rewards
}
