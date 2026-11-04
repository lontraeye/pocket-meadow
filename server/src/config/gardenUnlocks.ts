// O que abre no jardim (PROGRESSAO.md 4.3, passo 2): os marcos (líderes
// vencidos), não o nível de treinador. Cada marco pode dar peças (a primeira
// unidade), receitas para construir mais, subir quantas de cada tipo dá para
// ter (o teto), o limite de canteiros, as vagas do daycare e o nível máximo da
// bancada, e os chãos dos habitats (PLANNING 5.22). Módulo puro: recebe os
// marcos conquistados.

import type { StructurePiece } from '../game/garden/layout.js'
import type { PaintFloor } from '../game/habitat/config.js'
import { milestoneConfigs } from './milestones.js'

export type GardenGrant = {
  /** Chãos de habitat que passam a dar para pintar (sem custo nem limite). */
  floors?: readonly PaintFloor[]
  /** Peças que o marco dá (uma unidade de cada). */
  pieces?: readonly StructurePiece[]
  /** Canteiros no jardim, no máximo (o limite passa a ser este). */
  plots?: number
  /** Vagas do daycare (o total passa a ser este). */
  daycareSlots?: number
  /** Até onde a bancada pode subir. */
  benchMaxLevel?: number
  /** Receitas que o marco libera (config/buildRecipes). */
  recipes?: readonly StructurePiece[]
  /** Quantas de cada tipo dá para ter (o teto passa a ser este). */
  caps?: Partial<Record<StructurePiece, number>>
}

/** O que já vem no começo. */
export const GARDEN_START = {
  pieces: ['ball_bench', 'apricorn_tree', 'heal_machine'],
  plots: 4,
  daycareSlots: 1,
  benchMaxLevel: 1,
  recipes: [],
  /** Uma de cada; quem não tem entrada nos marcos fica em 1. */
  caps: {},
  // Pradaria desde o começo; o gramado (grama) é o chão neutro.
  floors: ['grama-alta', 'flores'],
} as const satisfies Required<GardenGrant>

/** Por marco (chave de `milestoneConfigs`); marco sem entrada não muda o jardim. */
export const GARDEN_GRANTS: Readonly<Record<string, GardenGrant>> = {
  azalea: { floors: ['areia', 'terra', 'pedra'], plots: 6, daycareSlots: 2, recipes: ['apricorn_tree'], caps: { apricorn_tree: 2 } },
  goldenrod: { pieces: ['apricorn_tree_blue'], benchMaxLevel: 2 },
  ecruteak: { floors: ['agua', 'agua-funda'], plots: 8, caps: { apricorn_tree: 3 } },
  cianwood: { daycareSlots: 3, recipes: ['heal_machine'], caps: { heal_machine: 2 } },
  olivine: { pieces: ['apricorn_tree_yellow'], plots: 10, benchMaxLevel: 3 },
  blackthorn: { plots: 12, daycareSlots: 4, recipes: ['ball_bench'], caps: { ball_bench: 2 } },
}

export type GardenUnlocks = {
  floors: ReadonlySet<PaintFloor>
  pieces: ReadonlySet<StructurePiece>
  plotLimit: number
  daycareSlots: number
  benchMaxLevel: number
  recipes: ReadonlySet<StructurePiece>
  /** Teto de cada tipo (1 sem marco que suba). */
  capOf: (piece: StructurePiece) => number
}

/** Somando o começo e os marcos conquistados (o maior valor de cada um vale). */
export function gardenUnlocks(cleared: ReadonlySet<string>): GardenUnlocks {
  const pieces = new Set<StructurePiece>(GARDEN_START.pieces)
  const floors = new Set<PaintFloor>(GARDEN_START.floors)
  let plotLimit: number = GARDEN_START.plots
  let daycareSlots: number = GARDEN_START.daycareSlots
  let benchMaxLevel: number = GARDEN_START.benchMaxLevel
  const recipes = new Set<StructurePiece>()
  const caps = new Map<StructurePiece, number>()
  for (const [key, grant] of Object.entries(GARDEN_GRANTS)) {
    if (!cleared.has(key)) continue
    for (const piece of grant.pieces ?? []) pieces.add(piece)
    for (const floor of grant.floors ?? []) floors.add(floor)
    for (const piece of grant.recipes ?? []) recipes.add(piece)
    for (const [piece, cap] of Object.entries(grant.caps ?? {}) as [StructurePiece, number][]) {
      caps.set(piece, Math.max(caps.get(piece) ?? 1, cap))
    }
    plotLimit = Math.max(plotLimit, grant.plots ?? 0)
    daycareSlots = Math.max(daycareSlots, grant.daycareSlots ?? 0)
    benchMaxLevel = Math.max(benchMaxLevel, grant.benchMaxLevel ?? 0)
  }
  return { floors, pieces, plotLimit, daycareSlots, benchMaxLevel, recipes, capOf: (piece) => caps.get(piece) ?? 1 }
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

/** O marco que libera a receita da peça (null = já liberada ou nenhum dá). */
export function recipeUnlockAt(cleared: ReadonlySet<string>, piece: StructurePiece): UnlockAt | null {
  if (gardenUnlocks(cleared).recipes.has(piece)) return null
  return nextGrant(cleared, (grant) => grant.recipes?.includes(piece) ?? false)
}

/** O próximo marco que sobe o teto da peça, e para quanto. */
export function nextCapAt(cleared: ReadonlySet<string>, piece: StructurePiece): (UnlockAt & { cap: number }) | null {
  const now = gardenUnlocks(cleared).capOf(piece)
  const at = nextGrant(cleared, (grant) => (grant.caps?.[piece] ?? 0) > now)
  return at ? { ...at, cap: GARDEN_GRANTS[at.milestone]!.caps![piece]! } : null
}

/** O marco que abre o chão (null = já aberto). */
export function floorUnlockAt(cleared: ReadonlySet<string>, floor: PaintFloor): UnlockAt | null {
  if (gardenUnlocks(cleared).floors.has(floor)) return null
  return nextGrant(cleared, (grant) => grant.floors?.includes(floor) ?? false)
}
