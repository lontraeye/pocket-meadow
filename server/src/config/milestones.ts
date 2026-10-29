// Marcos de Johto (JORNADA.md, seção 6): um por capítulo. Cada marco fecha o
// capítulo dele e abre o seguinte. Pede um nível de treinador e um número de
// espécies do capítulo capturadas, e é resgatado na cidade do marco. A luta
// contra o líder entra numa parte depois, sem mudar o resto.

export type Tool = 'surf' | 'fly'

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
  /** Espécies das áreas do capítulo, capturadas. */
  species: number
  /** Ferramentas que o marco libera. */
  grants?: readonly Tool[]
}

export const milestoneConfigs: readonly MilestoneConfig[] = [
  { key: 'violet', chapter: 1, town: 'violet', name: 'Marco de Violet', typeLabel: 'Voador', minLevel: 3, species: 6 },
  { key: 'azalea', chapter: 2, town: 'azalea', name: 'Marco de Azalea', typeLabel: 'Inseto', minLevel: 6, species: 8 },
  { key: 'goldenrod', chapter: 3, town: 'goldenrod', name: 'Marco de Goldenrod', typeLabel: 'Normal', minLevel: 9, species: 8 },
  {
    key: 'ecruteak',
    chapter: 4,
    town: 'ecruteak',
    name: 'Marco de Ecruteak',
    typeLabel: 'Fantasma',
    minLevel: 12,
    species: 12,
    grants: ['surf'],
  },
  {
    key: 'cianwood',
    chapter: 5,
    town: 'cianwood',
    name: 'Marco de Cianwood',
    typeLabel: 'Lutador',
    minLevel: 15,
    species: 6,
    grants: ['fly'],
  },
  { key: 'olivine', chapter: 6, town: 'olivine', name: 'Marco de Olivine', typeLabel: 'Aço', minLevel: 18, species: 6 },
  { key: 'mahogany', chapter: 7, town: 'mahogany', name: 'Marco de Mahogany', typeLabel: 'Gelo', minLevel: 21, species: 8 },
  { key: 'blackthorn', chapter: 8, town: 'blackthorn', name: 'Marco de Blackthorn', typeLabel: 'Dragão', minLevel: 24, species: 10 },
  { key: 'league', chapter: 9, town: 'indigo-plateau', name: 'Liga de Johto', typeLabel: 'Liga', minLevel: 30, species: 8 },
]

/** Capítulos que existem: 1 a 9 fecham com marco; o 10 (fim de jogo) abre com a Liga. */
export const LAST_CHAPTER = 10

export const TOOL_NAMES: Readonly<Record<Tool, string>> = { surf: 'Surf', fly: 'Voo' }

export function milestoneByKey(key: string): MilestoneConfig | undefined {
  return milestoneConfigs.find((milestone) => milestone.key === key)
}

export function milestoneOfChapter(chapter: number): MilestoneConfig | undefined {
  return milestoneConfigs.find((milestone) => milestone.chapter === chapter)
}

/** O que o jogador já conquistou, para decidir o que está aberto. */
export type Progress = { level: number; cleared: ReadonlySet<string> }

/** O capítulo 1 sempre; os outros, quando o marco do anterior foi conquistado. */
export function chapterOpen(chapter: number, progress: Progress): boolean {
  if (chapter <= 1) return true
  const previous = milestoneOfChapter(chapter - 1)
  return previous !== undefined && progress.cleared.has(previous.key)
}

export function toolOpen(tool: Tool, progress: Progress): boolean {
  return milestoneConfigs.some((milestone) => milestone.grants?.includes(tool) && progress.cleared.has(milestone.key))
}

/** O maior capítulo aberto. */
export function currentChapter(progress: Progress): number {
  let chapter = 1
  while (chapter < LAST_CHAPTER && chapterOpen(chapter + 1, progress)) chapter += 1
  return chapter
}
