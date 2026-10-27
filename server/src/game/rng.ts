import { webcrypto } from 'node:crypto'

export type Rng = () => number

// mulberry32 (bryc). A seed guardada no encontro reproduz a sequência inteira.
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomSeed(): number {
  const buffer = new Uint32Array(1)
  webcrypto.getRandomValues(buffer)
  const seed = buffer[0]
  if (seed === undefined) throw new Error('failed to draw encounter seed')
  return seed
}
