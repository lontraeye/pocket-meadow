import { chapterOpen, type Progress } from './milestones.js'
import {
  FIELD_METHODS,
  type FieldMethod,
  readRegionsSnapshot,
  type RegionSlot,
  type RegionSource,
} from '../seed/regionTable.js'

export type { FieldMethod, RegionSource }
export { FIELD_METHODS }

export type GameRegion = 'kanto' | 'johto'

export type RegionConfig = {
  slug: string
  name: string
  gameRegion: GameRegion
  /** Capítulo da jornada (JORNADA.md, seção 5): 1 a 8, 9 = Liga, 10 = fim de jogo. */
  chapter?: number
  minTrainerLevel: number
  /** Uma ou mais tabelas da PokéAPI; com mais de uma, vale a média (JORNADA.md, seção 3). */
  sources: readonly RegionSource[]
  levelOverride?: readonly [number, number]
  exclude?: readonly number[]
}

export type Region = {
  slug: string
  name: string
  gameRegion: GameRegion
  chapter: number | null
  minTrainerLevel: number
  sources: readonly RegionSource[]
  /** Mato (vazio em lugar só de água). */
  slots: readonly RegionSlot[]
  /** Pesca, Surf, árvores e pedras: só os métodos que a área tem. */
  methods: Readonly<Partial<Record<FieldMethod, readonly RegionSlot[]>>>
  wildLevelRange: readonly [number, number]
}

export type RegionStatus = {
  slug: string
  name: string
  gameRegion: GameRegion
  chapter: number | null
  minTrainerLevel: number
  wildLevelRange: readonly [number, number]
  unlocked: boolean
}

function crystal(...areas: string[]): RegionSource[] {
  return areas.map((area) => ({ area, version: 'crystal' }))
}

// Em Johto, a área abre com o capítulo (marcos), não por nível.
function johto(slug: string, name: string, chapter: number, sources: RegionSource[]): RegionConfig {
  return { slug, name, gameRegion: 'johto', chapter, minTrainerLevel: 1, sources }
}

