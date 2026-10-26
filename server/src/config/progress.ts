export const progressConfig = {
  energyRegenMs: 15 * 60 * 1000,
  daycareXpPerHour: 30,
  daycareMaxMs: 24 * 60 * 60 * 1000,
  levelCap: 100,
  gardenMaxVisible: 15,
  basePlotSlots: 2,
} as const

export function xpToNext(level: number): number {
  return Math.floor(10 * level ** 1.5)
}
