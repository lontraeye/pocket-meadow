export type Spawn = {
  speciesId: number
  weight: number
}

export type Region = {
  slug: string
  name: string
  minTrainerLevel: number
  wildLevelRange: readonly [number, number]
  spawns: readonly Spawn[]
}

export type RegionStatus = {
  slug: string
  name: string
  minTrainerLevel: number
  wildLevelRange: readonly [number, number]
  unlocked: boolean
}

// Regiões iniciais, só Geração 1–2. A tabela de spawn não sai na API.
export const regions = [
  {
    slug: 'route-1',
    name: 'Rota 1',
    minTrainerLevel: 1,
    wildLevelRange: [2, 5],
    spawns: [
      { speciesId: 16, weight: 40 }, // Pidgey
      { speciesId: 19, weight: 40 }, // Rattata
      { speciesId: 10, weight: 25 }, // Caterpie
      { speciesId: 13, weight: 25 }, // Weedle
      { speciesId: 25, weight: 5 }, // Pikachu
    ],
  },
  {
    slug: 'viridian-forest',
    name: 'Floresta Verde',
    minTrainerLevel: 3,
    wildLevelRange: [4, 9],
    spawns: [
      { speciesId: 10, weight: 30 }, // Caterpie
      { speciesId: 13, weight: 30 }, // Weedle
      { speciesId: 16, weight: 20 }, // Pidgey
      { speciesId: 43, weight: 25 }, // Oddish
      { speciesId: 69, weight: 25 }, // Bellsprout
      { speciesId: 25, weight: 8 }, // Pikachu
    ],
  },
  {
    slug: 'route-30',
    name: 'Rota 30',
    minTrainerLevel: 6,
    wildLevelRange: [8, 14],
    spawns: [
      { speciesId: 161, weight: 30 }, // Sentret
      { speciesId: 163, weight: 30 }, // Hoothoot
      { speciesId: 165, weight: 20 }, // Ledyba
      { speciesId: 167, weight: 20 }, // Spinarak
      { speciesId: 187, weight: 20 }, // Hoppip
      { speciesId: 179, weight: 6 }, // Mareep
    ],
  },
] as const satisfies readonly Region[]

export function regionBySlug(slug: string): Region | undefined {
  return regions.find((region) => region.slug === slug)
}

export function regionStatus(region: Region, trainerLevel: number): RegionStatus {
  return {
    slug: region.slug,
    name: region.name,
    minTrainerLevel: region.minTrainerLevel,
    wildLevelRange: region.wildLevelRange,
    unlocked: trainerLevel >= region.minTrainerLevel,
  }
}
