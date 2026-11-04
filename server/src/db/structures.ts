import { and, asc, eq } from 'drizzle-orm'
import { treeDef } from '../config/apricorn.js'
import { healConfig } from '../config/heal.js'
import { STRUCTURE_PIECES, type StructurePiece } from '../game/garden/layout.js'
import { getDb } from './client.js'
import { autoPlace } from './gardenLayout.js'
import { gardenUnlocksOf } from './milestones.js'
import { gardenStructures } from './schema.js'

// Estruturas do jardim, uma linha por peça (PROGRESSAO.md 4.3, passo 2): duas
// bancadas têm cada uma o seu operador, lote e nível; duas máquinas, as suas
// cargas. O marco dá a primeira unidade; as próximas vêm das receitas (2c).
// Chamar dentro de immediate().

export type StructureRow = typeof gardenStructures.$inferSelect

/** As peças do jardim do jogador (sem o cuidador do daycare), na ordem em que vieram. */
export function structuresOf(userId: number, key?: StructurePiece): (StructureRow & { key: StructurePiece })[] {
  const where = key
    ? and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, key))
    : eq(gardenStructures.userId, userId)
  return getDb()
    .select()
    .from(gardenStructures)
    .where(where)
    .orderBy(asc(gardenStructures.id))
    .all()
    .filter((row): row is StructureRow & { key: StructurePiece } => (STRUCTURE_PIECES as readonly string[]).includes(row.key))
}

export function structureById(userId: number, id: number): (StructureRow & { key: StructurePiece }) | null {
  const row = getDb()
    .select()
    .from(gardenStructures)
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.id, id)))
    .get()
  return row && (STRUCTURE_PIECES as readonly string[]).includes(row.key) ? (row as StructureRow & { key: StructurePiece }) : null
}

/** Estado de uma peça nova: a árvore e a máquina já vêm com o primeiro fruto e as cargas do começo. */
function startProgress(key: StructurePiece): number {
  if (key === 'heal_machine') return healConfig.machine.startWith
  return treeDef(key)?.startWith ?? 0
}

/** Cria uma peça (guardada) e devolve o id. */
export function createStructure(userId: number, key: StructurePiece, now: number): number {
  const row = getDb()
    .insert(gardenStructures)
    .values({ userId, key, level: 1, since: now, progress: startProgress(key) })
    .returning({ id: gardenStructures.id })
    .get()
  return row.id
}

/**
 * A primeira unidade de cada peça que os marcos abriram: nasce e vai para a
 * casa de sempre (se estiver livre; senão fica guardada).
 */
export function grantStructures(userId: number, now: number): void {
  const owned = new Set(structuresOf(userId).map((row) => row.key))
  for (const key of STRUCTURE_PIECES) {
    if (owned.has(key) || !gardenUnlocksOf(userId).pieces.has(key)) continue
    autoPlace(userId, createStructure(userId, key, now), key, now)
  }
}
