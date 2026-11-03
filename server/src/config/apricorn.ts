// Árvore de Apricorn e bancada de bolas (PLANNING.md, seção 5.23). A árvore
// produz sozinha com o tempo; a chuva acelera. Tudo por timestamp (seção 2).

const minuteMs = 60 * 1000
const hourMs = 60 * minuteMs

export const APRICORN_ITEM = 'mat:apricorn'

export const apricornConfig = {
  tree: {
    /** Nível de treinador em que a árvore (e a bancada) abrem. */
    unlockLevel: 2,
    /** Um Apricorn a cada intervalo, até `cap` pendurados. */
    intervalMs: 3 * hourMs,
    cap: 5,
    /** Nos dias de chuva o intervalo é multiplicado por isto. */
    rainMult: 0.6,
    /** Ao abrir, a árvore já vem com este tanto pendurado (o primeiro toque). */
    startWith: 1,
  },
  bench: {
    /** Tipos de quem pode operar ("quem tem mãos"). Abre junto com a árvore. */
    operatorTypes: ['normal', 'fighting', 'steel'] as string[],
    /**
     * Por nível da bancada (upgrades, depois): quantos Apricorns cabem num lote
     * e quanto leva cada bola. Só o nível 1 se alcança por enquanto.
     */
    levels: [
      { batchSize: 5, unitMs: 30 * minuteMs },
      { batchSize: 10, unitMs: 25 * minuteMs },
      { batchSize: 15, unitMs: 20 * minuteMs },
    ],
    /** Operador com felicidade 100 faz cada bola nesta fração a menos de tempo. */
    speedBonus: 0.25,
    /** O que sai de cada Apricorn. */
    output: 'ball:poke',
  },
}

export type TreeConfig = typeof apricornConfig.tree
export type BenchConfig = typeof apricornConfig.bench

/** Lote e tempo da bancada num nível (o último vale para os acima). */
export function benchLevel(level: number, config: BenchConfig = apricornConfig.bench) {
  return config.levels[Math.min(Math.max(1, level), config.levels.length) - 1]!
}

/** Tempo de cada bola com a felicidade do operador (fixado ao começar o lote). */
export function benchUnitMs(baseMs: number, happiness: number, config: BenchConfig = apricornConfig.bench): number {
  return Math.round(baseMs * (1 - config.speedBonus * Math.max(0, Math.min(100, happiness)) / 100))
}
