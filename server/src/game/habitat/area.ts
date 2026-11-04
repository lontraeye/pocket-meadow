// Habitat com área e tipo escolhidos (PLANNING 5.22, redesenhado em
// 2026-11-04): o jogador pinta as casas da área e escolhe o tipo; cada casa é
// de um habitat só, então dois habitats encostados não se juntam. O tipo pede
// pontos do material dele, metade da área: cada chão do material dentro vale 1
// e cada móvel do material dentro vale mais 1. Puro (servidor e tela).

import type { PokemonType } from '../../config/types.js'
import { FLOORS, OBJECTS, type Material, type PaintFloor, habitatConfig } from './config.js'

export type HabitatKindDef = {
  key: string
  name: string
  /** Materiais que contam ponto (vazio = não pede ponto). */
  materials: readonly Material[]
  /** Tipos que moram; null = qualquer um (o básico, sem bônus). */
  types: readonly PokemonType[] | null
  /** O tipo abre junto com este chão (null = desde o começo). */
  floor: PaintFloor | null
}

export const HABITAT_KINDS = [
  { key: 'pradaria', name: 'Pradaria', materials: ['planta'], types: ['normal', 'grass', 'bug', 'flying', 'fairy'], floor: 'grama-alta' },
  { key: 'rochedo', name: 'Rochedo', materials: ['pedra', 'areia', 'terra'], types: ['rock', 'ground', 'fighting', 'steel'], floor: 'pedra' },
  { key: 'lago', name: 'Lago', materials: ['agua'], types: ['water', 'ice'], floor: 'agua' },
  { key: 'basico', name: 'Básico', materials: [], types: null, floor: null },
] as const satisfies readonly HabitatKindDef[]

export type HabitatKind = (typeof HABITAT_KINDS)[number]['key']

export function isHabitatKind(value: unknown): value is HabitatKind {
  return typeof value === 'string' && HABITAT_KINDS.some((kind) => kind.key === value)
}

export function habitatKind(key: HabitatKind): HabitatKindDef {
  return HABITAT_KINDS.find((kind) => kind.key === key)!
}

export type Tile = { col: number; row: number }
/** O que tem na casa (chão pintado e móvel); null = gramado vazio. */
export type CellLook = (col: number, row: number) => { floor: string | null; object: string | null } | null

export type HabitatCheck = {
  size: number
  /** Pontos do material do tipo dentro da área. */
  points: number
  /** Pontos que o tipo pede (0 no básico). */
  need: number
  /** Pequeno demais para morar (menos de `minTiles`). */
  tooSmall: boolean
  /** Fechou: tamanho e pontos. Só assim tem vagas e dá bônus. */
  ready: boolean
  /** Vagas quando pronto (0 enquanto não). */
  capacity: number
}

const key = (col: number, row: number) => `${col},${row}`

/** As casas se tocam (4 direções) formando um bloco só. */
export function isConnected(tiles: readonly Tile[]): boolean {
  if (tiles.length === 0) return false
  const all = new Set(tiles.map((tile) => key(tile.col, tile.row)))
  const seen = new Set([key(tiles[0]!.col, tiles[0]!.row)])
  const stack = [tiles[0]!]
  while (stack.length) {
    const { col, row } = stack.pop()!
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = key(col + dc, row + dr)
      if (all.has(next) && !seen.has(next)) {
        seen.add(next)
        stack.push({ col: col + dc, row: row + dr })
      }
    }
  }
  return seen.size === all.size
}

/** Pontos de uma casa para o tipo: o chão do material (1) e o móvel do material (+`objectPoints`). */
function cellPoints(kind: HabitatKindDef, look: ReturnType<CellLook>): number {
  if (!look || kind.materials.length === 0) return 0
  const counts = (makeup: Partial<Record<Material, number>> | undefined) =>
    makeup ? kind.materials.reduce((sum, material) => sum + (makeup[material] ?? 0), 0) : 0
  const floor = look.floor ? (FLOORS as Record<string, Partial<Record<Material, number>>>)[look.floor] : undefined
  const object = look.object ? (OBJECTS as Record<string, Partial<Record<Material, number>>>)[look.object] : undefined
  return counts(floor) + counts(object) * habitatConfig.objectPoints
}

export function checkHabitat(kindKey: HabitatKind, tiles: readonly Tile[], look: CellLook): HabitatCheck {
  const kind = habitatKind(kindKey)
  const size = tiles.length
  const points = tiles.reduce((sum, tile) => sum + cellPoints(kind, look(tile.col, tile.row)), 0)
  const need = kind.materials.length === 0 ? 0 : Math.ceil(size * habitatConfig.needShare)
  const tooSmall = size < habitatConfig.minTiles
  const ready = !tooSmall && points >= need
  const capacity = ready ? (size >= habitatConfig.bigTiles ? habitatConfig.capacity.big : habitatConfig.capacity.small) : 0
  return { size, points, need, tooSmall, ready, capacity }
}

/** Pode morar ali: um dos tipos dele está no habitat (ou é o básico). */
export function canLiveInKind(types: readonly string[], kindKey: HabitatKind): boolean {
  const kind = habitatKind(kindKey)
  return kind.types === null || types.some((type) => (kind.types as readonly string[]).includes(type))
}

/** Dá o bônus: habitat pronto, de tipo de verdade (não o básico), de um dos tipos dele. */
export function kindBonus(types: readonly string[], kindKey: HabitatKind, ready: boolean): boolean {
  return ready && habitatKind(kindKey).types !== null && canLiveInKind(types, kindKey)
}
