import { and, eq, isNotNull } from 'drizzle-orm'
import { healConfig } from '../config/heal.js'
import { clampRatio, nextHealChargeAt, settleHealCharges } from '../game/heal.js'
import { getDb } from './client.js'
import { gardenStructures, pokemon } from './schema.js'

export const HEAL_MACHINE_KEY = 'heal_machine' as const

export type HealMachineView = {
  charges: number
  max: number
  /** null = já no máximo. */
  nextChargeAt: number | null
  /** Quanto leva cada carga (para a barrinha no jardim). */
  unitMs: number
}

type MachineRow = { progress: number; since: number }

/** Garante a linha da máquina (liberada desde o início). */
export function ensureHealMachine(userId: number, now: number): MachineRow {
  const db = getDb()
  const where = and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, HEAL_MACHINE_KEY))
  const found = db
    .select({ progress: gardenStructures.progress, since: gardenStructures.since })
    .from(gardenStructures)
    .where(where)
    .get()
  if (found) return found
  const row = { progress: healConfig.machine.startWith, since: now }
  db.insert(gardenStructures)
    .values({ userId, key: HEAL_MACHINE_KEY, level: 1, ...row })
    .run()
  return row
}

export function healMachineView(userId: number, now: number): HealMachineView {
  const row = ensureHealMachine(userId, now)
  const progress = settleHealCharges(row.progress, row.since, now)
  return {
    charges: Math.floor(progress),
    max: healConfig.machine.maxCharges,
    nextChargeAt: nextHealChargeAt(progress, now),
    unitMs: healConfig.machine.rechargeMs,
  }
}

/**
 * Gasta 1 carga e põe hp_ratio = 1 em toda a equipe (team_slot != null).
 */
export function useHealMachine(
  userId: number,
  now: number,
): { ok: true; healed: number; view: HealMachineView } | { ok: false; error: 'no_charge' | 'team_healthy' } {
  const db = getDb()
  const row = ensureHealMachine(userId, now)
  const settled = settleHealCharges(row.progress, row.since, now)
  if (Math.floor(settled) < 1) return { ok: false, error: 'no_charge' }

  const members = db
    .select({ id: pokemon.id, hpRatio: pokemon.hpRatio })
    .from(pokemon)
    .where(and(eq(pokemon.userId, userId), isNotNull(pokemon.teamSlot)))
    .all()

  const injured = members.filter((mon) => clampRatio(mon.hpRatio) < 1)
  if (injured.length === 0) return { ok: false, error: 'team_healthy' }

  db.update(gardenStructures)
    .set({ progress: settled - 1, since: now })
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, HEAL_MACHINE_KEY)))
    .run()

  for (const mon of members) {
    db.update(pokemon)
      .set({ hpRatio: 1, hpUpdatedAt: now })
      .where(and(eq(pokemon.id, mon.id), eq(pokemon.userId, userId)))
      .run()
  }

  return { ok: true, healed: members.length, view: healMachineView(userId, now) }
}
