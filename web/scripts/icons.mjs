/**
 * Gera os PNG do PWA a partir de web/icons/meadow.svg (hoje o Mystery Egg em pixels).
 * Uso: npm run icons  (na pasta web)
 *
 * Saídas em web/public/:
 *   icons/icon-192.png
 *   icons/icon-512.png               (fundo transparente)
 *   icons/icon-512-maskable.png      (fundo branco, margem segura 20% cada lado)
 *   icons/apple-touch-icon.png       (180, fundo branco)
 *   favicon.svg                      (cópia do SVG de origem, transparente)
 *
 * O iPhone pinta de preto o fundo transparente do apple-touch-icon, e o
 * Android corta o maskable num círculo ou gota e precisa de fundo cheio:
 * esses dois levam branco.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'icons/meadow.svg')
const publicDir = path.join(root, 'public')
const iconsDir = path.join(publicDir, 'icons')

const SOLID = { r: 0xff, g: 0xff, b: 0xff, alpha: 1 }

/** O SVG centralizado num quadrado de fundo cheio, com margem em cada lado. */
async function onSolid(svg, size, padRatio, file) {
  const pad = Math.round(size * padRatio)
  const inner = size - pad * 2
  const content = await sharp(svg).resize(inner, inner, { kernel: 'nearest' }).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: SOLID } })
    .composite([{ input: content, left: pad, top: pad }])
    .png()
    .toFile(path.join(iconsDir, file))
}

async function main() {
  if (!fs.existsSync(source)) throw new Error(`missing ${source}`)
  fs.mkdirSync(iconsDir, { recursive: true })

  const svg = fs.readFileSync(source)

  await sharp(svg).resize(192, 192, { kernel: 'nearest' }).png().toFile(path.join(iconsDir, 'icon-192.png'))
  await sharp(svg).resize(512, 512, { kernel: 'nearest' }).png().toFile(path.join(iconsDir, 'icon-512.png'))
  await onSolid(svg, 180, 0.1, 'apple-touch-icon.png')
  await onSolid(svg, 512, 0.2, 'icon-512-maskable.png')

  fs.copyFileSync(source, path.join(publicDir, 'favicon.svg'))

  console.log('icons ready in web/public/icons/ (+ favicon.svg)')
}

await main()