// Áreas jogáveis. Kanto e Johto são gameRegion. A tabela de slots fica no
// snapshot e não sai na API. Padrão: Yellow em Kanto, Crystal em Johto.
// A ordem de Johto segue os capítulos do JORNADA.md (seção 5.2).
export const regionConfigs: readonly RegionConfig[] = [
  {
    slug: 'route-1',
    name: 'Rota 1',
    gameRegion: 'kanto',
    minTrainerLevel: 1,
    sources: [{ area: 'kanto-route-1-area', version: 'yellow' }],
  },
  {
    slug: 'viridian-forest',
    name: 'Floresta Verde',
    gameRegion: 'kanto',
    minTrainerLevel: 3,
    // Yellow não tem Pikachu na Floresta Verde; no Red ele sai a 5%.
    sources: [{ area: 'viridian-forest-area', version: 'red' }],
  },
  {
    slug: 'mt-moon',
    name: 'Mt. Moon',
    gameRegion: 'kanto',
    minTrainerLevel: 6,
    sources: [{ area: 'mt-moon-1f', version: 'yellow' }],
  },

  // Cap. 1 — New Bark → Violet
  johto('route-29', 'Rota 29', 1, crystal('johto-route-29-area')),
  johto('route-46', 'Rota 46', 1, crystal('johto-route-46-area')),
  johto('route-30', 'Rota 30', 1, crystal('johto-route-30-area')),
  johto('route-31', 'Rota 31', 1, crystal('johto-route-31-area')),
  johto('sprout-tower', 'Sprout Tower', 1, crystal('sprout-tower-2f')),
  johto('dark-cave-violet', 'Dark Cave (Violet)', 1, crystal('dark-cave-violet-city-entrance')),
  // Cap. 2 — Ruínas e Azalea
  // Crystal + Gold: o Crystal não tem Mareep andando, e o Gold não tem Ekans.
  johto('route-32', 'Rota 32', 2, [...crystal('johto-route-32-area'), { area: 'johto-route-32-area', version: 'gold' }]),
  johto('ruins-of-alph', 'Ruins of Alph', 2, crystal('ruins-of-alph-interior-a')),
  johto('union-cave', 'Union Cave', 2, crystal('union-cave-1f', 'union-cave-b1f')),
  johto('slowpoke-well', 'Slowpoke Well', 2, crystal('slowpoke-well-1f')),
  johto('route-33', 'Rota 33', 2, crystal('johto-route-33-area')),
  // Cap. 3 — Ilex e Goldenrod
  johto('ilex-forest', 'Ilex Forest', 3, crystal('ilex-forest-area')),
  johto('route-34', 'Rota 34', 3, crystal('johto-route-34-area')),
  // Cap. 4 — Ecruteak
  johto('route-35', 'Rota 35', 4, crystal('johto-route-35-area')),
  johto('national-park', 'National Park', 4, crystal('national-park-area')),
  johto('route-36', 'Rota 36', 4, crystal('johto-route-36-area')),
  johto('route-37', 'Rota 37', 4, crystal('johto-route-37-area')),
  johto('burned-tower', 'Burned Tower', 4, crystal('burned-tower-1f', 'burned-tower-b1f')),
  // Cap. 5 — Costa e Cianwood
  johto('route-38', 'Rota 38', 5, crystal('johto-route-38-area')),
  johto('route-39', 'Rota 39', 5, crystal('johto-route-39-area')),
  johto('ruins-of-alph-outside', 'Arredores das Ruínas', 5, crystal('ruins-of-alph-outside')),
  // Mar: sem mato, só pesca e Surf.
  johto('sea-routes-40-41', 'Rotas 40 e 41', 5, crystal('johto-sea-route-40-area', 'johto-sea-route-41-area')),
  johto(
    'whirl-islands',
    'Whirl Islands',
    5,
    crystal('whirl-islands-1f', 'whirl-islands-b1f', 'whirl-islands-b2f', 'whirl-islands-b3f'),
  ),
  // Cap. 6 — Olivine
  johto('route-42', 'Rota 42', 6, crystal('johto-route-42-area')),
  johto('mt-mortar', 'Mt. Mortar', 6, crystal('mt-mortar-1f', 'mt-mortar-lower-cave', 'mt-mortar-b1f')),
  // Cap. 7 — Mahogany
  // Crystal + Gold: o Crystal não tem Girafarig nem Flaaffy, e o Gold não tem Farfetch'd.
  johto('route-43', 'Rota 43', 7, [...crystal('johto-route-43-area'), { area: 'johto-route-43-area', version: 'gold' }]),
  johto('mt-mortar-upper', 'Mt. Mortar (alto)', 7, crystal('mt-mortar-upper-cave')),
  johto('lake-of-rage', 'Lake of Rage', 7, crystal('lake-of-rage-area')),
  // Cap. 8 — Blackthorn
  johto('ice-path', 'Ice Path', 8, crystal('ice-path-1f', 'ice-path-b1f', 'ice-path-b2f', 'ice-path-b3f')),
  johto('dark-cave-blackthorn', 'Dark Cave (Blackthorn)', 8, crystal('dark-cave-blackthorn-city-entrance')),
  johto('route-44', 'Rota 44', 8, crystal('johto-route-44-area')),
  johto('route-45', 'Rota 45', 8, crystal('johto-route-45-area')),
  johto('dragons-den', "Dragon's Den", 8, crystal('dragons-den-area')),
  // Liga — caminho da Liga (as Rotas 26/27 e a Victory Road são "kanto" na PokéAPI)
  johto('route-26', 'Rota 26', 9, crystal('kanto-route-26-area')),
  johto('route-27', 'Rota 27', 9, crystal('kanto-route-27-area')),
  johto('tohjo-falls', 'Tohjo Falls', 9, crystal('tohjo-falls-area')),
  johto('victory-road-johto', 'Victory Road', 9, crystal('kanto-victory-road-1-1f')),
  johto('union-cave-deep', 'Union Cave (fundo)', 9, crystal('union-cave-b2f')),
  johto('slowpoke-well-deep', 'Slowpoke Well (fundo)', 9, crystal('slowpoke-well-b1f')),
  // Fim de jogo
  johto('tin-tower', 'Tin Tower', 10, crystal('bell-tower-2f')),
  johto('route-28', 'Rota 28', 10, crystal('kanto-route-28-area')),
  johto('mt-silver', 'Mt. Silver', 10, crystal('mt-silver-outside', 'mt-silver-1f', 'mt-silver-2f', 'mt-silver-top')),
]

let cached: readonly Region[] | undefined

function wildLevelRange(slots: readonly RegionSlot[]): readonly [number, number] {
  const first = slots[0]
  if (!first) throw new Error('region has no slots')
  let min = first.minLevel
  let max = first.maxLevel
  for (const slot of slots) {
    if (slot.minLevel < min) min = slot.minLevel
    if (slot.maxLevel > max) max = slot.maxLevel
  }
  return [min, max]
}

function sourcesKey(sources: readonly RegionSource[]): string {
  return sources.map((source) => `${source.area}/${source.version}`).join(' + ')
}

