// HP persistente e máquina de cura (PROGRESSAO.md, 4.2 / item 4).
// Descanso no jardim e cargas da máquina: tudo por timestamp, sem loop.

const hourMs = 60 * 60 * 1000

export const healConfig = {
  /** Do HP 0 ao cheio no jardim (descanso). Não age enquanto o Pokémon está desmaiado. */
  restFullMs: 4 * hourMs,
  /** Desmaiado não descansa: depois deste prazo volta com `faintRecoverRatio`, em qualquer lugar. */
  faintRecoverMs: 2 * hourMs,
  /** HP ao sair do desmaio (aí o descanso do jardim segue, a partir desse instante). */
  faintRecoverRatio: 0.1,
  /** Máquina de cura: cargas e tempo de cada uma. */
  machine: {
    maxCharges: 4,
    /** Cada carga volta neste intervalo (uma de cada vez). */
    rechargeMs: 6 * hourMs,
    /** Conta nova começa com a máquina cheia. */
    startWith: 4,
  },
} as const
