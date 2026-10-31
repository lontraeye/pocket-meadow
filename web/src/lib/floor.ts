// Desenho do chão em blocos isométricos (PLANNING.md, seção 5.22) num canvas:
// a textura de cada terreno e as bordas pelas máscaras (regras em terrain.ts).
// Usado pelo jardim e pelo laboratório de tiles.

import {
  MASK_KEYS,
  TILE_H,
  TILE_W,
  defaultMask,
  overlaysAt,
  parseTileFile,
  terrainPriority,
  tileOrigin,
  variantAt,
  type MaskKey,
  type TerrainGrid,
} from './terrain'

export type FloorAssets = {
  /** Variações de cada terreno, na ordem do número do arquivo. */
  terrains: Map<string, HTMLImageElement[]>
  masks: Map<MaskKey, Uint8Array>
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(url))
    img.src = url
  })
}

/** Pixels com alpha de uma máscara de 24×12. */
export function maskFromImage(img: HTMLImageElement): Uint8Array {
  const scratch = document.createElement('canvas')
  scratch.width = TILE_W
  scratch.height = TILE_H
  const ctx = scratch.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, TILE_W, TILE_H).data
  const out = new Uint8Array(TILE_W * TILE_H)
  for (let i = 0; i < out.length; i += 1) out[i] = (data[i * 4 + 3] ?? 0) > 0 ? 1 : 0
  return out
}

/**
 * Monta os assets a partir de nomes de arquivo e URLs (`grama-1.png` → url).
 * Arquivo de tamanho errado fica de fora e entra em `problems`.
 */
export async function buildFloorAssets(files: { name: string; url: string }[]): Promise<FloorAssets & { problems: string[] }> {
  const found = new Map<string, { variant: number; img: HTMLImageElement }[]>()
  const masks = new Map<MaskKey, Uint8Array>()
  const problems: string[] = []
  await Promise.all(
    files.map(async (file) => {
      const parsed = parseTileFile(file.name)
      if (!parsed) return
      let img: HTMLImageElement
      try {
        img = await loadImage(file.url)
      } catch {
        problems.push(`${file.name}: não abriu.`)
        return
      }
      if (img.naturalWidth !== TILE_W || img.naturalHeight !== TILE_H) {
        problems.push(`${file.name}: tem ${img.naturalWidth}×${img.naturalHeight}; precisa de ${TILE_W}×${TILE_H}.`)
        return
      }
      if (parsed.kind === 'mask') masks.set(parsed.mask, maskFromImage(img))
      else {
        const list = found.get(parsed.terrain) ?? []
        list.push({ variant: parsed.variant, img })
        found.set(parsed.terrain, list)
      }
    }),
  )
  for (const key of MASK_KEYS) if (!masks.has(key)) masks.set(key, defaultMask(key))
  const terrains = new Map(
    [...found.entries()]
      .sort((a, b) => terrainPriority(a[0]) - terrainPriority(b[0]))
      .map(([key, list]) => [key, list.sort((a, b) => a.variant - b.variant).map((row) => row.img)] as const),
  )
  return { terrains, masks, problems }
}

export type DrawOptions = {
  /** Deslocamento do vértice de cima do bloco (0, 0) no canvas. */
  offsetX: number
  offsetY?: number
  variants?: boolean
  /** Pinta as bordas de rosa (laboratório). */
  debugMasks?: boolean
  /** Variação por bloco; o padrão é `variantAt`. */
  variantOf?: (col: number, row: number, count: number) => number
}

/** Desenha a grade inteira: chão de cada bloco e, por cima, as bordas dos vizinhos. */
export function drawFloor(ctx: CanvasRenderingContext2D, grid: TerrainGrid, assets: FloorAssets, options: DrawOptions) {
  const scratch = document.createElement('canvas')
  scratch.width = TILE_W
  scratch.height = TILE_H
  const sctx = scratch.getContext('2d')!
  const pickVariant = options.variantOf ?? variantAt
  const pick = (terrain: string, col: number, row: number) => {
    const list = assets.terrains.get(terrain)
    if (!list || list.length === 0) return null
    return list[options.variants === false ? 0 : pickVariant(col, row, list.length)] ?? list[0]!
  }
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const key = grid.cells[row * grid.cols + col]
      const o = tileOrigin(col, row)
      const x = options.offsetX + o.x
      const y = (options.offsetY ?? 0) + o.y
      const base = key ? pick(key, col, row) : null
      if (base) ctx.drawImage(base, x, y)
      for (const overlay of overlaysAt(grid, col, row)) {
        const over = pick(overlay.terrain, col, row)
        if (!over) continue
        sctx.globalCompositeOperation = 'source-over'
        sctx.clearRect(0, 0, TILE_W, TILE_H)
        sctx.putImageData(maskImage(assets, overlay.masks), 0, 0)
        sctx.globalCompositeOperation = 'source-in'
        if (options.debugMasks) {
          sctx.fillStyle = '#ff2bd6'
          sctx.fillRect(0, 0, TILE_W, TILE_H)
        } else sctx.drawImage(over, 0, 0)
        ctx.drawImage(scratch, x, y)
      }
    }
  }
}

function maskImage(assets: FloorAssets, keys: MaskKey[]): ImageData {
  const image = new ImageData(TILE_W, TILE_H)
  for (const key of keys) {
    const mask = assets.masks.get(key)
    if (!mask) continue
    for (let i = 0; i < mask.length; i += 1) if (mask[i]) image.data[i * 4 + 3] = 255
  }
  return image
}

/**
 * Padrão que se repete em retângulo e forma o chão de um terreno só: `n × n`
 * blocos com as variações sorteadas de forma periódica (o retângulo de
 * n·24 × n·12 é um período da grade isométrica). Serve de fundo infinito.
 */
export function floorPattern(assets: FloorAssets, terrain: string, n = 4): HTMLCanvasElement | null {
  const list = assets.terrains.get(terrain)
  if (!list || list.length === 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = n * TILE_W
  canvas.height = n * TILE_H
  const ctx = canvas.getContext('2d')!
  const period = 2 * n
  const mod = (value: number) => ((value % period) + period) % period
  // Blocos que encostam no retângulo; o canvas corta o que sobra.
  for (let row = -n - 1; row <= 2 * n + 1; row += 1) {
    for (let col = -1; col <= 3 * n + 1; col += 1) {
      const o = tileOrigin(col, row)
      if (o.x + TILE_W < 0 || o.x > canvas.width || o.y + TILE_H < 0 || o.y > canvas.height) continue
      // col + row e col − row módulo 2n: igual nos dois períodos do retângulo.
      const img = list[variantAt(mod(col + row), mod(col - row), list.length)] ?? list[0]!
      ctx.drawImage(img, o.x, o.y)
    }
  }
  return canvas
}
