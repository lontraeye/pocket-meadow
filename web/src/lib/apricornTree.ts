// Árvore de Apricorn no jardim (PLANNING.md, seção 5.23). Arte do usuário em
// art/jardim/: a árvore sem frutos e a mesma com os 5 frutos. Os frutos saem
// da diferença entre as duas (cada grupo de pixels vizinhos é um fruto), e o
// jardim desenha a árvore com quantos estiverem pendurados.

import type { Pixel } from './bubbles'
import baseUrl from '../../../art/jardim/arvore-apricorn.png?url'
import fruitsUrl from '../../../art/jardim/arvore-apricorn-frutos.png?url'

export type TreeArt = { width: number; height: number; base: Pixel[]; fruits: Pixel[][] }

async function readPixels(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0)
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
}

const hex = (data: Uint8ClampedArray, i: number) =>
  `#${[data[i]!, data[i + 1]!, data[i + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('')}`

let loading: Promise<TreeArt> | null = null

/** As duas imagens lidas uma vez; os frutos em ordem de cima para baixo. */
export function loadTreeArt(): Promise<TreeArt> {
  loading ??= Promise.all([readPixels(baseUrl), readPixels(fruitsUrl)]).then(([base, ripe]) => {
    const { width, height } = base
    const basePixels: Pixel[] = []
    const changed = new Map<number, Pixel>()
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4
        if (base.data[i + 3]! > 0) basePixels.push({ x, y, color: hex(base.data, i) })
        const same = [0, 1, 2, 3].every((k) => base.data[i + k] === ripe.data[i + k])
        if (!same && ripe.data[i + 3]! > 0) changed.set(y * width + x, { x, y, color: hex(ripe.data, i) })
      }
    }
    // Agrupa os pixels mudados em frutos (vizinhos nas 8 direções).
    const fruits: Pixel[][] = []
    const seen = new Set<number>()
    for (const [key, first] of changed) {
      if (seen.has(key)) continue
      const group: Pixel[] = []
      const stack = [first]
      seen.add(key)
      while (stack.length > 0) {
        const px = stack.pop()!
        group.push(px)
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const next = (px.y + dy) * width + (px.x + dx)
            const neighbor = changed.get(next)
            if (neighbor && !seen.has(next) && Math.abs(neighbor.x - px.x) <= 1) {
              seen.add(next)
              stack.push(neighbor)
            }
          }
        }
      }
      fruits.push(group)
    }
    const top = (group: Pixel[]) => Math.min(...group.map((px) => px.y * width + px.x))
    fruits.sort((a, b) => top(a) - top(b))
    return { width, height, base: basePixels, fruits }
  })
  return loading
}

/** A árvore com `count` frutos pendurados (por cima da copa). */
export function treePixels(art: TreeArt, count: number): Pixel[] {
  const fruitPixels = art.fruits.slice(0, Math.max(0, count)).flat()
  const covered = new Set(fruitPixels.map((px) => px.y * art.width + px.x))
  return [...art.base.filter((px) => !covered.has(px.y * art.width + px.x)), ...fruitPixels]
}
