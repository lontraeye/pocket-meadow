// Habitats construídos em blocos (PLANNING.md, seção 5.22): as peças, os
// materiais que cada uma vale e as receitas de bioma. Compartilhado entre o
// servidor e a tela (alias @habitat), como a simulação da luta: nada aqui
// importa banco ou DOM.

import type { PokemonType } from '../../config/types.js'

export const MATERIALS = ['agua', 'pedra', 'areia', 'terra', 'planta', 'fogo', 'escuro', 'gelo', 'metal'] as const
export type Material = (typeof MATERIALS)[number]

/** Quanto de cada material a peça vale (soma 1 numa peça "pura"). */
type Makeup = Partial<Record<Material, number>>

/**
 * Chão, um por casa. As chaves são as mesmas dos tiles (web/src/lib/terrain.ts).
 * Sem chão (null) é o gramado neutro; `caminho` também é neutro e separa habitats.
 */
export const FLOORS = {
  grama: { planta: 1 },
  'grama-alta': { planta: 1 },
  flores: { planta: 1 },
  areia: { areia: 1 },
  terra: { terra: 1 },
  pedra: { pedra: 1 },
  agua: { agua: 1 },
  'agua-funda': { agua: 1 },
  neve: { gelo: 1 },
  lava: { fogo: 1 },
  'chao-escuro': { escuro: 1 },
  caminho: {},
} as const satisfies Record<string, Makeup>
export type FloorKey = keyof typeof FLOORS

/**
 * Chãos que o jogador pinta no Construir, na ordem da paleta. A `grama` fica
 * de fora: é o gramado (neutro) e ficaria igual à grama pintada. Os outros
 * (neve, lava, chão escuro, caminho) entram quando tiverem arte.
 */
export const PAINT_FLOORS = ['grama-alta', 'flores', 'areia', 'terra', 'pedra', 'agua', 'agua-funda'] as const
export type PaintFloor = (typeof PAINT_FLOORS)[number]

export function isPaintFloor(value: unknown): value is PaintFloor {
  return typeof value === 'string' && (PAINT_FLOORS as readonly string[]).includes(value)
}

export const FLOOR_NAMES: Record<PaintFloor, string> = {
  'grama-alta': 'Grama alta',
  flores: 'Flores',
  areia: 'Areia',
  terra: 'Terra',
  pedra: 'Pedra',
  agua: 'Água',
  'agua-funda': 'Água funda',
}

/** Objetos, um por casa, em cima do chão. Contam `objectWeight` vezes o chão. */
export const OBJECTS = {
  rocha: { pedra: 1 },
  arvore: { planta: 1 },
  'arvore-escura': { escuro: 1 },
  tronco: { planta: 1 },
  cogumelo: { escuro: 0.5, planta: 0.5 },
  cristal: { gelo: 0.5, pedra: 0.5 },
  gerador: { metal: 1 },
  /** A cerca separa habitats: a casa com cerca não entra em zona nenhuma. */
  cerca: {},
  /** Boia decorativa: o primeiro móvel de água. */
  boia: { agua: 1 },
} as const satisfies Record<string, Makeup>
export type ObjectKey = keyof typeof OBJECTS

/**
 * Em que chão cada coisa pode ficar (pedido em 2026-11-04): a maioria só em
 * terra; alguns móveis só na água (a boia). Vale para os móveis e para as
 * peças do Construir (canteiro, árvores, bancada, máquina: terra).
 */
export type Ground = 'land' | 'water' | 'any'
export const WATER_FLOORS: readonly string[] = ['agua', 'agua-funda']

export const OBJECT_GROUND: Record<ObjectKey, Ground> = {
  rocha: 'land',
  arvore: 'land',
  'arvore-escura': 'land',
  tronco: 'land',
  cogumelo: 'land',
  cristal: 'land',
  gerador: 'land',
  cerca: 'land',
  boia: 'water',
}

