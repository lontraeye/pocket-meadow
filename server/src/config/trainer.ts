export const trainerConfig = {
  // Religada em 2026-11-03 com outra regra (PROGRESSAO.md, 4.2): gasta 1 ao
  // revelar um campo (todos os Pokémon dele saem com ela) e ao usar uma mancha
  // (pesca, árvore, pedra); a luta do campo e o líder não gastam. Volta por
  // tempo e pelas berries (Oran).
  energyEnabled: true,
  energyMax: 10,
  /** Tamanho máximo do time (o time inteiro vai para a luta). */
  teamMax: 6,
  // Vitória: 8 + 2 × nível do selvagem. Captura: 10 + nível, somada à vitória.
  // Curva em trainerXpToNext. Ver PLANNING.md, seção 5.1.
  winXpBase: 8,
  winXpPerWildLevel: 2,
  catchXpBase: 10,
  catchXpPerWildLevel: 1,
  starterLevel: 5,
  // Iniciais de Johto: por enquanto todo mundo começa em New Bark
  // (JORNADA.md; Kanto volta quando tiver mapa e roteiro).
  starters: {
    chikorita: 152,
    cyndaquil: 155,
    totodile: 158,
  },
  startingItems: [
    { itemKey: 'seed:oran', quantity: 3 },
    { itemKey: 'seed:pinap', quantity: 1 },
    { itemKey: 'ball:poke', quantity: 30 },
  ],
} as const

export type StarterKey = keyof typeof trainerConfig.starters

export function trainerXpToNext(level: number): number {
  return Math.floor(30 * level ** 1.7)
}

export function trainerWinXp(wildLevel: number): number {
  return trainerConfig.winXpBase + wildLevel * trainerConfig.winXpPerWildLevel
}

export function trainerCatchXp(wildLevel: number): number {
  return trainerConfig.catchXpBase + wildLevel * trainerConfig.catchXpPerWildLevel
}
