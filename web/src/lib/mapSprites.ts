/**
 * Desenhos em pixel art do mapa da jornada (originais, feitos aqui). Cada um é
 * uma grade de letras (uma por pixel); a paleta diz a cor de cada letra e "."
 * é transparente. Viram retângulos (um por trecho da mesma cor na linha) e
 * entram como <symbol> no SVG do mapa.
 */

export const MAP_PALETTE: Readonly<Record<string, string>> = {
  k: '#283028', // contorno
  R: '#e05848', // telhado
  r: '#a83030', // beira do telhado
  W: '#f8f0d8', // parede
  w: '#d8c8a0', // sombra da parede
  b: '#5890e8', // janela
  d: '#584030', // porta
  G: '#3a8a3a', // mato alto
  l: '#78c858', // folha clara
  g: '#2a6a2a', // sombra do mato
  M: '#b08850', // pedra / montanha
  m: '#80603a', // sombra da pedra
  h: '#d8b878', // luz da pedra
  D: '#201810', // entrada escura
  S: '#c8c0b0', // pedra da torre
  s: '#988f80', // sombra da torre
  L: '#48a048', // copa
  T: '#7a5030', // tronco
  B: '#5890e8', // água
  c: '#a8d0f8', // espuma
  C: '#e04040', // boné
  F: '#f8c8a0', // pele
  H: '#403028', // cabelo
  U: '#3868c8', // camisa
  P: '#384058', // calça
  Y: '#f8d030', // bandeira
}

export type PixelRect = { x: number; y: number; w: number; fill: string }
export type PixelSprite = { id: string; size: number; height: number; rects: PixelRect[] }

function sprite(id: string, rows: readonly string[]): PixelSprite {
  const width = rows[0]!.length
  for (const row of rows) {
    if (row.length !== width) throw new Error(`mapSprites: ${id} com linha de largura ${row.length} (esperado ${width})`)
  }
  const rects: PixelRect[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const char = row[x]!
      let end = x + 1
      while (end < row.length && row[end] === char) end += 1
      if (char !== '.') {
        const fill = MAP_PALETTE[char]
        if (!fill) throw new Error(`mapSprites: ${id} usa a cor "${char}" sem paleta`)
        rects.push({ x, y, w: end - x, fill })
      }
      x = end
    }
  })
  return { id, size: width, height: rows.length, rects }
}

/** Grade 16×16 gerada por uma função (mato e água, que são padrões). */
function grid(pick: (x: number, y: number) => string): string[] {
  return Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => pick(x, y)).join(''))
}

const edge = (x: number, y: number) => x === 0 || y === 0 || x === 15 || y === 15
const corner = (x: number, y: number) => (x === 0 || x === 15) && (y === 0 || y === 15)

const town = sprite('pm-town', [
  '................',
  '....kkkkkkkk....',
  '...kRRRRRRRRk...',
  '..kRRRRRRRRRRk..',
  '.kRRRRRRRRRRRRk.',
  'kkrrrrrrrrrrrrkk',
  '.kWWWWWWWWWWWWk.',
  '.kWbbWWWWWWbbWk.',
  '.kWbbWWWWWWbbWk.',
  '.kWWWWWkkWWWWWk.',
  '.kWWWWkddkWWWWk.',
  '.kwwwwkddkwwwwk.',
  '.kkkkkkkkkkkkkk.',
  '................',
  '................',
  '................',
])

const grass = sprite(
  'pm-grass',
  grid((x, y) => {
    if (corner(x, y)) return '.'
    if (edge(x, y)) return 'k'
    if (y % 4 === 1 && x % 4 === 2) return 'l'
    if (y % 4 === 2 && (x % 4 === 1 || x % 4 === 3)) return 'l'
    if (y % 4 === 3 && x % 4 === 2) return 'g'
    return 'G'
  }),
)

const cave = sprite('pm-cave', [
  '................',
  '......kkkk......',
  '.....kMMMMk.....',
  '....kMhMMMMk....',
  '...kMhhMMMMMk...',
  '..kMhMMMMMMMMk..',
  '..kMMMMMMMMMMk..',
  '.kMMMMMkkkMMMMk.',
  '.kMMMMkDDDkMMMk.',
  'kMMMMkDDDDDkMMMk',
  'kMMMMkDDDDDkMMmk',
  'kmMMMkDDDDDkMmmk',
  'kmmmmkDDDDDkmmmk',
  'kkkkkkkkkkkkkkkk',
  '................',
  '................',
])

