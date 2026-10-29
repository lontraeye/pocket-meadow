import {
  chapterOpen,
  LAST_CHAPTER,
  milestoneConfigs,
  milestoneOfChapter,
  type Progress,
  type Tool,
  toolBlock,
} from './milestones.js'
import { regionBySlug } from './regions.js'

// Lugares da jornada e ligações (JORNADA.md, seção 11). Lugar = cidade, área
// (com tabela de encontro: mesmo slug da região) ou água (só pesca e Surf,
// que ainda não existem). O jogador está num lugar e anda para os vizinhos.

export type PlaceKind = 'town' | 'area' | 'water'
export type { Tool }

export type PlaceLink = { to: string; requires?: Tool }

export type PlaceConfig = {
  slug: string
  name: string
  kind: PlaceKind
  /** Capítulo em que abre (1 a 8, 9 = Liga, 10 = fim de jogo). */
  chapter: number
  /** Uma linha sobre o lugar, na tela da exploração. */
  blurb: string
  /** Posição no mapa, em grade (x para leste, y para o sul). */
  x: number
  y: number
}

export const START_PLACE = 'new-bark'

/** Nome de cada capítulo de Johto (JORNADA.md, seção 5.2). */
export const CHAPTER_TITLES: Readonly<Record<number, string>> = {
  1: 'New Bark → Violet',
  2: 'Ruínas e Azalea',
  3: 'Ilex e Goldenrod',
  4: 'Ecruteak',
  5: 'Costa e Cianwood',
  6: 'Olivine',
  7: 'Mahogany',
  8: 'Blackthorn',
  9: 'Caminho da Liga',
  10: 'Fim de jogo',
}

