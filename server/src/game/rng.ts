import { webcrypto } from 'node:crypto'
import { mulberry32, type Rng } from './mulberry32.js'

export { mulberry32, type Rng }

export function randomSeed(): number {
  const buffer = new Uint32Array(1)
  webcrypto.getRandomValues(buffer)
  const seed = buffer[0]
  if (seed === undefined) throw new Error('failed to draw encounter seed')
  return seed
}

/** Unidade em [0, 1) via crypto — colheita e recompensas sem seed de replay. */
export function unitRoll(): number {
  return randomSeed() / 4294967296
}
