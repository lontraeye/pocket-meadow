import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sfxOutputDir, sfxSources } from '../src/config/sfx.js'
import { toMp3 } from './audio.js'

// Uso: npm run sounds:sfx -- <pasta do Interface Sounds> [outras pastas de pacotes]
// As pastas são os zips do Kenney extraídos; o arquivo é procurado em todas.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.resolve(serverRoot, sfxOutputDir)
const packs = process.argv.slice(2)
if (packs.length === 0) throw new Error('usage: sounds:sfx -- <kenney pack dir> [...]')

function find(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = find(full, name)
      if (found) return found
    } else if (entry.name === name) {
      return full
    }
  }
  return null
}

for (const [use, file] of Object.entries(sfxSources)) {
  const source = packs.map((pack) => find(pack, file)).find((found) => found !== null)
  if (!source) throw new Error(`${file} (${use}) not found in ${packs.join(', ')}`)
  await toMp3(source, path.join(outputDir, `${use}.mp3`))
  console.log(`${use}.mp3 ← ${file}`)
}
