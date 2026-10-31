// Chão do jardim em blocos isométricos (PLANNING.md, seção 5.22), com as
// transições montadas pelo código: cada terreno é uma textura de 24×12 (o
// losango) e a borda entre dois terrenos sai de máscaras desenhadas uma vez só
// para todos. O terreno de prioridade maior "invade" o vizinho de prioridade
// menor pela máscara do lado (ou do canto) em que ele encosta.
//
// Módulo puro (sem DOM): usado pelo laboratório de tiles, pelo script que gera
// as máscaras padrão e, depois, pelo jardim.

export const TILE_W = 24
export const TILE_H = 12

/**
 * Ordem de prioridade, da menor para a maior: quem vem depois cobre a borda de
 * quem vem antes (a grama avança sobre a terra, a areia sobre a água). Terreno
 * que não está aqui fica abaixo de todos.
 */
export const TERRAIN_ORDER = ['agua-funda', 'agua', 'lava', 'areia', 'terra', 'pedra', 'neve', 'chao-escuro', 'grama', 'grama-alta', 'flores'] as const

export function terrainPriority(key: string): number {
  return (TERRAIN_ORDER as readonly string[]).indexOf(key)
}

/**
 * Lados e cantos do losango. No jardim, `col + 1` fica a sudeste e `row + 1`
 * a sudoeste (x = (col − row) × 12, y = (col + row) × 6).
 */
export const SIDES = ['ne', 'se', 'so', 'no'] as const
export const CORNERS = ['n', 'l', 's', 'o'] as const
export type Side = (typeof SIDES)[number]
export type Corner = (typeof CORNERS)[number]
export type MaskKey = `lado-${Side}` | `canto-${Corner}`

const SIDE_STEP: Record<Side, [number, number]> = { ne: [0, -1], se: [1, 0], so: [0, 1], no: [-1, 0] }
const CORNER_STEP: Record<Corner, [number, number]> = { n: [-1, -1], l: [1, -1], s: [1, 1], o: [-1, 1] }
/** Os dois lados que se encontram em cada canto. */
const CORNER_SIDES: Record<Corner, [Side, Side]> = { n: ['ne', 'no'], l: ['ne', 'se'], s: ['se', 'so'], o: ['so', 'no'] }

export const MASK_KEYS: readonly MaskKey[] = [...SIDES.map((s) => `lado-${s}` as const), ...CORNERS.map((c) => `canto-${c}` as const)]

/** Pixel (x, y) está dentro do losango 24×12 (o mesmo molde dos tiles). */
export function inDiamond(x: number, y: number): boolean {
  if (y < 0 || y >= TILE_H) return false
  const half = y < TILE_H / 2 ? 1 + 2 * y : 1 + 2 * (TILE_H - 1 - y)
  return x >= TILE_W / 2 - half && x < TILE_W / 2 + half
}

// Coordenadas normalizadas do centro do pixel: o losango é |u| + |v| ≤ 1.
function uv(x: number, y: number): [number, number] {
  return [(x + 0.5 - TILE_W / 2) / (TILE_W / 2), (y + 0.5 - TILE_H / 2) / (TILE_H / 2)]
}

/**
 * Distância até o lado (0 na borda, 1 na borda oposta) e posição ao longo
 * dele (0 num vértice, 1 no outro, em sentido horário).
 */
function sideMetrics(side: Side, u: number, v: number): { depth: number; along: number } {
  switch (side) {
    case 'ne':
      return { depth: (1 - (u - v)) / 2, along: (u + v + 1) / 2 }
    case 'se':
      return { depth: (1 - (u + v)) / 2, along: (v - u + 1) / 2 }
    case 'so':
      return { depth: (1 - (v - u)) / 2, along: (1 - u - v) / 2 }
    case 'no':
      return { depth: (1 + u + v) / 2, along: (u - v + 1) / 2 }
  }
}

/**
 * Largura da faixa da borda ao longo do lado. Igual nos dois vértices, para a
 * borda continuar sem degrau de um bloco para o próximo; no meio, ondula.
 */
function bandWidth(along: number, side: Side): number {
  const phase = SIDES.indexOf(side)
  return 0.3 + 0.07 * Math.sin(Math.PI * along * 2 + phase) * Math.sin(Math.PI * along) + 0.04 * Math.sin(Math.PI * along * 5)
}

function inBand(side: Side, x: number, y: number): boolean {
  const [u, v] = uv(x, y)
  const { depth, along } = sideMetrics(side, u, v)
  return depth < bandWidth(along, side)
}

