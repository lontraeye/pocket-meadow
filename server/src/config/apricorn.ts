// Árvore de Apricorn e bancada de bolas (PLANNING.md, seção 5.23). A árvore
// produz sozinha com o tempo; a chuva acelera. Tudo por timestamp (seção 2).

const hourMs = 60 * 60 * 1000

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
}

export type TreeConfig = typeof apricornConfig.tree
