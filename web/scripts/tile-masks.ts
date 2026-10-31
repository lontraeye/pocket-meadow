// Gera as máscaras padrão das bordas (art/tiles/mascara-*.png) a partir de
// `defaultMask`. Pixel preto = onde o terreno vizinho entra. Não sobrescreve
// uma máscara que já existe (a do usuário); `--force` refaz todas.
// Uso: npx tsx scripts/tile-masks.ts [--force]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { MASK_KEYS, TILE_H, TILE_W, defaultMask } from '../src/lib/terrain.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../art/tiles')
const force = process.argv.includes('--force')

for (const key of MASK_KEYS) {
  const file = path.join(root, `mascara-${key}.png`)
  if (fs.existsSync(file) && !force) {
    console.log(`já existe: ${path.basename(file)}`)
    continue
  }
  const mask = defaultMask(key)
  const rgba = Buffer.alloc(TILE_W * TILE_H * 4)
  for (let i = 0; i < mask.length; i += 1) rgba[i * 4 + 3] = mask[i] ? 255 : 0
  await sharp(rgba, { raw: { width: TILE_W, height: TILE_H, channels: 4 } }).png().toFile(file)
  console.log(`gerada: ${path.basename(file)}`)
}
