import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { speciesSeed } from '../src/config/seed.js'
import { sprites } from '../src/config/sprites.js'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.resolve(serverRoot, sprites.outputDir)

async function main(): Promise<void> {
  let downloaded = 0

  for (let id = speciesSeed.firstId; id <= speciesSeed.lastId; id += 1) {
    downloaded += await saveGif(`${sprites.sourceBase}/${id}.gif`, path.join(outputDir, `${id}.gif`))
    downloaded += await saveGif(`${sprites.sourceBase}/shiny/${id}.gif`, path.join(outputDir, 'shiny', `${id}.gif`))
    if ((id - speciesSeed.firstId + 1) % 25 === 0) {
      console.log(`checked ${id - speciesSeed.firstId + 1} species`)
    }
  }

  const total = (speciesSeed.lastId - speciesSeed.firstId + 1) * 2
  console.log(`sprites ready: ${total} (${downloaded} downloaded, ${total - downloaded} already on disk)`)
}

async function saveGif(url: string, file: string): Promise<number> {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return 0

  fs.mkdirSync(path.dirname(file), { recursive: true })
  let lastError: unknown

  for (let attempt = 1; attempt <= sprites.maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'pocket-meadow-sprites' } })
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (!bytes.subarray(0, 4).toString('ascii').startsWith('GIF8')) {
        throw new Error(`${url} is not a GIF`)
      }
      fs.writeFileSync(file, bytes)
      await wait(sprites.requestDelayMs)
      return 1
    } catch (error) {
      lastError = error
      await wait(sprites.requestDelayMs * attempt)
    }
  }

  throw lastError
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

await main()
