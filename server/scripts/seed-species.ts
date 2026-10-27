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
import { getJson, idFromUrl } from '../src/seed/pokeapi.js'

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

await main()
