/** Folha 24×32, 5 quadros: 0 = vazia; 1–4 = enchendo de Pokébolas. */
export const HEAL_W = 24
export const HEAL_H = 32
export const HEAL_FRAMES = 5
/** Parada: bandeja vazia. */
export const HEAL_IDLE = 0

/**
 * Ao curar: enche (0→4), segura no cheio (brilho) e esvazia de novo.
 * `null` = animação acabou (voltar ao idle).
 */
const HEAL_ANIM_MS = [70, 90, 90, 90, 110, 160, 160, 90, 90, 90, 70]
const HEAL_ANIM_FRAMES = [0, 1, 2, 3, 4, 4, 4, 3, 2, 1, 0]
export const HEAL_ANIM_TOTAL_MS = HEAL_ANIM_MS.reduce((sum, ms) => sum + ms, 0)

export function healAnimFrame(elapsedMs: number): number | null {
  if (elapsedMs < 0) return null
  let t = elapsedMs
  for (let i = 0; i < HEAL_ANIM_MS.length; i += 1) {
    const step = HEAL_ANIM_MS[i]!
    if (t < step) return HEAL_ANIM_FRAMES[i]!
    t -= step
  }
  return null
}
