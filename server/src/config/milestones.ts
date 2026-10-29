// Marcos de Johto (JORNADA.md, seção 6): um por capítulo. Cada marco fecha o
// capítulo dele e abre o seguinte. Por enquanto pede só o nível de treinador
// (as missões entram depois) e é resgatado na cidade do marco. A luta contra
// o líder entra numa parte depois, sem mudar o resto.

import { type PokemonType, typeDisplayNamePt } from './types.js'

// Ferramentas (JORNADA.md, seção 4): o marco libera; usar pede um Pokémon do
// tipo certo no time (Surf, Voo e Rock Smash). As varas são uma só que
// melhora: vale a melhor que o jogador tem.
export type Tool = 'oldRod' | 'goodRod' | 'superRod' | 'headbutt' | 'surf' | 'rockSmash' | 'fly'

export type MilestoneConfig = {
  key: string
  /** Capítulo que o marco fecha (o seguinte abre). */
  chapter: number
  /** Cidade onde se resgata (slug do lugar). */
  town: string
  name: string
  /** Tipo do ginásio, só para o texto. */
  typeLabel: string
  minLevel: number
  /** Ferramentas que o marco libera. */
  grants?: readonly Tool[]
}

export const milestoneConfigs: readonly MilestoneConfig[] = [
  { key: 'violet', chapter: 1, town: 'violet', name: 'Marco de Violet', typeLabel: 'Voador', minLevel: 3 },
  {
    key: 'azalea',
    chapter: 2,
    town: 'azalea',
    name: 'Marco de Azalea',
    typeLabel: 'Inseto',
    minLevel: 6,
    grants: ['oldRod', 'headbutt'],
  },
  { key: 'goldenrod', chapter: 3, town: 'goldenrod', name: 'Marco de Goldenrod', typeLabel: 'Normal', minLevel: 9 },
  {
    key: 'ecruteak',
    chapter: 4,
    town: 'ecruteak',
    name: 'Marco de Ecruteak',
    typeLabel: 'Fantasma',
    minLevel: 12,
    grants: ['surf', 'rockSmash'],
  },
  {
    key: 'cianwood',
    chapter: 5,
    town: 'cianwood',
    name: 'Marco de Cianwood',
    typeLabel: 'Lutador',
    minLevel: 15,
    grants: ['goodRod', 'fly'],
  },
  { key: 'olivine', chapter: 6, town: 'olivine', name: 'Marco de Olivine', typeLabel: 'Aço', minLevel: 18 },
  { key: 'mahogany', chapter: 7, town: 'mahogany', name: 'Marco de Mahogany', typeLabel: 'Gelo', minLevel: 21 },
  {
    key: 'blackthorn',
    chapter: 8,
    town: 'blackthorn',
    name: 'Marco de Blackthorn',
    typeLabel: 'Dragão',
    minLevel: 24,
    grants: ['superRod'],
  },
  { key: 'league', chapter: 9, town: 'indigo-plateau', name: 'Liga de Johto', typeLabel: 'Liga', minLevel: 30 },
]

/** Capítulos que existem: 1 a 9 fecham com marco; o 10 (fim de jogo) abre com a Liga. */
export const LAST_CHAPTER = 10

export const TOOL_NAMES: Readonly<Record<Tool, string>> = {
  oldRod: 'Vara Velha',
  goodRod: 'Vara Boa',
  superRod: 'Super Vara',
  headbutt: 'Headbutt',
  surf: 'Surf',
  rockSmash: 'Rock Smash',
  fly: 'Voo',
}

/** Tipos que servem para usar a ferramenta (um deles no time). Sem entrada: não pede Pokémon. */
export const TOOL_TYPES: Readonly<Partial<Record<Tool, readonly PokemonType[]>>> = {
  surf: ['water'],
  fly: ['flying'],
  rockSmash: ['fighting', 'rock', 'ground'],
}

/** Da pior para a melhor; vale a melhor liberada. */
export const RODS = ['oldRod', 'goodRod', 'superRod'] as const satisfies readonly Tool[]

export function milestoneByKey(key: string): MilestoneConfig | undefined {
  return milestoneConfigs.find((milestone) => milestone.key === key)
}

export function milestoneOfChapter(chapter: number): MilestoneConfig | undefined {
  return milestoneConfigs.find((milestone) => milestone.chapter === chapter)
}

/** O que o jogador já conquistou (e os tipos do time), para decidir o que está aberto. */
export type Progress = { level: number; cleared: ReadonlySet<string>; teamTypes: ReadonlySet<string> }

/** O capítulo 1 sempre; os outros, quando o marco do anterior foi conquistado. */
export function chapterOpen(chapter: number, progress: Progress): boolean {
  if (chapter <= 1) return true
  const previous = milestoneOfChapter(chapter - 1)
  return previous !== undefined && progress.cleared.has(previous.key)
}

/** Ferramenta ganha (marco conquistado), com ou sem o Pokémon para usar. */
export function toolOpen(tool: Tool, progress: Progress): boolean {
  return milestoneConfigs.some((milestone) => milestone.grants?.includes(tool) && progress.cleared.has(milestone.key))
}

/** Por que a ferramenta não dá para usar agora; null = dá. */
export function toolBlock(tool: Tool, progress: Progress): string | null {
  const name = TOOL_NAMES[tool]
  if (!toolOpen(tool, progress)) {
    const gate = milestoneConfigs.find((milestone) => milestone.grants?.includes(tool))
    return gate ? `${name} abre no ${gate.name}` : `Sem ${name}`
  }
  const types = TOOL_TYPES[tool]
  if (types && !types.some((type) => progress.teamTypes.has(type))) {
    const labels = types.map((type) => typeDisplayNamePt[type])
    const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} ou ${labels.at(-1)}` : labels[0]
    return `${name}: precisa de um Pokémon do tipo ${list} no time`
  }
  return null
}

/** A melhor vara liberada (vara não pede Pokémon). */
export function bestRod(progress: Progress): (typeof RODS)[number] | null {
  return [...RODS].reverse().find((rod) => toolOpen(rod, progress)) ?? null
}

/** O maior capítulo aberto. */
export function currentChapter(progress: Progress): number {
  let chapter = 1
  while (chapter < LAST_CHAPTER && chapterOpen(chapter + 1, progress)) chapter += 1
  return chapter
}
