/**
 * Gera os PNG do PWA a partir de web/icons/meadow.svg.
 * Uso: npm run icons  (na pasta web)
 *
 * Saídas em web/public/:
 *   icons/icon-192.png
 *   icons/icon-512.png
 *   icons/icon-512-maskable.png  (margem segura ~10% cada lado)
 *   icons/apple-touch-icon.png   (180)
 *   favicon.svg                  (cópia do SVG de origem)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'icons/meadow.svg')
const publicDir = path.join(root, 'public')
const iconsDir = path.join(publicDir, 'icons')

const SKY = { r: 0xcf, g: 0xe8, b: 0xb5, alpha: 1 }

async function main() {
  if (!fs.existsSync(source)) throw new Error(`missing ${source}`)
  fs.mkdirSync(iconsDir, { recursive: true })

  const svg = fs.readFileSync(source)

  await sharp(svg).resize(192, 192, { kernel: 'nearest' }).png().toFile(path.join(iconsDir, 'icon-192.png'))
  await sharp(svg).resize(512, 512, { kernel: 'nearest' }).png().toFile(path.join(iconsDir, 'icon-512.png'))
  await sharp(svg).resize(180, 180, { kernel: 'nearest' }).png().toFile(path.join(iconsDir, 'apple-touch-icon.png'))

  const pad = Math.round(512 * 0.1)
  const inner = 512 - pad * 2
  const content = await sharp(svg).resize(inner, inner, { kernel: 'nearest' }).png().toBuffer()
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: SKY },
  })
    .composite([{ input: content, left: pad, top: pad }])
    .png()
    .toFile(path.join(iconsDir, 'icon-512-maskable.png'))

  fs.copyFileSync(source, path.join(publicDir, 'favicon.svg'))

  console.log('icons ready in web/public/icons/ (+ favicon.svg)')
}

await main()