export const placeConfigs: readonly PlaceConfig[] = [
  // Cap. 1
  { slug: 'new-bark', name: 'New Bark', kind: 'town', chapter: 1, x: 13, y: 9, blurb: 'Cidade pequena, com cheiro de mar. Toda jornada começa aqui.' },
  { slug: 'route-29', name: 'Rota 29', kind: 'area', chapter: 1, x: 11, y: 9, blurb: 'Grama baixa e Pokémon tranquilos. Bom lugar para começar.' },
  { slug: 'route-46', name: 'Rota 46', kind: 'area', chapter: 1, x: 11, y: 7, blurb: 'Trilha de pedras que sobe para as montanhas.' },
  { slug: 'cherrygrove', name: 'Cherrygrove', kind: 'town', chapter: 1, x: 9, y: 9, blurb: 'Vila de pescadores na beira da praia.' },
  { slug: 'route-30', name: 'Rota 30', kind: 'area', chapter: 1, x: 9, y: 7, blurb: 'Mato alto e árvores frutíferas no caminho para o norte.' },
  { slug: 'route-31', name: 'Rota 31', kind: 'area', chapter: 1, x: 8, y: 5, blurb: 'Lagoas, insetos e a entrada de uma caverna escura.' },
  { slug: 'dark-cave-violet', name: 'Dark Cave (Violet)', kind: 'area', chapter: 1, x: 9, y: 4, blurb: 'Breu total. Algo se mexe nas pedras.' },
  { slug: 'violet', name: 'Violet', kind: 'town', chapter: 1, x: 6, y: 5, blurb: 'Cidade antiga, com uma torre que balança ao vento.' },
  { slug: 'sprout-tower', name: 'Sprout Tower', kind: 'area', chapter: 1, x: 6, y: 4, blurb: 'Torre de madeira com um pilar que nunca para de balançar.' },
  // Cap. 2
  { slug: 'route-32', name: 'Rota 32', kind: 'area', chapter: 2, x: 6, y: 7, blurb: 'Rota longa, cortada por um rio, que desce até uma caverna.' },
  { slug: 'ruins-of-alph', name: 'Ruins of Alph', kind: 'area', chapter: 2, x: 5, y: 6, blurb: 'Câmaras de pedra com símbolos que ninguém sabe ler.' },
  { slug: 'union-cave', name: 'Union Cave', kind: 'area', chapter: 2, x: 6, y: 9, blurb: 'Caverna úmida que liga o norte ao sul.' },
  { slug: 'route-33', name: 'Rota 33', kind: 'area', chapter: 2, x: 5, y: 10, blurb: 'Chove quase sempre por aqui.' },
  { slug: 'azalea', name: 'Azalea', kind: 'town', chapter: 2, x: 4, y: 10, blurb: 'Cidade de artesãos de bolas, cheia de Slowpoke.' },
  { slug: 'slowpoke-well', name: 'Slowpoke Well', kind: 'area', chapter: 2, x: 4, y: 11, blurb: 'Um poço fundo onde os Slowpoke se escondem.' },
  // Cap. 3
  { slug: 'ilex-forest', name: 'Ilex Forest', kind: 'area', chapter: 3, x: 2, y: 9, blurb: 'Floresta fechada, com um pequeno santuário no meio.' },
  { slug: 'route-34', name: 'Rota 34', kind: 'area', chapter: 3, x: 2, y: 7, blurb: 'Estrada movimentada, com um daycare à beira.' },
  { slug: 'goldenrod', name: 'Goldenrod', kind: 'town', chapter: 3, x: 2, y: 6, blurb: 'A maior cidade de Johto: lojas, rádio e muita gente.' },
  // Cap. 4
  { slug: 'route-35', name: 'Rota 35', kind: 'area', chapter: 4, x: 2, y: 4, blurb: 'Campo aberto ao norte da cidade grande.' },
  { slug: 'national-park', name: 'National Park', kind: 'area', chapter: 4, x: 3, y: 3, blurb: 'Gramados bem cuidados. Insetos por toda parte.' },
  { slug: 'route-36', name: 'Rota 36', kind: 'area', chapter: 4, x: 5, y: 3, blurb: 'Caminho entre o parque, Violet e as ruínas.' },
  { slug: 'ruins-of-alph-outside', name: 'Arredores das Ruínas', kind: 'area', chapter: 5, x: 4, y: 5, blurb: 'O mato em volta das ruínas guarda Pokémon raros.' },
  { slug: 'route-37', name: 'Rota 37', kind: 'area', chapter: 4, x: 5, y: 2, blurb: 'Três árvores grandes e Pokémon que só saem à noite.' },
  { slug: 'ecruteak', name: 'Ecruteak', kind: 'town', chapter: 4, x: 5, y: 1, blurb: 'Cidade de tradições, entre duas torres.' },
  { slug: 'burned-tower', name: 'Burned Tower', kind: 'area', chapter: 4, x: 4, y: 0, blurb: 'Ruína queimada. Dizem que três lendas dormiam aqui.' },
  // Cap. 5
  { slug: 'route-38', name: 'Rota 38', kind: 'area', chapter: 5, x: 3, y: 1, blurb: 'Pastos e cercas a caminho do litoral.' },
  { slug: 'route-39', name: 'Rota 39', kind: 'area', chapter: 5, x: 1, y: 1, blurb: 'Uma fazenda de Miltank na beira da estrada.' },
  { slug: 'olivine', name: 'Olivine', kind: 'town', chapter: 5, x: 1, y: 3, blurb: 'Porto com um farol que nunca pode apagar.' },
  { slug: 'sea-routes-40-41', name: 'Rotas 40 e 41', kind: 'water', chapter: 5, x: 0, y: 5, blurb: 'Mar aberto entre o porto e as ilhas.' },
  { slug: 'whirl-islands', name: 'Whirl Islands', kind: 'area', chapter: 5, x: 1, y: 6, blurb: 'Ilhas cercadas de redemoinhos.' },
  { slug: 'cianwood', name: 'Cianwood', kind: 'town', chapter: 5, x: 0, y: 7, blurb: 'Vila isolada, famosa pela farmácia.' },
  // Cap. 6
  { slug: 'route-42', name: 'Rota 42', kind: 'area', chapter: 6, x: 7, y: 1, blurb: 'Lagos entre as montanhas a leste de Ecruteak.' },
  { slug: 'mt-mortar', name: 'Mt. Mortar', kind: 'area', chapter: 6, x: 7, y: 2, blurb: 'Montanha oca, com cachoeiras por dentro.' },
  { slug: 'mahogany', name: 'Mahogany', kind: 'town', chapter: 6, x: 9, y: 1, blurb: 'Cidadezinha quieta demais para o próprio bem.' },
  // Cap. 7
  { slug: 'mt-mortar-upper', name: 'Mt. Mortar (alto)', kind: 'area', chapter: 7, x: 8, y: 2, blurb: 'O fundo da montanha, onde alguém treina sozinho.' },
  { slug: 'route-43', name: 'Rota 43', kind: 'area', chapter: 7, x: 9, y: 0, blurb: 'Trilha estreita até um lago enorme.' },
  { slug: 'lake-of-rage', name: 'Lake of Rage', kind: 'water', chapter: 7, x: 9, y: -1, blurb: 'Um lago agitado. Algo vermelho brilha na água.' },
  // Cap. 8
  { slug: 'route-44', name: 'Rota 44', kind: 'area', chapter: 8, x: 11, y: 1, blurb: 'Estrada fria a caminho do gelo.' },
  { slug: 'ice-path', name: 'Ice Path', kind: 'area', chapter: 8, x: 12, y: 1, blurb: 'Túnel de gelo escorregadio.' },
  { slug: 'blackthorn', name: 'Blackthorn', kind: 'town', chapter: 8, x: 13, y: 2, blurb: 'Cidade de domadores de dragões, ao pé da montanha.' },
  { slug: 'dragons-den', name: "Dragon's Den", kind: 'water', chapter: 8, x: 14, y: 1, blurb: 'Uma gruta sagrada com água parada.' },
  { slug: 'dark-cave-blackthorn', name: 'Dark Cave (Blackthorn)', kind: 'area', chapter: 8, x: 11, y: 4, blurb: 'O lado mais fundo da caverna escura.' },
  { slug: 'route-45', name: 'Rota 45', kind: 'area', chapter: 8, x: 13, y: 4, blurb: 'Descida íngreme de pedras.' },
  // Liga
  { slug: 'route-27', name: 'Rota 27', kind: 'area', chapter: 9, x: 15, y: 9, blurb: 'Costa e mar a leste de New Bark.' },
  { slug: 'tohjo-falls', name: 'Tohjo Falls', kind: 'area', chapter: 9, x: 16, y: 9, blurb: 'Uma cachoeira dentro da caverna.' },
  { slug: 'route-26', name: 'Rota 26', kind: 'area', chapter: 9, x: 16, y: 7, blurb: 'A subida para a Liga.' },
  { slug: 'victory-road-johto', name: 'Victory Road', kind: 'area', chapter: 9, x: 16, y: 5, blurb: 'A última caverna antes da Liga.' },
  { slug: 'indigo-plateau', name: 'Indigo Plateau', kind: 'town', chapter: 9, x: 16, y: 3, blurb: 'A sede da Liga Pokémon.' },
  { slug: 'union-cave-deep', name: 'Union Cave (fundo)', kind: 'area', chapter: 9, x: 7, y: 10, blurb: 'Um lago subterrâneo no fundo da caverna.' },
  { slug: 'slowpoke-well-deep', name: 'Slowpoke Well (fundo)', kind: 'area', chapter: 9, x: 4, y: 12, blurb: 'Água escura no fundo do poço.' },
  // Fim de jogo
  { slug: 'tin-tower', name: 'Tin Tower', kind: 'area', chapter: 10, x: 6, y: 0, blurb: 'A torre dourada onde as lendas pousam.' },
  { slug: 'route-28', name: 'Rota 28', kind: 'area', chapter: 10, x: 16, y: 2, blurb: 'Estrada esquecida até a montanha proibida.' },
  { slug: 'mt-silver', name: 'Mt. Silver', kind: 'area', chapter: 10, x: 16, y: 1, blurb: 'A montanha mais alta. Poucos chegam ao topo.' },
]

