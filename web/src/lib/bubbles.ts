// Balão de diálogo dos pets no jardim (PLANNING.md, seção 5.21): ícones em
// pixel art desenhados como grade de letras (como os ícones do HUD) e o
// balão montado em volta. Cada letra é uma cor; '.' é transparente.

export type BubbleKind = 'pet' | 'hunger' | 'happy' | 'sad'

type Grid = { rows: string[]; colors: Record<string, string> }

const ICONS: Record<BubbleKind, Grid> = {
  // Coração: dá para fazer carinho agora (tocar faz).
  pet: {
    rows: ['.RR.RR.', 'RWRRRRR', 'RRRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...'],
    colors: { R: '#e0506e', W: '#ffffff' },
  },
  // Fruta: está com fome.
  hunger: {
    rows: ['...GG..', '..G....', '.BBBBB.', 'BWBBBBB', 'BBBBBBB', 'BBBBBBB', '.BBBBB.'],
    colors: { G: '#4caa3c', B: '#3d7fd6', W: '#bfe0ff' },
  },
  happy: {
    rows: ['..OOOO..', '.OYYYYO.', 'OYKYYKYO', 'OYYYYYYO', 'OKYYYYKO', 'OYKKKKYO', '.OYYYYO.', '..OOOO..'],
    colors: { O: '#c08a1c', Y: '#f6d04d', K: '#3a2a14' },
  },
  sad: {
    rows: ['..OOOO..', '.OSSSSO.', 'OSKSSKSO', 'OSSSSSSO', 'OSSKKSSO', 'OSKSSKSO', '.OSSSSO.', '..OOOO..'],
    colors: { O: '#4a78a8', S: '#9cc4e8', K: '#22324a' },
  },
}

export type Pixel = { x: number; y: number; color: string }

/**
 * O balão inteiro em pixels: borda escura, fundo branco, o ícone no meio e a
 * ponta embaixo, no centro. `width`/`height` em pixels da grade.
 */
export function bubblePixels(kind: BubbleKind): { width: number; height: number; pixels: Pixel[] } {
  const icon = ICONS[kind]
  const iconW = icon.rows[0]?.length ?? 0
  const iconH = icon.rows.length
  const width = iconW + 4
  const boxH = iconH + 4
  const height = boxH + 2
  const pixels: Pixel[] = []
  const edge = '#2b2b2b'
  const fill = '#ffffff'
  for (let y = 0; y < boxH; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const corner = (x === 0 || x === width - 1) && (y === 0 || y === boxH - 1)
      if (corner) continue
      const border = x === 0 || y === 0 || x === width - 1 || y === boxH - 1
      pixels.push({ x, y, color: border ? edge : fill })
    }
  }
  // Ponta: dois degraus para baixo, no meio.
  const mid = Math.floor(width / 2)
  pixels.push({ x: mid - 1, y: boxH - 1, color: fill }, { x: mid, y: boxH - 1, color: fill })
  pixels.push({ x: mid - 2, y: boxH - 1, color: edge }, { x: mid + 1, y: boxH - 1, color: edge })
  pixels.push({ x: mid - 1, y: boxH, color: edge }, { x: mid, y: boxH, color: fill }, { x: mid + 1, y: boxH, color: edge })
  pixels.push({ x: mid, y: boxH + 1, color: edge })
  icon.rows.forEach((row, y) => {
    ;[...row].forEach((cell, x) => {
      const color = icon.colors[cell]
      if (color) pixels.push({ x: x + 2, y: y + 2, color })
    })
  })
  return { width, height, pixels }
}

export const BUBBLES: Record<BubbleKind, ReturnType<typeof bubblePixels>> = {
  pet: bubblePixels('pet'),
  hunger: bubblePixels('hunger'),
  happy: bubblePixels('happy'),
  sad: bubblePixels('sad'),
}