/** O chão (null = gramado) aceita algo que pede `ground`. */
export function groundAllows(ground: Ground, floor: string | null): boolean {
  if (ground === 'any') return true
  const water = floor !== null && WATER_FLOORS.includes(floor)
  return ground === 'water' ? water : !water
}

/** Uma condição da receita: a soma das frações desses materiais ≥ `min`. */
export type RecipeRule = { materials: readonly Material[]; min: number }

export type BiomeRecipe = {
  key: string
  name: string
  rules: readonly RecipeRule[]
  types: readonly PokemonType[]
}

export const habitatConfig = {
  /** Peso de um objeto em relação a um chão. */
  objectWeight: 3,
  /**
   * Habitat com área escolhida (area.ts): o tipo pede pontos do material dele
   * nesta fração da área (metade: 8 casas pedem 4 pontos); o chão do material
   * vale 1 e cada móvel do material vale mais `objectPoints`.
   */
  needShare: 0.5,
  objectPoints: 1,
  /** Pisos e objetos que não entram em zona (separadores). */
  neutralFloors: ['caminho'] as readonly string[],
  separatorObjects: ['cerca'] as readonly string[],
  /** Zona menor que isso é só decoração. */
  minTiles: 6,
  /** A partir daqui o habitat tem 3 vagas (antes, 2). */
  bigTiles: 10,
  capacity: { small: 2, big: 3 },
  /**
   * Morar no bioma do seu tipo (o básico não conta): a felicidade sobe mais
   * rápido e os presentes saem com intervalo menor. Sem limite do jardim por
   * enquanto (decidido em 2026-11-04): habitat é bônus.
   */
  bonus: { happinessUpMult: 1.5, giftIntervalMult: 0.75 },
  /** Em ordem: vale a primeira receita que bate. */
  biomes: [
    { key: 'lago', name: 'Lago', rules: [{ materials: ['agua'], min: 0.5 }], types: ['water', 'ice'] },
    {
      key: 'cratera',
      name: 'Cratera',
      rules: [
        { materials: ['fogo'], min: 0.3 },
        { materials: ['pedra'], min: 0.2 },
      ],
      types: ['fire', 'dragon'],
    },
    { key: 'usina', name: 'Usina', rules: [{ materials: ['metal'], min: 0.25 }], types: ['electric', 'steel'] },
    {
      key: 'bosque-sombrio',
      name: 'Bosque sombrio',
      rules: [{ materials: ['escuro'], min: 0.4 }],
      types: ['ghost', 'dark', 'poison', 'psychic'],
    },
    {
      key: 'rochedo',
      name: 'Rochedo',
      rules: [
        { materials: ['pedra', 'areia', 'terra'], min: 0.6 },
        { materials: ['pedra'], min: 0.2 },
      ],
      types: ['rock', 'ground', 'fighting', 'steel'],
    },
    { key: 'campo-gelado', name: 'Campo gelado', rules: [{ materials: ['gelo'], min: 0.5 }], types: ['ice'] },
    {
      key: 'pradaria',
      name: 'Pradaria',
      rules: [{ materials: ['planta'], min: 0.6 }],
      types: ['normal', 'grass', 'bug', 'flying', 'fairy'],
    },
  ] as const satisfies readonly BiomeRecipe[],
}

/**
 * Habitat básico: a zona grande o bastante que não bate nenhuma receita.
 * Aceita qualquer tipo, mas não dá bônus (o bônus do bioma vem com a pureza).
 */
export const BASIC_BIOME = { key: 'basico', name: 'Habitat básico' } as const

export type BiomeKey = (typeof habitatConfig.biomes)[number]['key'] | typeof BASIC_BIOME.key

export const MATERIAL_NAMES: Record<Material, string> = {
  agua: 'água',
  pedra: 'pedra',
  areia: 'areia',
  terra: 'terra',
  planta: 'planta',
  fogo: 'fogo',
  escuro: 'escuro',
  gelo: 'gelo',
  metal: 'metal',
}
