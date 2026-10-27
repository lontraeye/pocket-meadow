export const progressConfig = {
  energyRegenMs: 15 * 60 * 1000,
  levelCap: 100,
  gardenMaxVisible: 15,
  basePlotSlots: 2,
  xpBase: 10,
  xpExponent: 1.5,
} as const

export function xpToNext(level: number): number {
  return Math.floor(progressConfig.xpBase * level ** progressConfig.xpExponent)
}
