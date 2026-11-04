// O que abre no jardim (PROGRESSAO.md 4.3, passo 2): os marcos (líderes
// vencidos), não o nível de treinador. Cada marco pode dar peças (a primeira
// unidade), subir o limite de canteiros, abrir vagas do daycare e o nível
// máximo da bancada. Módulo puro: recebe os marcos conquistados.

import type { StructurePiece } from '../game/garden/layout.js'
import { milestoneConfigs } from './milestones.js'

export type GardenGrant = {
  /** Peças que o marco dá (uma unidade de cada). */
  pieces?: readonly StructurePiece[]
  /** Canteiros no jardim, no máximo (o limite passa a ser este). */
  plots?: number
  /** Vagas do daycare (o total passa a ser este). */
  daycareSlots?: number
  /** Até onde a bancada pode subir. */
  benchMaxLevel?: number
}

/** O que já vem no começo. */
export const GARDEN_START = {
  pieces: ['ball_bench', 'apricorn_tree', 'heal_machine'],
  plots: 4,
  daycareSlots: 1,
  benchMaxLevel: 1,
} as const satisfies Required<GardenGrant>

/** Por marco (chave de `milestoneConfigs`); marco sem entrada não muda o jardim. */
export const GARDEN_GRANTS: Readonly<Record<string, GardenGrant>> = {
  azalea: { plots: 6, daycareSlots: 2 },
  goldenrod: { pieces: ['apricorn_tree_blue'], benchMaxLevel: 2 },
  ecruteak: { plots: 8 },
  cianwood: { daycareSlots: 3 },
  olivine: { pieces: ['apricorn_tree_yellow'], plots: 10, benchMaxLevel: 3 },
  blackthorn: { plots: 12, daycareSlots: 4 },
}

export type GardenUnlocks = {
  pieces: ReadonlySet<StructurePiece>
  plotLimit: number
  daycareSlots: number
  benchMaxLevel: number
}

/** Somando o começo e os marcos conquistados (o maior valor de cada um vale). */
export function gardenUnlocks(cleared: ReadonlySet<string>): GardenUnlocks {
  const pieces = new Set<StructurePiece>(GARDEN_START.pieces)
  let plotLimit: number = GARDEN_START.plots
  let daycareSlots: number = GARDEN_START.daycareSlots
  let benchMaxLevel: number = GARDEN_START.benchMaxLevel
  for (const [key, grant] of Object.entries(GARDEN_GRANTS)) {
    if (!cleared.has(key)) continue
    for (const piece of grant.pieces ?? []) pieces.add(piece)
    plotLimit = Math.max(plotLimit, grant.plots ?? 0)
    daycareSlots = Math.max(daycareSlots, grant.daycareSlots ?? 0)
    benchMaxLevel = Math.max(benchMaxLevel, grant.benchMaxLevel ?? 0)
  }
  return { pieces, plotLimit, daycareSlots, benchMaxLevel }
}

/** O marco que abre algo, para o texto do cadeado ("abre no Marco de Azalea"). */
export type UnlockAt = { milestone: string; name: string }

function unlockAt(key: string): UnlockAt {
  return { milestone: key, name: milestoneConfigs.find((row) => row.key === key)?.name ?? key }
}

/** O primeiro marco (na ordem da jornada) ainda não conquistado em que `test` vale. */
function nextGrant(cleared: ReadonlySet<string>, test: (grant: GardenGrant) => boolean): UnlockAt | null {
  for (const milestone of milestoneConfigs) {
    const grant = GARDEN_GRANTS[milestone.key]
    if (grant && !cleared.has(milestone.key) && test(grant)) return unlockAt(milestone.key)
  }
  return null
}

/** Onde abre a peça (null = já abriu ou nenhum marco dá). */
export function pieceUnlockAt(cleared: ReadonlySet<string>, piece: StructurePiece): UnlockAt | null {
  if (gardenUnlocks(cleared).pieces.has(piece)) return null
  return nextGrant(cleared, (grant) => grant.pieces?.includes(piece) ?? false)
}

/** O próximo marco que sobe o limite de canteiros. */
export function nextPlotsAt(cleared: ReadonlySet<string>): (UnlockAt & { plots: number }) | null {
  const now = gardenUnlocks(cleared).plotLimit
  const at = nextGrant(cleared, (grant) => (grant.plots ?? 0) > now)
  return at ? { ...at, plots: GARDEN_GRANTS[at.milestone]!.plots! } : null
}

/** O próximo marco que abre uma vaga do daycare. */
export function nextDaycareSlotAt(cleared: ReadonlySet<string>): UnlockAt | null {
  const now = gardenUnlocks(cleared).daycareSlots
  return nextGrant(cleared, (grant) => (grant.daycareSlots ?? 0) > now)
}

/** O marco que deixa a bancada chegar ao nível `level` (null = já pode). */
export function benchLevelAt(cleared: ReadonlySet<string>, level: number): UnlockAt | null {
  if (gardenUnlocks(cleared).benchMaxLevel >= level) return null
  return nextGrant(cleared, (grant) => (grant.benchMaxLevel ?? 0) >= level)
}
