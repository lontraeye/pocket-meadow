// Árvores de Apricorn e bancada de bolas (PLANNING.md, seção 5.23). As árvores
// produzem sozinhas com o tempo; a chuva acelera. A bancada transforma cada
// Apricorn em bolas, em lotes, e sobe de nível (lote maior, mais rápida, bolas
// melhores). Tudo por timestamp (seção 2).

const minuteMs = 60 * 1000
const hourMs = 60 * minuteMs

/** Apricorn vermelho (o primeiro); os outros têm a cor no nome. */
export const APRICORN_ITEM = 'mat:apricorn'
export const APRICORN_BLUE = 'mat:apricorn-blue'
export const APRICORN_YELLOW = 'mat:apricorn-yellow'

export type TreeKey = 'apricorn_tree' | 'apricorn_tree_blue' | 'apricorn_tree_yellow'

export type TreeDef = {
  key: TreeKey
  /** Cor do fruto, para a arte. */
  color: 'red' | 'blue' | 'yellow'
  itemKey: string
  /** Um Apricorn a cada intervalo, até `cap` pendurados. */
  intervalMs: number
  cap: number
  /** Nos dias de chuva o intervalo é multiplicado por isto. */
  rainMult: number
  /** Ao abrir (pelo marco, config/gardenUnlocks), já vem com este tanto pendurado. */
  startWith: number
}

const treeBase = { cap: 5, rainMult: 0.6, startWith: 1 }

export const TREES: TreeDef[] = [
  { key: 'apricorn_tree', color: 'red', itemKey: APRICORN_ITEM, intervalMs: 3 * hourMs, ...treeBase },
  { key: 'apricorn_tree_blue', color: 'blue', itemKey: APRICORN_BLUE, intervalMs: 4 * hourMs, ...treeBase },
  { key: 'apricorn_tree_yellow', color: 'yellow', itemKey: APRICORN_YELLOW, intervalMs: 6 * hourMs, ...treeBase },
]

export function treeDef(key: string): TreeDef | null {
  return TREES.find((tree) => tree.key === key) ?? null
}

export type RecipeDef = {
  key: 'poke_ball' | 'great_ball' | 'ultra_ball'
  input: string
  output: string
  /** Bolas por Apricorn. */
  perUnit: number
  /** Tempo de cada Apricorn no nível 1 (os níveis seguintes encurtam). */
  unitMs: number
  minBenchLevel: number
}

export const RECIPES: RecipeDef[] = [
  { key: 'poke_ball', input: APRICORN_ITEM, output: 'ball:poke', perUnit: 2, unitMs: 30 * minuteMs, minBenchLevel: 1 },
  { key: 'great_ball', input: APRICORN_BLUE, output: 'ball:great', perUnit: 1, unitMs: 45 * minuteMs, minBenchLevel: 2 },
  { key: 'ultra_ball', input: APRICORN_YELLOW, output: 'ball:ultra', perUnit: 1, unitMs: 90 * minuteMs, minBenchLevel: 3 },
]

export function recipeDef(key: string): RecipeDef | null {
  return RECIPES.find((recipe) => recipe.key === key) ?? null
}

export type BenchLevelDef = {
  /** Apricorns num lote. */
  batchSize: number
  /** Fração do tempo de cada receita (1 = o tempo do nível 1). */
  speed: number
  /** Como chegar neste nível (o 1 já vem); o marco que deixa vem de config/gardenUnlocks. */
  upgrade?: { ms: number; cost: { itemKey: string; quantity: number }[] }
}

export const apricornConfig = {
  bench: {
    /** Tipos de quem pode operar ("quem tem mãos"). */
    operatorTypes: ['normal', 'fighting', 'steel'] as string[],
    levels: [
      { batchSize: 5, speed: 1 },
      {
        batchSize: 10,
        speed: 25 / 30,
        upgrade: {
          ms: 2 * hourMs,
          cost: [
            { itemKey: APRICORN_ITEM, quantity: 15 },
            { itemKey: 'berry:oran', quantity: 5 },
          ],
        },
      },
      {
        batchSize: 15,
        speed: 20 / 30,
        upgrade: {
          ms: 6 * hourMs,
          cost: [
            { itemKey: APRICORN_ITEM, quantity: 30 },
            { itemKey: 'berry:pinap', quantity: 5 },
            { itemKey: 'berry:razz', quantity: 5 },
          ],
        },
      },
    ] as BenchLevelDef[],
    /** Operador com felicidade 100 faz cada Apricorn nesta fração a menos de tempo. */
    speedBonus: 0.25,
  },
}

export type BenchConfig = typeof apricornConfig.bench

/** O nível da bancada (o último vale para os acima). */
export function benchLevel(level: number, config: BenchConfig = apricornConfig.bench): BenchLevelDef {
  return config.levels[Math.min(Math.max(1, level), config.levels.length) - 1]!
}

/** Tempo de cada Apricorn de uma receita no nível da bancada, antes do operador. */
export function recipeUnitMs(recipe: RecipeDef, level: number): number {
  return Math.round(recipe.unitMs * benchLevel(level).speed)
}

/** Tempo com a felicidade do operador (fixado ao começar o lote). */
export function benchUnitMs(baseMs: number, happiness: number, config: BenchConfig = apricornConfig.bench): number {
  return Math.round(baseMs * (1 - config.speedBonus * Math.max(0, Math.min(100, happiness)) / 100))
}
