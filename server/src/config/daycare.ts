// Daycare (PLANNING.md, seção 5.9).
export const DAYCARE_XP_PER_LEVEL_HOUR = 3
export const DAYCARE_SLOT_LEVELS = [1, 5, 15, 30] as const
export const DAYCARE_MAX_HOURS = 24

export const daycareConfig = {
  xpPerLevelHour: DAYCARE_XP_PER_LEVEL_HOUR,
  slotLevels: DAYCARE_SLOT_LEVELS,
  maxHours: DAYCARE_MAX_HOURS,
  maxMs: DAYCARE_MAX_HOURS * 60 * 60 * 1000,
} as const

export function daycareSlotsUnlocked(trainerLevel: number): number {
  let unlocked = 0
  for (const level of DAYCARE_SLOT_LEVELS) {
    if (trainerLevel >= level) unlocked += 1
  }
  return unlocked
}

export function nextDaycareSlotLevel(trainerLevel: number): number | null {
  for (const level of DAYCARE_SLOT_LEVELS) {
    if (trainerLevel < level) return level
  }
  return null
}

export function daycareXpPerHour(level: number, boost = 1): number {
  return Math.floor(DAYCARE_XP_PER_LEVEL_HOUR * level * boost)
}