/** Ligações nos dois sentidos. `requires` vale para qualquer um dos lados. */
const linkList: readonly [string, string, Tool?][] = [
  ['new-bark', 'route-29'],
  ['new-bark', 'route-27', 'surf'],
  ['route-29', 'cherrygrove'],
  ['route-29', 'route-46'],
  ['route-46', 'route-45'],
  ['cherrygrove', 'route-30'],
  ['route-30', 'route-31'],
  ['route-31', 'violet'],
  ['route-31', 'dark-cave-violet'],
  ['violet', 'sprout-tower'],
  ['violet', 'route-32'],
  ['violet', 'route-36'],
  ['route-32', 'ruins-of-alph'],
  ['route-32', 'union-cave'],
  ['ruins-of-alph', 'ruins-of-alph-outside'],
  ['union-cave', 'route-33'],
  ['union-cave', 'union-cave-deep', 'surf'],
  ['route-33', 'azalea'],
  ['azalea', 'slowpoke-well'],
  ['azalea', 'ilex-forest'],
  ['slowpoke-well', 'slowpoke-well-deep', 'surf'],
  ['ilex-forest', 'route-34'],
  ['route-34', 'goldenrod'],
  ['goldenrod', 'route-35'],
  ['route-35', 'national-park'],
  ['national-park', 'route-36'],
  ['route-36', 'ruins-of-alph-outside'],
  ['route-36', 'route-37'],
  ['route-37', 'ecruteak'],
  ['ecruteak', 'burned-tower'],
  ['ecruteak', 'tin-tower'],
  ['ecruteak', 'route-38'],
  ['ecruteak', 'route-42'],
  ['route-38', 'route-39'],
  ['route-39', 'olivine'],
  ['olivine', 'sea-routes-40-41', 'surf'],
  ['sea-routes-40-41', 'whirl-islands', 'surf'],
  ['sea-routes-40-41', 'cianwood', 'surf'],
  ['route-42', 'mt-mortar'],
  ['route-42', 'mahogany'],
  ['mt-mortar', 'mt-mortar-upper'],
  ['mahogany', 'route-43'],
  ['mahogany', 'route-44'],
  ['route-43', 'lake-of-rage'],
  ['route-44', 'ice-path'],
  ['ice-path', 'blackthorn'],
  ['blackthorn', 'route-45'],
  ['blackthorn', 'dragons-den'],
  ['blackthorn', 'dark-cave-blackthorn'],
  ['dark-cave-blackthorn', 'dark-cave-violet', 'rockSmash'],
  ['route-27', 'tohjo-falls'],
  ['tohjo-falls', 'route-26'],
  ['route-26', 'victory-road-johto'],
  ['victory-road-johto', 'indigo-plateau'],
  ['indigo-plateau', 'route-28'],
  ['route-28', 'mt-silver'],
]

