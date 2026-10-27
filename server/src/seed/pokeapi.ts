import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { speciesSeed } from '../config/seed.js'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cacheDir = path.join(serverRoot, speciesSeed.cacheDir)

// Cache em disco, atraso e retentativas compartilhados pelos scripts de seed.
export async function getJson<T>(resource: string): Promise<T> {
  const file = path.join(cacheDir, `${resource.replaceAll('/', '_').replace(/^_/, '')}.json`)
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  }

  fs.mkdirSync(cacheDir, { recursive: true })
  const url = `${speciesSeed.apiBase}${resource}`
  let lastError: unknown

  for (let attempt = 1; attempt <= speciesSeed.maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'pocket-meadow-seed' } })
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      const text = await response.text()
      fs.writeFileSync(file, text)
      await wait(speciesSeed.requestDelayMs)
      return JSON.parse(text) as T
    } catch (error) {
      lastError = error
      await wait(speciesSeed.requestDelayMs * attempt)
    }
  }

  throw lastError
}

export function idFromUrl(url: string): number {
  const match = url.match(/\/(\d+)\/?$/)
  if (!match) throw new Error(`could not read an id from ${url}`)
  return Number(match[1])
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
