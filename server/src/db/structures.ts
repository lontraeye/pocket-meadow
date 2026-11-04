import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm'
import { treeDef } from '../config/apricorn.js'
import { buildRecipe } from '../config/buildRecipes.js'
import { healConfig } from '../config/heal.js'
import { STRUCTURE_PIECES, type StructurePiece } from '../game/garden/layout.js'
import { getDb } from './client.js'
import { autoPlace } from './gardenLayout.js'
import { debitItem, itemQty } from './inventory.js'
import { gardenUnlocksOf } from './milestones.js'
import { gardenStructures } from './schema.js'

// Estruturas do jardim, uma linha por peça (PROGRESSAO.md 4.3, passo 2): duas
// bancadas têm cada uma o seu operador, lote e nível; duas máquinas, as suas
// cargas. O marco dá a primeira unidade; as próximas vêm das receitas (2c):
// gastam materiais, levam tempo (`ready_at`) e param no teto do tipo. Peça em
// construção não aparece em lugar nenhum até ficar pronta. Chamar dentro de
// immediate().

export type StructureRow = typeof gardenStructures.$inferSelect

const isStructure = (row: StructureRow): row is StructureRow & { key: StructurePiece } =>
  (STRUCTURE_PIECES as readonly string[]).includes(row.key)

/** As peças prontas do jardim do jogador (sem o cuidador do daycare), na ordem em que vieram. */
export function structuresOf(userId: number, key?: StructurePiece): (StructureRow & { key: StructurePiece })[] {
  const where = and(
    eq(gardenStructures.userId, userId),
    isNull(gardenStructures.readyAt),
    key ? eq(gardenStructures.key, key) : undefined,
  )
  return getDb().select().from(gardenStructures).where(where).orderBy(asc(gardenStructures.id)).all().filter(isStructure)
}

export function structureById(userId: number, id: number): (StructureRow & { key: StructurePiece }) | null {
  const row = getDb()
    .select()
    .from(gardenStructures)
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.id, id), isNull(gardenStructures.readyAt)))
    .get()
  return row && isStructure(row) ? row : null
}

/** Quantas peças do tipo o jogador tem, contando a que está em construção (o teto olha isto). */
export function countOf(userId: number, key: StructurePiece): number {
  return getDb()
    .select({ id: gardenStructures.id })
    .from(gardenStructures)
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, key)))
    .all().length
}

/** A construção em andamento (uma por vez), ou null. */
export function buildingOf(userId: number): { id: number; piece: StructurePiece; readyAt: number; startedAt: number } | null {
  const row = getDb()
    .select()
    .from(gardenStructures)
    .where(and(eq(gardenStructures.userId, userId), isNotNull(gardenStructures.readyAt)))
    .get()
  if (!row || !isStructure(row) || row.readyAt === null) return null
  return { id: row.id, piece: row.key, readyAt: row.readyAt, startedAt: row.since }
}

/** Estado de uma peça nova: a árvore e a máquina já vêm com o primeiro fruto e as cargas do começo. */
function startProgress(key: StructurePiece): number {
  if (key === 'heal_machine') return healConfig.machine.startWith
  return treeDef(key)?.startWith ?? 0
}

/** Cria uma peça (guardada; com `readyAt`, em construção até lá) e devolve o id. */
export function createStructure(userId: number, key: StructurePiece, now: number, readyAt: number | null = null): number {
  const row = getDb()
    .insert(gardenStructures)
    .values({ userId, key, level: 1, since: now, progress: startProgress(key), readyAt })
    .returning({ id: gardenStructures.id })
    .get()
  return row.id
}

/**
 * A primeira unidade de cada peça que os marcos abriram: nasce e vai para a
 * casa de sempre (se estiver livre; senão fica guardada).
 */
export function grantStructures(userId: number, now: number): void {
  const unlocks = gardenUnlocksOf(userId)
  for (const key of STRUCTURE_PIECES) {
    if (!unlocks.pieces.has(key) || countOf(userId, key) > 0) continue
    autoPlace(userId, createStructure(userId, key, now), key, now)
  }
}

/** A construção que terminou vira peça pronta, guardada no inventário de construção. */
export function finishBuilds(userId: number, now: number): void {
  getDb()
    .update(gardenStructures)
    // O relógio da peça começa quando ela fica pronta (e volta a contar ao colocar).
    .set({ readyAt: null, since: now })
    .where(and(eq(gardenStructures.userId, userId), isNotNull(gardenStructures.readyAt), lte(gardenStructures.readyAt, now)))
    .run()
}

export type CraftError = 'build_recipe_locked' | 'piece_cap' | 'build_busy' | 'missing_items'

/** Constrói uma peça pela receita: confere receita, teto, fila e materiais; gasta tudo agora. */
export function craftStructure(
  userId: number,
  piece: StructurePiece,
  now: number,
): { ok: true; id: number; readyAt: number } | { ok: false; error: CraftError } {
  const recipe = buildRecipe(piece)
  const unlocks = gardenUnlocksOf(userId)
  if (!recipe || !unlocks.recipes.has(piece)) return { ok: false, error: 'build_recipe_locked' }
  if (countOf(userId, piece) >= unlocks.capOf(piece)) return { ok: false, error: 'piece_cap' }
  if (buildingOf(userId)) return { ok: false, error: 'build_busy' }
  if (recipe.cost.some((item) => itemQty(userId, item.itemKey) < item.quantity)) return { ok: false, error: 'missing_items' }
  for (const item of recipe.cost) {
    if (!debitItem(userId, item.itemKey, item.quantity)) throw new Error(`debit failed: ${item.itemKey}`)
  }
  const readyAt = now + recipe.ms
  return { ok: true, id: createStructure(userId, piece, now, readyAt), readyAt }
}
