// Daycare (PLANNING.md, seções 5.9 e 5.21): treino rápido e focado. O XP por
// hora é uma fração do XP do próximo nível (o ritmo fica parecido em qualquer
// nível), com bônus de alcance para quem está abaixo do time e o bônus do
// Pokémon cuidador. Ninguém passa do nível mais alto do time.
import { xpToNext } from './progress.js'

export const DAYCARE_SLOT_LEVELS = [1, 5, 15, 30] as const
export const DAYCARE_MAX_HOURS = 24

export const daycareConfig = {
  /** Níveis por hora no ritmo normal (1/6 = ~4 por dia). */
  levelsPerHour: 1 / 6,
  /** Bônus de alcance: +15% por nível abaixo da média do time, até ×4. */
  catchUpPerLevel: 0.15,
  catchUpMax: 4,
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

/** XP de uma hora de daycare no nível, com um multiplicador (berry, alcance, cuidador). */
export function daycareXpPerHour(level: number, boost = 1): number {
  return Math.max(1, Math.floor(xpToNext(level) * daycareConfig.levelsPerHour * boost))
}

/** Bônus de alcance: quanto mais abaixo da média do time, mais rápido (até catchUpMax). */
export function catchUpMult(level: number, teamAverage: number | null): number {
  if (teamAverage === null || level >= teamAverage) return 1
  return Math.min(daycareConfig.catchUpMax, 1 + (teamAverage - level) * daycareConfig.catchUpPerLevel)
}

/**
 * Quem pode cuidar do daycare e quanto acelera. Do começo de Johto (Sentret,
 * Hoothoot, Ledyba, Marill) até a Blissey, a melhor: cada evolução sobe de faixa.
 */
export const CARETAKER_TIERS = [
  { key: 'ajudante', name: 'Ajudante', mult: 1.25, species: [161, 163, 165, 183, 174, 39, 173, 35, 175, 238, 216, 209] },
  { key: 'cuidador', name: 'Cuidador', mult: 1.5, species: [162, 164, 166, 184, 40, 36, 176, 124, 217, 210] },
  { key: 'enfermeiro', name: 'Enfermeiro', mult: 1.75, species: [113, 241, 115] },
  { key: 'mestre', name: 'Mestre', mult: 2, species: [242] },
] as const

export function caretakerTier(speciesId: number) {
  return CARETAKER_TIERS.find((tier) => (tier.species as readonly number[]).includes(speciesId)) ?? null
}
