import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { speciesSeed } from '../src/config/seed.js'
import { openDatabase } from '../src/db/client.js'
import { applySpeciesSnapshot, writeSpeciesSnapshot } from '../src/seed/apply.js'
import {
  type EvolutionChainPayload,
  type ParsedSpeciesSeed,
  type PokemonPayload,
  type SpeciesPayload,
  parseSpeciesSeed,
} from '../src/seed/parse.js'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(serverRoot, speciesSeed.cacheDir)

async function main(): Promise<void> {
  const pokemon: PokemonPayload[] = []
  const speciesPayloads: SpeciesPayload[] = []
  const chainIds = new Set<number>()

  for (let id = speciesSeed.firstId; id <= speciesSeed.lastId; id += 1) {
    const monster = await getJson<PokemonPayload & { id: number }>(`/pokemon/${id}`)
    const details = await getJson<SpeciesPayload>(`/pokemon-species/${id}`)
    pokemon.push({ ...monster, id })
    speciesPayloads.push({ ...details, id })
    chainIds.add(idFromUrl(details.evolution_chain.url))
    if ((id - speciesSeed.firstId + 1) % 25 === 0) {
      console.log(`fetched ${id - speciesSeed.firstId + 1} species`)
    }
  }

  const chains: EvolutionChainPayload[] = []
  for (const chainId of chainIds) {
    chains.push(await getJson<EvolutionChainPayload>(`/evolution-chain/${chainId}`))
  }
  console.log(`fetched ${chains.length} evolution chains`)

  const parsed = parseSpeciesSeed(pokemon, speciesPayloads, chains, speciesSeed)
  writeSeed(parsed)
  console.log(
    `seeded ${parsed.species.length} species and ${parsed.evolutions.length} evolutions (${parsed.defaultMinLevelCount} used the default min level)`,
  )
}

function writeSeed(parsed: ParsedSpeciesSeed): void {
  const snapshot = { species: parsed.species, evolutions: parsed.evolutions }
  writeSpeciesSnapshot(snapshot)
  const sqlite = openDatabase()
  applySpeciesSnapshot(sqlite, snapshot)
  sqlite.close()
}

async function getJson<T>(resource: string): Promise<T> {
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

function idFromUrl(url: string): number {
  const match = url.match(/\/(\d+)\/?$/)
  if (!match) throw new Error(`could not read an id from ${url}`)
  return Number(match[1])
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

await main()
