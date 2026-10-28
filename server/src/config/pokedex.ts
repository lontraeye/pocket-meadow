import { loadRegions } from './regions.js'
import { speciesSeed } from './seed.js'
import { readSpeciesSnapshot } from '../seed/apply.js'

/** Marcos, raridade e recompensas do álbum (PLANNING.md, seção 5.12). */
export const pokedexConfig = {
  firstId: speciesSeed.firstId,
  lastId: speciesSeed.lastId,
  /** Nível máximo já alcançado para liberar "onde encontrar". */
  milestoneLocations: 15,
  /** Nível máximo já alcançado para liberar golpes e atributos base. */
  milestoneMoves: 30,
  /**
   * Raridade pela fração do peso do slot no total da região.
   * `fraction <= rare` → raro; `<= uncommon` → incomum; senão comum.
   */
  rarity: {
    rareMax: 0.03,
    uncommonMax: 0.12,
  },
  /**
   * Versão embutida nas chaves dos blocos.
   * v2: blocos de jogo/linha só com espécies obtíveis (sem lendários, iniciais, troca…).
   */
  albumVersion: 2,
  rewards: {
    region: {
      items: [{ itemKey: 'seed:oran', quantity: 2 }],
      genericCandies: 1,
      energy: 1,
    },
    chain: {
      items: [{ itemKey: 'seed:pinap', quantity: 1 }],
      genericCandies: 3,
      energy: 0,
    },
    game: {
      items: [
        { itemKey: 'seed:oran', quantity: 5 },
        { itemKey: 'seed:pinap', quantity: 2 },
      ],
      genericCandies: 10,
      energy: 3,
    },
  },
} as const

export type PokedexReward = {
  items: readonly { itemKey: string; quantity: number }[]
  genericCandies: number
  energy: number
}

export type AlbumBlockKind = 'region' | 'chain' | 'game'

export type AlbumBlockDef = {
  key: string
  kind: AlbumBlockKind
  title: string
  speciesIds: readonly number[]
  reward: PokedexReward
}

export type RarityBand = 'common' | 'uncommon' | 'rare'

export function rarityBand(fraction: number): RarityBand {
  if (fraction <= pokedexConfig.rarity.rareMax) return 'rare'
  if (fraction <= pokedexConfig.rarity.uncommonMax) return 'uncommon'
  return 'common'
}

function versioned(base: string): string {
  return `${base}:v${pokedexConfig.albumVersion}`
}

/**
 * Espécie obtível: aparece em regions.json, ou evolui (sem troca) de uma obtível.
 * Calculado dos dados; sem lista fixa de nomes.
 */
export function obtainableSpeciesIds(): Set<number> {
  const wild = new Set<number>()
  for (const region of loadRegions()) {
    for (const slot of region.slots) wild.add(slot.speciesId)
  }
  const obtainable = new Set(wild)
  const edges = readSpeciesSnapshot()
    .evolutions.filter((row) => !row.viaTrade)
    .map((row) => ({ from: row.fromSpeciesId, to: row.toSpeciesId }))
  let grew = true
  while (grew) {
    grew = false
    for (const edge of edges) {
      if (obtainable.has(edge.from) && !obtainable.has(edge.to)) {
        obtainable.add(edge.to)
        grew = true
      }
    }
  }
  return obtainable
}

/** Blocos do álbum derivados de regiões e linhas evolutivas. */
export function albumBlocks(input: {
  chains: readonly { chainId: number; speciesIds: number[]; title: string }[]
  obtainable: ReadonlySet<number>
}): readonly AlbumBlockDef[] {
  const blocks: AlbumBlockDef[] = []
  for (const region of loadRegions()) {
    const ids = [...new Set(region.slots.map((slot) => slot.speciesId))].sort((a, b) => a - b)
    blocks.push({
      key: versioned(`region:${region.slug}`),
      kind: 'region',
      title: region.name,
      speciesIds: ids,
      reward: pokedexConfig.rewards.region,
    })
  }
  for (const chain of input.chains) {
    if (chain.speciesIds.length < 2) continue
    if (!chain.speciesIds.every((id) => input.obtainable.has(id))) continue
    blocks.push({
      key: versioned(`chain:${chain.chainId}`),
      kind: 'chain',
      title: chain.title,
      speciesIds: chain.speciesIds,
      reward: pokedexConfig.rewards.chain,
    })
  }
  const kanto: number[] = []
  const johto: number[] = []
  for (const id of [...input.obtainable].sort((a, b) => a - b)) {
    if (id < pokedexConfig.firstId || id > pokedexConfig.lastId) continue
    if (id <= 151) kanto.push(id)
    else johto.push(id)
  }
  blocks.push({
    key: versioned('game:kanto'),
    kind: 'game',
    title: 'Kanto',
    speciesIds: kanto,
    reward: pokedexConfig.rewards.game,
  })
  blocks.push({
    key: versioned('game:johto'),
    kind: 'game',
    title: 'Johto',
    speciesIds: johto,
    reward: pokedexConfig.rewards.game,
  })
  return blocks
}
