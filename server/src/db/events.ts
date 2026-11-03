import { and, eq, gte, sql } from 'drizzle-orm'
import { getDb } from './client.js'
import { trainerEvents } from './schema.js'

// Registro de ações para as missões (PLANNING.md, 5.20). Chamar dentro de immediate().

export type TrainerEventKind = (typeof trainerEvents.$inferInsert)['kind']

export function recordEvent(userId: number, kind: TrainerEventKind, quantity: number, at: number): void {
  if (quantity <= 0) return
  getDb().insert(trainerEvents).values({ userId, kind, quantity, at }).run()
}

/** Soma de `quantity` de um tipo de ação desde `since`. */
export function sumEvents(userId: number, kind: TrainerEventKind, since: number): number {
  const row = getDb()
    .select({ total: sql<number>`coalesce(sum(${trainerEvents.quantity}), 0)` })
    .from(trainerEvents)
    .where(and(eq(trainerEvents.userId, userId), eq(trainerEvents.kind, kind), gte(trainerEvents.at, since)))
    .get()
  return row?.total ?? 0
}
