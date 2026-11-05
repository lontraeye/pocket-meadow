import { and, eq, isNotNull } from 'drizzle-orm'
import { healConfig } from '../config/heal.js'
import { clampRatio, nextHealChargeAt, settleHealCharges } from '../game/heal.js'
import { getDb } from './client.js'
import { isPlaced } from './gardenLayout.js'
import { gardenStructures, pokemon } from './schema.js'
import { structureById, structuresOf, type StructureRow } from './structures.js'

// Máquinas de cura do jardim (PROGRESSAO.md, item 4), uma por peça: cada uma
// com as suas cargas. Chamar dentro de immediate(), depois do catch-up.

export const HEAL_MACHINE_KEY = 'heal_machine' as const

export type HealMachineView = {
  /** A peça (garden_structures.id). */
  id: number
  charges: number
  max: number
  /** null = já no máximo (ou guardada). */
  nextChargeAt: number | null
  /** Quanto leva cada carga (para a barrinha no jardim). */
  unitMs: number
  /** No jardim (false = guardada, parada). */
  placed: boolean
}

function settled(row: StructureRow, placed: boolean, now: number): number {
  // Guardada: as cargas não voltam (o `progress` foi liquidado ao guardar).
  return placed ? settleHealCharges(row.progress, row.since, now) : row.progress
}

function viewOf(row: StructureRow, now: number): HealMachineView {
  const placed = isPlaced(row.id)
  const progress = settled(row, placed, now)
  return {
    id: row.id,
    charges: Math.floor(progress),
    max: healConfig.machine.maxCharges,
    nextChargeAt: placed ? nextHealChargeAt(progress, now) : null,
    unitMs: healConfig.machine.rechargeMs,
    placed,
  }
}

export function healMachinesView(userId: number, now: number): HealMachineView[] {
  return structuresOf(userId, HEAL_MACHINE_KEY).map((row) => viewOf(row, now))
}

/**
 * Gasta 1 carga e põe hp_ratio = 1 em toda a equipe (team_slot != null). Sem
 * `id`, usa a máquina do jardim com mais cargas (a cura antes da luta).
 */
export function useHealMachine(
  userId: number,
  now: number,
  id?: number,
): { ok: true; healed: number; machineId: number } | { ok: false; error: 'no_charge' | 'team_healthy' | 'not_placed' | 'piece_not_found' } {
  const db = getDb()
  let row: StructureRow | null
  if (id === undefined) {
    const placed = structuresOf(userId, HEAL_MACHINE_KEY).filter((machine) => isPlaced(machine.id))
    if (placed.length === 0) return { ok: false, error: 'not_placed' }
    row = placed.reduce((best, machine) => (settled(machine, true, now) > settled(best, true, now) ? machine : best))
  } else {
    row = structureById(userId, id)
    if (!row || row.key !== HEAL_MACHINE_KEY) return { ok: false, error: 'piece_not_found' }
    if (!isPlaced(row.id)) return { ok: false, error: 'not_placed' }
  }
  const charges = settled(row, true, now)
  if (Math.floor(charges) < 1) return { ok: false, error: 'no_charge' }

  const members = db
    .select({ id: pokemon.id, hpRatio: pokemon.hpRatio, faintedAt: pokemon.faintedAt })
    .from(pokemon)
    .where(and(eq(pokemon.userId, userId), isNotNull(pokemon.teamSlot)))
    .all()

  const injured = members.filter((mon) => mon.faintedAt != null || clampRatio(mon.hpRatio) < 1)
  if (injured.length === 0) return { ok: false, error: 'team_healthy' }

  db.update(gardenStructures)
    .set({ progress: charges - 1, since: now })
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.id, row.id)))
    .run()

  for (const mon of members) {
    db.update(pokemon)
      .set({ hpRatio: 1, hpUpdatedAt: now, faintedAt: null })
      .where(and(eq(pokemon.id, mon.id), eq(pokemon.userId, userId)))
      .run()
  }

  return { ok: true, healed: members.length, machineId: row.id }
}

/** Ao guardar: liquida as cargas que voltaram até agora e para o relógio. */
export function freezeHealMachine(userId: number, id: number, now: number): void {
  const row = structureById(userId, id)
  if (!row) return
  getDb()
    .update(gardenStructures)
    .set({ progress: settleHealCharges(row.progress, row.since, now), since: now })
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.id, row.id)))
    .run()
}
