/** Seeds derivadas do encontro — cada parte da luta/captura tem a sua sequência. */

/** Simulação de combate (dano, IA, delays). */
export function battleRngSeed(source: number): number {
  return (source ^ 0x4241544c) >>> 0 // "BATL"
}

/**
 * Traços do selvagem (IVs / nature / golpes / habilidade): a mesma seed na
 * luta e na captura, para o indivíduo capturado ser o que lutou.
 */
export function wildTraitsSeed(source: number): number {
  return (source ^ 0x57494c44) >>> 0 // "WILD"
}

/** @deprecated use wildTraitsSeed */
export const wildFightTraitsSeed = wildTraitsSeed

/** Lançamentos / chance de captura automática (8.4 usará a mesma família). */
export function throwRngSeed(source: number): number {
  return (source ^ 0x54485257) >>> 0 // "THRW"
}
