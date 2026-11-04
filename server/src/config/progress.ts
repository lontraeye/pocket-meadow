export const progressConfig = {
  // 1 de energia a cada 15 min (até a energia máxima; era 1 por hora até 2026-11-04).
  energyRegenMs: 15 * 60 * 1000,
  levelCap: 100,
  gardenMaxVisible: 15,
  xpBase: 10,
  xpExponent: 1.5,
} as const

export function xpToNext(level: number): number {
  return Math.floor(progressConfig.xpBase * level ** progressConfig.xpExponent)
}
