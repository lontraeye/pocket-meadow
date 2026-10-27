import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cries } from '../src/config/cries.js'
import { speciesSeed } from '../src/config/seed.js'
import { toMp3 } from './audio.js'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.resolve(serverRoot, cries.outputDir)

async function main(): Promise<void> {
  let downloaded = 0

  for (let id = speciesSeed.firstId; id <= speciesSeed.lastId; id += 1) {
    downloaded += await saveCry(`${cries.sourceBase}/${id}.ogg`, path.join(outputDir, `${id}.mp3`))
    if ((id - speciesSeed.firstId + 1) % 25 === 0) {
      console.log(`checked ${id - speciesSeed.firstId + 1} cries`)
    }
  }

  const total = speciesSeed.lastId - speciesSeed.firstId + 1
  console.log(
    `cries ready (commit ${cries.commit.slice(0, 7)}): ${total} (${downloaded} downloaded, ${total - downloaded} already on disk)`,
  )
}

async function saveCry(url: string, file: string): Promise<number> {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return 0

  fs.mkdirSync(path.dirname(file), { recursive: true })
  let lastError: unknown

  for (let attempt = 1; attempt <= cries.maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'pocket-meadow-cries' } })
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      // Quase todos são Ogg Vorbis; o 25 vem como MP3 com extensão .ogg no
      // próprio repositório. Tudo vira MP3, que o Safari antigo também toca.
      if (!isCryAudio(bytes)) {
        throw new Error(`${url} is not cry audio`)
      }
      await toMp3(bytes, file)
      await wait(cries.requestDelayMs)
      return 1
    } catch (error) {
      lastError = error
      await wait(cries.requestDelayMs * attempt)
    }
  }

  throw lastError
}

function isCryAudio(bytes: Buffer): boolean {
  if (bytes.length < 4) return false
  if (bytes.subarray(0, 4).toString('ascii') === 'OggS') return true
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3') return true
  // Frame sync de MPEG (FF Ex …), como o 25.ogg do repositório.
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

await main()
