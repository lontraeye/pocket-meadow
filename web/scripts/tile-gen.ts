// Gera tiles de chão provisórios (art/tiles/<terreno>-<n>.png) com as cores da
// paleta geral (art/paletas/pocket-meadow-geral.gpl). Cada terreno é uma
// receita: cor de base, salpicos em pares de pixels (o "grão" do isométrico) e
// detalhes pequenos (tufos, pedrinhas, brilhos) longe da borda, para a emenda
// entre blocos não aparecer. Não sobrescreve tile que já existe; `--force` refaz.
// Uso: npx tsx scripts/tile-gen.ts [--force] [terreno...]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { TILE_H, TILE_W, inDiamond } from '../src/lib/terrain.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../../art/tiles')
const paletteFile = path.resolve(here, '../../art/paletas/pocket-meadow-geral.gpl')

type RGB = [number, number, number]
const palette = new Map<string, RGB>()
for (const line of fs.readFileSync(paletteFile, 'utf8').split('\n')) {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line)
  if (match) palette.set(match[4]!.trim(), [Number(match[1]), Number(match[2]), Number(match[3])])
}
const color = (name: string): RGB => {
  const rgb = palette.get(name)
  if (!rgb) throw new Error(`cor fora da paleta: ${name}`)
  return rgb
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pixel e os vizinhos a `margin` de distância estão dentro do losango (detalhe longe da borda). */
function deepInside(x: number, y: number, margin: number): boolean {
  for (let dy = -margin; dy <= margin; dy += 1) {
    for (let dx = -margin * 2; dx <= margin * 2; dx += 1) if (!inDiamond(x + dx, y + dy)) return false
  }
  return true
}

type Stamp = { dx: number; dy: number; c: string }[]
type Recipe = {
  base: string
  /** Salpicos: cor e chance por par de pixels. */
  speckles: { c: string; p: number }[]
  /** Detalhes desenhados longe da borda: formas e quantos por tile. */
  details?: { stamps: Stamp[]; count: [number, number]; margin?: number }[]
  /** Pintura fixa por pixel (sulcos, moldura), antes dos detalhes; null = deixa como está. */
  paint?: (x: number, y: number) => string | null
  variants: number
}

/** Pixel na borda do losango (algum vizinho de 4 direções fica fora). */
function onEdge(x: number, y: number): boolean {
  return !inDiamond(x - 1, y) || !inDiamond(x + 1, y) || !inDiamond(x, y - 1) || !inDiamond(x, y + 1)
}

const tuft = (dark: string, light: string): Stamp[] => [
  [{ dx: 0, dy: 0, c: dark }, { dx: 1, dy: -1, c: light }, { dx: -1, dy: -1, c: light }],
  [{ dx: 0, dy: 0, c: dark }, { dx: 0, dy: -1, c: light }, { dx: 1, dy: 0, c: dark }, { dx: 2, dy: -1, c: light }],
]
const pebble = (dark: string, light: string): Stamp[] => [
  [{ dx: 0, dy: 0, c: light }, { dx: 1, dy: 0, c: light }, { dx: 0, dy: 1, c: dark }, { dx: 1, dy: 1, c: dark }],
  [{ dx: 0, dy: 0, c: light }, { dx: 1, dy: 1, c: dark }],
]
const flower = (petal: string): Stamp[] => [
  [{ dx: 0, dy: -1, c: petal }, { dx: -1, dy: 0, c: petal }, { dx: 1, dy: 0, c: petal }, { dx: 0, dy: 0, c: 'Miolo da flor' }, { dx: 0, dy: 1, c: 'Grama 2' }],
]

// Receitas enxutas: base + no máximo um tom de salpico e poucos detalhes,
// para o chão ficar calmo e os Pokémon se destacarem.
const dots = (c: string): Stamp[] => [
  [{ dx: 0, dy: 0, c }, { dx: 1, dy: 0, c }],
  [{ dx: 0, dy: 0, c }, { dx: 1, dy: -1, c }],
]

const recipes: Record<string, Recipe> = {
  grama: {
    base: 'Grama 3',
    speckles: [{ c: 'Grama 2', p: 0.025 }],
    details: [{ stamps: dots('Grama 2'), count: [1, 2] }],
    variants: 3,
  },
  'grama-alta': {
    base: 'Grama alta 3',
    speckles: [{ c: 'Grama alta 2', p: 0.05 }],
    details: [{ stamps: tuft('Grama alta 2', 'Grama alta 4'), count: [2, 3] }],
    variants: 3,
  },
  flores: {
    base: 'Grama 3',
    speckles: [{ c: 'Grama 2', p: 0.02 }],
    details: [{ stamps: [...flower('Flor rosa'), ...flower('Flor amarela'), ...flower('Flor vermelha')], count: [1, 2], margin: 2 }],
    variants: 3,
  },
  terra: {
    base: 'Terra 3',
    speckles: [{ c: 'Terra 2', p: 0.03 }],
    details: [{ stamps: dots('Terra 2'), count: [0, 1] }],
    variants: 3,
  },
  areia: {
    base: 'Areia 3',
    speckles: [{ c: 'Areia 4', p: 0.03 }],
    variants: 3,
  },
  pedra: {
    base: 'Pedra 3',
    speckles: [{ c: 'Pedra 2', p: 0.025 }],
    details: [
      { stamps: [[{ dx: 0, dy: 0, c: 'Pedra 2' }, { dx: 1, dy: 0, c: 'Pedra 2' }, { dx: 2, dy: 1, c: 'Pedra 2' }]], count: [0, 1] },
    ],
    variants: 3,
  },
  agua: {
    base: 'Água rasa 2',
    speckles: [],
    details: [
      { stamps: [[{ dx: 0, dy: 0, c: 'Água rasa 3' }, { dx: 1, dy: 0, c: 'Água rasa 3' }, { dx: 2, dy: 0, c: 'Água rasa 3' }]], count: [1, 2] },
    ],
    variants: 3,
  },
  'agua-funda': {
    base: 'Água funda 3',
    speckles: [],
    details: [
      { stamps: [[{ dx: 0, dy: 0, c: 'Água funda 4' }, { dx: 1, dy: 0, c: 'Água funda 4' }, { dx: 2, dy: 0, c: 'Água funda 4' }]], count: [0, 1] },
    ],
    variants: 2,
  },
  // Canteiro da horta: terra arada em sulcos, dentro de uma moldura de madeira.
  canteiro: {
    base: 'Terra 3',
    speckles: [],
    paint: (x, y) => {
      if (onEdge(x, y)) return 'Madeira 2'
      if (onEdge(x - 1, y) || onEdge(x + 1, y)) return 'Madeira 3'
      // Sulcos paralelos ao lado nordeste do losango.
      return (((Math.floor(x / 2) + y) % 3) + 3) % 3 === 0 ? 'Terra 2' : null
    },
    variants: 1,
  },
}

async function write(terrain: string, variant: number, recipe: Recipe) {
  const file = path.join(outDir, `${terrain}-${variant}.png`)
  if (fs.existsSync(file) && !process.argv.includes('--force')) {
    console.log(`já existe: ${path.basename(file)}`)
    return
  }
  const rand = mulberry32([...terrain].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) * 97 + variant)
  const px: (RGB | null)[] = Array.from({ length: TILE_W * TILE_H }, (_, i) => (inDiamond(i % TILE_W, Math.floor(i / TILE_W)) ? color(recipe.base) : null))
  const set = (x: number, y: number, c: string) => {
    if (inDiamond(x, y)) px[y * TILE_W + x] = color(c)
  }
  // Salpicos em pares horizontais: no isométrico o grão "deita".
  for (let y = 0; y < TILE_H; y += 1) {
    for (let x = 0; x < TILE_W; x += 2) {
      const roll = rand()
      let acc = 0
      for (const speckle of recipe.speckles) {
        acc += speckle.p
        if (roll < acc) {
          const shift = rand() < 0.5 ? 0 : 1
          set(x + shift, y, speckle.c)
          if (rand() < 0.6) set(x + shift + 1, y, speckle.c)
          break
        }
      }
    }
  }
  if (recipe.paint) {
    for (let y = 0; y < TILE_H; y += 1) {
      for (let x = 0; x < TILE_W; x += 1) {
        if (!inDiamond(x, y)) continue
        const c = recipe.paint(x, y)
        if (c) set(x, y, c)
      }
    }
  }
  for (const group of recipe.details ?? []) {
    const [min, max] = group.count
    const count = min + Math.floor(rand() * (max - min + 1))
    for (let n = 0; n < count; n += 1) {
      for (let tries = 0; tries < 40; tries += 1) {
        const x = 3 + Math.floor(rand() * (TILE_W - 6))
        const y = 2 + Math.floor(rand() * (TILE_H - 4))
        if (!deepInside(x, y, group.margin ?? 1)) continue
        const stamp = group.stamps[Math.floor(rand() * group.stamps.length)]!
        for (const dot of stamp) set(x + dot.dx, y + dot.dy, dot.c)
        break
      }
    }
  }
  const rgba = Buffer.alloc(TILE_W * TILE_H * 4)
  px.forEach((c, i) => {
    if (!c) return
    rgba[i * 4] = c[0]
    rgba[i * 4 + 1] = c[1]
    rgba[i * 4 + 2] = c[2]
    rgba[i * 4 + 3] = 255
  })
  await sharp(rgba, { raw: { width: TILE_W, height: TILE_H, channels: 4 } }).png().toFile(file)
  console.log(`gerado: ${path.basename(file)}`)
}

const only = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
for (const [terrain, recipe] of Object.entries(recipes)) {
  if (only.length > 0 && !only.includes(terrain)) continue
  for (let variant = 1; variant <= recipe.variants; variant += 1) await write(terrain, variant, recipe)
}
