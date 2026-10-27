import { candyCostForStage, minLevelForStage } from '../config/evolution.js'

export type PokemonPayload = {
  id: number
  name: string
  base_experience: number
  types: { slot: number; type: { name: string } }[]
  stats: { base_stat: number; stat: { name: string } }[]
}

export type SpeciesPayload = {
  id: number
  names: { name: string; language: { name: string } }[]
  capture_rate: number
  is_legendary: boolean
  is_mythical: boolean
  evolution_chain: { url: string }
  evolves_from_species: { url: string } | null
}

export type EvolutionChainPayload = {
  id: number
  chain: EvolutionLink
}

export type EvolutionLink = {
  species: { url: string }
  evolution_details: { min_level: number | null; trigger: { name: string } }[]
  evolves_to: EvolutionLink[]
}

export type SpeciesRow = {
  id: number
  name: string
  displayName: string
  type1: string
  type2: string | null
  hp: number
  attack: number
  defense: number
  spAttack: number
  spDefense: number
  speed: number
  baseStatTotal: number
  baseExperience: number
  captureRate: number
  evolutionChainId: number
  evolvesFromId: number | null
  evolutionStage: number
  isLegendary: boolean
  isMythical: boolean
  /** EV yield da PokéAPI (stats[].effort). Default 0 até o seed-moves preencher. */
  evHp: number
  evAttack: number
  evDefense: number
  evSpAttack: number
  evSpDefense: number
  evSpeed: number
}

export type EvolutionRow = {
  fromSpeciesId: number
  toSpeciesId: number
  minLevel: number
  candyCost: number
  viaTrade: boolean
}

export type ParsedSpeciesSeed = {
  species: SpeciesRow[]
  evolutions: EvolutionRow[]
  defaultMinLevelCount: number
}

const statNames = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'] as const

export function parseSpeciesSeed(
  pokemon: PokemonPayload[],
  speciesPayloads: SpeciesPayload[],
  chains: EvolutionChainPayload[],
  range: { firstId: number; lastId: number },
): ParsedSpeciesSeed {
  const inRange = (id: number) => id >= range.firstId && id <= range.lastId
  const pokemonById = new Map(pokemon.map((entry) => [entry.id, entry]))
  const speciesById = new Map(speciesPayloads.map((entry) => [entry.id, entry]))
  const expectedIds = range.lastId - range.firstId + 1
  if (pokemonById.size !== expectedIds || speciesById.size !== expectedIds) {
    throw new Error(`expected ${expectedIds} species, got ${pokemonById.size} pokemon and ${speciesById.size} species`)
  }

  const stageById = new Map<number, number>()
  const chainById = new Map<number, number>()
  const evolvesFromById = new Map<number, number | null>()
  const evolutions: EvolutionRow[] = []
  let defaultMinLevelCount = 0

  for (const chain of chains) {
    walk(chain.chain, chain.id, 1, null)
  }

  function walk(link: EvolutionLink, chainId: number, stage: number, parentId: number | null) {
    const id = idFromUrl(link.species.url)
    if (inRange(id)) {
      if (stageById.has(id)) {
        throw new Error(`species ${id} appears in more than one evolution chain`)
      }
      stageById.set(id, stage)
      chainById.set(id, chainId)
      evolvesFromById.set(id, parentId !== null && inRange(parentId) ? parentId : null)
    }

    for (const child of link.evolves_to) {
      const childId = idFromUrl(child.species.url)
      const childStage = stage + 1
      if (inRange(id) && inRange(childId)) {
        const fromApi = child.evolution_details.find((detail) => detail.min_level !== null)?.min_level
        const minLevel = fromApi ?? minLevelForStage(childStage)
        if (fromApi === undefined) defaultMinLevelCount += 1
        const viaTrade = child.evolution_details.some((detail) => detail.trigger.name === 'trade')
        evolutions.push({
          fromSpeciesId: id,
          toSpeciesId: childId,
          minLevel,
          candyCost: candyCostForStage(childStage),
          viaTrade,
        })
      }
      walk(child, chainId, childStage, id)
    }
  }

  const species: SpeciesRow[] = []
  for (let id = range.firstId; id <= range.lastId; id += 1) {
    const monster = pokemonById.get(id)
    const details = speciesById.get(id)
    if (!monster || !details) throw new Error(`missing payload for species ${id}`)
    if (!stageById.has(id) || !chainById.has(id)) {
      throw new Error(`species ${id} is missing from its evolution chain`)
    }

    const evolvesFromUrl = details.evolves_from_species?.url
    const evolvesFromPayload = evolvesFromUrl ? idFromUrl(evolvesFromUrl) : null
    const evolvesFromChain = evolvesFromById.get(id) ?? null
    const comparablePayload = evolvesFromPayload !== null && inRange(evolvesFromPayload) ? evolvesFromPayload : null
    if (comparablePayload !== evolvesFromChain) {
      throw new Error(`species ${id} evolves_from mismatch: payload ${comparablePayload}, chain ${evolvesFromChain}`)
    }

    const types = [...monster.types].sort((a, b) => a.slot - b.slot)
    const type1 = types[0]?.type.name
    if (!type1) throw new Error(`species ${id} has no type`)
    const stats = Object.fromEntries(statNames.map((name) => [name, stat(monster, name)])) as Record<
      (typeof statNames)[number],
      number
    >

    const baseExperience = monster.base_experience
    if (!Number.isInteger(baseExperience) || baseExperience <= 0) {
      throw new Error(`species ${id} has invalid base_experience`)
    }

    species.push({
      id,
      name: monster.name,
      displayName: englishName(details),
      type1,
      type2: types[1]?.type.name ?? null,
      hp: stats.hp,
      attack: stats.attack,
      defense: stats.defense,
      spAttack: stats['special-attack'],
      spDefense: stats['special-defense'],
      speed: stats.speed,
      baseStatTotal: statNames.reduce((sum, name) => sum + stats[name], 0),
      baseExperience,
      captureRate: details.capture_rate,
      evolutionChainId: chainById.get(id)!,
      evolvesFromId: evolvesFromChain,
      evolutionStage: stageById.get(id)!,
      isLegendary: details.is_legendary,
      isMythical: details.is_mythical,
      evHp: 0,
      evAttack: 0,
      evDefense: 0,
      evSpAttack: 0,
      evSpDefense: 0,
      evSpeed: 0,
    })
  }

  return { species, evolutions, defaultMinLevelCount }
}

function englishName(details: SpeciesPayload): string {
  const english = details.names.find((entry) => entry.language.name === 'en')?.name
  if (!english) throw new Error(`species ${details.id} has no English name`)
  return english
}

function stat(monster: PokemonPayload, name: string): number {
  const value = monster.stats.find((entry) => entry.stat.name === name)?.base_stat
  if (value === undefined) throw new Error(`species ${monster.id} is missing ${name}`)
  return value
}

function idFromUrl(url: string): number {
  const match = url.match(/\/(\d+)\/?$/)
  if (!match) throw new Error(`could not read an id from ${url}`)
  return Number(match[1])
}