/**
 * Máscara padrão (1 = o vizinho entra aqui), enquanto o usuário não desenha a
 * dele. O canto é o encontro das faixas dos dois lados, para casar com elas.
 */
export function defaultMask(key: MaskKey): Uint8Array {
  const mask = new Uint8Array(TILE_W * TILE_H)
  for (let y = 0; y < TILE_H; y += 1) {
    for (let x = 0; x < TILE_W; x += 1) {
      if (!inDiamond(x, y)) continue
      let on: boolean
      if (key.startsWith('lado-')) on = inBand(key.slice(5) as Side, x, y)
      else {
        const [a, b] = CORNER_SIDES[key.slice(6) as Corner]
        on = inBand(a, x, y) && inBand(b, x, y)
      }
      if (on) mask[y * TILE_W + x] = 1
    }
  }
  return mask
}

export type TerrainGrid = { cols: number; rows: number; cells: (string | null)[] }

export function cellOf(grid: TerrainGrid, col: number, row: number): string | null {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null
  return grid.cells[row * grid.cols + col] ?? null
}

/**
 * O que pintar por cima do chão de um bloco: para cada terreno vizinho de
 * prioridade maior (do menor para o maior), as máscaras dos lados em que ele
 * encosta e dos cantos em que só ele encosta (com um lado vizinho igual, a
 * faixa do lado já cobre o canto).
 */
export function overlaysAt(grid: TerrainGrid, col: number, row: number): { terrain: string; masks: MaskKey[] }[] {
  const own = cellOf(grid, col, row)
  const ownPriority = own === null ? -1 : terrainPriority(own)
  const found = new Map<string, MaskKey[]>()
  const add = (terrain: string, mask: MaskKey) => {
    const list = found.get(terrain) ?? []
    list.push(mask)
    found.set(terrain, list)
  }
  const sideTerrain = {} as Record<Side, string | null>
  for (const side of SIDES) {
    const [dc, dr] = SIDE_STEP[side]
    const other = cellOf(grid, col + dc, row + dr)
    sideTerrain[side] = other
    if (other !== null && other !== own && terrainPriority(other) > ownPriority) add(other, `lado-${side}`)
  }
  for (const corner of CORNERS) {
    const [dc, dr] = CORNER_STEP[corner]
    const other = cellOf(grid, col + dc, row + dr)
    if (other === null || other === own || terrainPriority(other) <= ownPriority) continue
    const [a, b] = CORNER_SIDES[corner]
    if (sideTerrain[a] === other || sideTerrain[b] === other) continue
    add(other, `canto-${corner}`)
  }
  return [...found.entries()]
    .sort((x, y) => terrainPriority(x[0]) - terrainPriority(y[0]))
    .map(([terrain, masks]) => ({ terrain, masks }))
}

/** Variação do tile num bloco: fixa por posição, para não piscar ao redesenhar. */
export function variantAt(col: number, row: number, count: number): number {
  if (count <= 1) return 0
  let h = (col * 73856093) ^ (row * 19349663)
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  return ((h ^ (h >>> 15)) >>> 0) % count
}

/** Canto de cima do losango do bloco, com a origem no canto de cima do bloco (0, 0). */
export function tileOrigin(col: number, row: number): { x: number; y: number } {
  return { x: ((col - row) * TILE_W) / 2 - TILE_W / 2, y: ((col + row) * TILE_H) / 2 }
}

/** Bloco sob um ponto (mesma origem de `tileOrigin`, com o vértice de cima do bloco (0, 0) em x = 0). */
export function cellAt(px: number, py: number): { col: number; row: number } {
  const a = px / TILE_W + py / TILE_H
  const b = py / TILE_H - px / TILE_W
  return { col: Math.floor(a), row: Math.floor(b) }
}

/**
 * Nome de arquivo → terreno e variação: `grama-1.png`, `agua-funda-2.png`.
 * Máscaras: `mascara-lado-ne.png`, `mascara-canto-n.png`.
 */
export function parseTileFile(name: string): { kind: 'terrain'; terrain: string; variant: number } | { kind: 'mask'; mask: MaskKey } | null {
  const base = name.replace(/^.*\//, '').replace(/\.png$/i, '')
  const mask = /^mascara-(lado-(?:ne|se|so|no)|canto-[nlso])$/.exec(base)
  if (mask) return { kind: 'mask', mask: mask[1] as MaskKey }
  const terrain = /^([a-z][a-z-]*?)-(\d+)$/.exec(base)
  if (terrain) return { kind: 'terrain', terrain: terrain[1] ?? base, variant: Number(terrain[2]) }
  return null
}
