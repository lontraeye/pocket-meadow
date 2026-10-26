export const trainerConfig = {
  energyMax: 10,
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
