export const progressConfig = {
  // 1 de energia por hora (até a energia máxima); o grosso vem das berries.
  energyRegenMs: 60 * 60 * 1000,
  levelCap: 100,
  gardenMaxVisible: 15,
  xpBase: 10,
  xpExponent: 1.5,
} as const

export function xpToNext(level: number): number {
  return Math.floor(progressConfig.xpBase * level ** progressConfig.xpExponent)
}