export function placeBySlug(slug: string): PlaceConfig | undefined {
  return placeConfigs.find((place) => place.slug === slug)
}

export function linksOf(slug: string): PlaceLink[] {
  const out: PlaceLink[] = []
  for (const [a, b, requires] of linkList) {
    if (a === slug) out.push(requires ? { to: b, requires } : { to: b })
    else if (b === slug) out.push(requires ? { to: a, requires } : { to: a })
  }
  return out
}

/** Por que o lugar (ou a ligação até ele) está fechado; null = aberto. */
export function lockReason(place: PlaceConfig, progress: Progress, requires?: Tool): string | null {
  if (!chapterOpen(place.chapter, progress)) {
    const gate = milestoneOfChapter(place.chapter - 1)
    return gate ? `Abre no ${gate.name}` : 'Fechado'
  }
  return requires ? toolBlock(requires, progress) : null
}

/** Confere o config no boot: slugs únicos, ligações válidas, área com tabela. */
export function checkPlaces(): void {
  const slugs = new Set<string>()
  for (const place of placeConfigs) {
    if (slugs.has(place.slug)) throw new Error(`place ${place.slug} is duplicated`)
    slugs.add(place.slug)
    if (place.chapter < 1 || place.chapter > LAST_CHAPTER) throw new Error(`place ${place.slug} has unknown chapter`)
    const region = regionBySlug(place.slug)
    if (place.kind === 'area' && !region) throw new Error(`place ${place.slug} is an area without a region`)
    if (place.kind !== 'area' && region) throw new Error(`place ${place.slug} has a region but is ${place.kind}`)
    if (region && region.chapter !== place.chapter) throw new Error(`place ${place.slug} chapter differs from its region`)
  }
  for (const [a, b] of linkList) {
    if (!slugs.has(a) || !slugs.has(b)) throw new Error(`link ${a} ↔ ${b} points to an unknown place`)
  }
  if (!slugs.has(START_PLACE)) throw new Error('start place is missing')
  for (const milestone of milestoneConfigs) {
    const town = placeBySlug(milestone.town)
    if (!town || town.kind !== 'town') throw new Error(`milestone ${milestone.key} town is not a town`)
    if (town.chapter > milestone.chapter) throw new Error(`milestone ${milestone.key} town opens after it`)
  }
}
