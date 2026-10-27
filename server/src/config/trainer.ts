export const trainerConfig = {
  energyMax: 10,
  // Vitória: 8 + 2 × nível do selvagem. Captura: 10 + nível, somada à vitória.
  // Curva em trainerXpToNext. Ver PLANNING.md, seção 5.1.
  winXpBase: 8,
  winXpPerWildLevel: 2,
  catchXpBase: 10,
  catchXpPerWildLevel: 1,
  starterLevel: 5,
  starters: {
    bulbasaur: 1,
    charmander: 4,
    squirtle: 7,
  },
  startingItems: [
    { itemKey: 'seed:oran', quantity: 3 },
    { itemKey: 'seed:pinap', quantity: 1 },
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