/**
 * Área com mato: a água do campo é só uma poça, então dá para pescar, mas não
 * surfar. O Surf fica para os lugares só de água (rotas do mar, lagos).
 */
function landMethods(
  slots: readonly RegionSlot[],
  methods: Readonly<Partial<Record<FieldMethod, readonly RegionSlot[]>>>,
): Readonly<Partial<Record<FieldMethod, readonly RegionSlot[]>>> {
  if (slots.length === 0 || !methods.surf) return methods
  const { surf: _surf, ...rest } = methods
  return rest
}

function assembleRegions(): readonly Region[] {
  const snapshot = readRegionsSnapshot()
  const slugs = new Set<string>()
  return regionConfigs.map((config) => {
    if (slugs.has(config.slug)) throw new Error(`region ${config.slug} is duplicated in the config`)
    slugs.add(config.slug)
    const entry = snapshot[config.slug]
    const methods = entry?.methods ?? {}
    const any = (entry?.slots.length ?? 0) + Object.values(methods).reduce((sum, slots) => sum + slots.length, 0)
    if (!entry || !Array.isArray(entry.slots) || any === 0 || !Array.isArray(entry.sources)) {
      throw new Error(`region ${config.slug} is missing from snapshots/regions.json; run npm run seed:regions`)
    }
    if (sourcesKey(entry.sources) !== sourcesKey(config.sources)) {
      throw new Error(
        `region ${config.slug} snapshot is ${sourcesKey(entry.sources)}, config wants ${sourcesKey(config.sources)}; run npm run seed:regions`,
      )
    }
    return {
      slug: config.slug,
      name: config.name,
      gameRegion: config.gameRegion,
      chapter: config.chapter ?? null,
      minTrainerLevel: config.minTrainerLevel,
      sources: config.sources,
      slots: entry.slots,
      methods: landMethods(entry.slots, methods),
      // Nível do mato; no lugar só de água, de tudo.
      wildLevelRange: wildLevelRange(entry.slots.length > 0 ? entry.slots : Object.values(methods).flat()),
    }
  })
}

// Falha no boot se o snapshot não cobrir o config.
export function loadRegions(): readonly Region[] {
  if (!cached) cached = assembleRegions()
  return cached
}

export function regionBySlug(slug: string): Region | undefined {
  return loadRegions().find((region) => region.slug === slug)
}

/** Maior nível do mato em cada capítulo: teto dos métodos (a Super Vara dá nível 40 no jogo original). */
function chapterCaps(): Map<number, number> {
  const caps = new Map<number, number>()
  for (const region of loadRegions()) {
    if (region.chapter === null || region.slots.length === 0) continue
    const max = Math.max(...region.slots.map((slot) => slot.maxLevel))
    caps.set(region.chapter, Math.max(caps.get(region.chapter) ?? 0, max))
  }
  return caps
}

let caps: Map<number, number> | undefined

/**
 * Tabela de um método na área, com o nível limitado ao do capítulo: pescar
 * não pode dar um Pokémon muito acima do mato em volta. Sem o método: [].
 */
export function methodSlots(region: Region, method: FieldMethod): readonly RegionSlot[] {
  const slots = region.methods[method] ?? []
  caps ??= chapterCaps()
  const cap = region.chapter !== null ? caps.get(region.chapter) : undefined
  if (cap === undefined) return slots
  return slots.map((slot) =>
    slot.maxLevel <= cap ? slot : { ...slot, minLevel: Math.min(slot.minLevel, cap), maxLevel: cap },
  )
}

/** Espécies da área por qualquer método (mato, água, árvore, pedra), sem repetir. */
export function regionSpecies(region: Region): number[] {
  const ids = new Set(region.slots.map((slot) => slot.speciesId))
  for (const slots of Object.values(region.methods)) for (const slot of slots) ids.add(slot.speciesId)
  return [...ids]
}

/** Área com capítulo abre pelos marcos; sem capítulo (Kanto, por enquanto), pelo nível. */
export function regionOpen(region: Region, progress: Progress): boolean {
  return region.chapter !== null ? chapterOpen(region.chapter, progress) : progress.level >= region.minTrainerLevel
}

export function regionStatus(region: Region, progress: Progress): RegionStatus {
  return {
    slug: region.slug,
    name: region.name,
    gameRegion: region.gameRegion,
    chapter: region.chapter,
    minTrainerLevel: region.minTrainerLevel,
    wildLevelRange: region.wildLevelRange,
    unlocked: regionOpen(region, progress),
  }
}