const tower = sprite('pm-tower', [
  '......kkkk......',
  '.....kRRRRk.....',
  '....kRRRRRRk....',
  '...kkkkkkkkkk...',
  '....kSSSSSSk....',
  '....kSbSSbSk....',
  '....kSSSSSSk....',
  '...kkkkkkkkkk...',
  '...kRRRRRRRRk...',
  '..kkkkkkkkkkkk..',
  '...kSSSSSSSSk...',
  '...kSbSSSSbSk...',
  '...kSSSkkSSSk...',
  '...kSSkDDkSSk...',
  '...ksskDDksssk..',
  '..kkkkkkkkkkkk..',
])

const tree = sprite('pm-tree', [
  '................',
  '......kkkk......',
  '....kkLLLLkk....',
  '...kLLlLLLLLk...',
  '..kLLllLLLLLLk..',
  '..kLlLLLLLLLLk..',
  '.kLLLLLLLLLLLLk.',
  '.kLLLLLLLLLLgLk.',
  '.kLLLLLLLLLggLk.',
  '..kLLLLLLLgggk..',
  '..kgLLLLLggggk..',
  '...kkggggggkk...',
  '.....kkTTkk.....',
  '......kTTk......',
  '......kTTk......',
  '.......kk.......',
])

const water = sprite(
  'pm-water',
  grid((x, y) => {
    if (corner(x, y)) return '.'
    if (edge(x, y)) return 'k'
    const shift = Math.floor(y / 4) * 3
    if (y % 4 === 2 && [1, 2, 3].includes((x + shift) % 8)) return 'c'
    return 'B'
  }),
)

/** O treinador no mapa (de frente), 8×10. */
const trainer = sprite('pm-trainer', [
  '..kkkk..',
  '.kCCCCk.',
  'kCCCCCCk',
  'kHFFFFHk',
  'kFkFFkFk',
  '.kFFFFk.',
  'kUUUUUUk',
  'FkUUUUkF',
  '.kPPPPk.',
  '.kPk.kPk',
])

const flag = sprite('pm-flag', [
  'kk......',
  'kYYYYk..',
  'kYYYYYYk',
  'kYYYYk..',
  'kk......',
  'kk......',
  'kk......',
  'kk......',
])

/** Cor do gramado do mapa (fundo e base das versões apagadas). */
export const GROUND = '#88c870'

/**
 * Versão apagada (lugar fechado): cinza puxado para o gramado. Pronta na
 * paleta, sem filtro CSS, que pesa ao rolar o mapa.
 */
function faded(source: PixelSprite): PixelSprite {
  const mix = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]
    const gray = Math.round(0.3 * r + 0.59 * g + 0.11 * b)
    const [gr, gg, gb] = [1, 3, 5].map((at) => parseInt(GROUND.slice(at, at + 2), 16)) as [number, number, number]
    const channel = (base: number) => Math.round(gray * 0.45 + base * 0.55)
    return `#${[channel(gr), channel(gg), channel(gb)].map((value) => value.toString(16).padStart(2, '0')).join('')}`
  }
  return { ...source, id: `${source.id}-off`, rects: source.rects.map((rect) => ({ ...rect, fill: mix(rect.fill) })) }
}

const placeSprites = [town, grass, cave, tower, tree, water]

export const MAP_SPRITES: readonly PixelSprite[] = [...placeSprites, ...placeSprites.map(faded), trainer, flag]

/** A árvore, para desenhar o fundo num canvas. */
export const TREE_SPRITE = tree

/** Tufinhos do tile de gramado (32 px): x, y e cor de cada pixel de 2 px. */
export const GROUND_TUFTS: readonly [number, number, string][] = [
  [4, 6, '#a8d888'],
  [6, 4, '#a8d888'],
  [20, 18, '#70b058'],
  [22, 20, '#70b058'],
  [24, 18, '#70b058'],
  [12, 26, '#a8d888'],
  [26, 4, '#70b058'],
]

export type PlaceIcon = 'town' | 'grass' | 'cave' | 'tower' | 'forest' | 'water'

/** Desenho de cada lugar, pelo tipo e pelo nome (slug). */
export function iconOf(kind: 'town' | 'area' | 'water', slug: string): PlaceIcon {
  if (kind === 'town') return 'town'
  if (kind === 'water') return 'water'
  if (/tower/.test(slug)) return 'tower'
  if (/forest|park/.test(slug)) return 'forest'
  if (/cave|well|mt-|ice-path|den|victory-road|whirl|falls|ruins/.test(slug)) return 'cave'
  return 'grass'
}

/** Número pseudoaleatório estável por posição (árvores sempre no mesmo lugar). */
export function cellHash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}
