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

/**
 * Lançamentos da captura em passos (8.4): 1ª rolagem = 1º lançamento, etc.
 * O `source` aqui é a seed secreta do encontro (`secret_seed`), nunca a
 * rng_seed: o XOR deixa recuperar a rng_seed a partir da seed da luta.
 */
export function throwRngSeed(source: number): number {
  return (source ^ 0x54485257) >>> 0 // "THRW"
}

/** Semente de berry na vitória (separada dos lançamentos). Também usa a seed secreta. */
export function seedDropRngSeed(source: number): number {
  return (source ^ 0x53444544) >>> 0 // "SDED"
}

/**
 * Tempo de reação do jogador automático (atrasos 150–450 ms).
 * Sequência separada da do dano/IA do selvagem.
 */
export function autoReactionSeed(source: number): number {
  return (source ^ 0x4155544f) >>> 0 // "AUTO"
}
