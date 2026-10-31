import { petConfig } from '../config/pets.js'

const hourMs = 60 * 60 * 1000

export type PetNeeds = {
  hunger: number
  affection: number
  happiness: number
}

export type PetSettle = PetNeeds & {
  /**
   * Média da felicidade no intervalo (0 a 100): o XP do jardim sai dela. A
   * felicidade é linear por trechos (sobe até uma necessidade cruzar o limite,
   * depois cai), então a média por trecho é exata a menos do corte em 0 e 100.
   */
  averageHappiness: number
  hours: number
}

const clamp = (value: number) => Math.max(0, Math.min(100, value))

/** Leva as necessidades e a felicidade de `from` até `now`. Pura. */
export function settlePet(needs: PetNeeds, from: number, now: number, config = petConfig): PetSettle {
  const hours = Math.max(0, now - from) / hourMs
  const hunger = clamp(needs.hunger - config.hungerDrainPerHour * hours)
  const affection = clamp(needs.affection - config.affectionDrainPerHour * hours)

  // Até quando os dois ficam acima do limite (0 = já estava abaixo).
  const untilHunger = Math.max(0, (needs.hunger - config.needThreshold) / config.hungerDrainPerHour)
  const untilAffection = Math.max(0, (needs.affection - config.needThreshold) / config.affectionDrainPerHour)
  const upHours = Math.min(hours, untilHunger, untilAffection)
  const downHours = hours - upHours

  const top = clamp(needs.happiness + config.happinessUpPerHour * upHours)
  const happiness = clamp(top - config.happinessDownPerHour * downHours)
  const averageHappiness =
    hours > 0 ? (((needs.happiness + top) / 2) * upHours + ((top + happiness) / 2) * downHours) / hours : needs.happiness

  return { hunger, affection, happiness, averageHappiness, hours }
}

/** XP do jardim num intervalo (inteiro, para baixo). */
export function gardenXp(level: number, averageHappiness: number, hours: number, config = petConfig): number {
  return Math.floor(config.xpPerLevelHour * level * (averageHappiness / 100) * hours)
}

/** Quando o carinho volta a valer (null = já vale). */
export function petReadyAt(lastPetAt: number | null, now: number, config = petConfig): number | null {
  if (lastPetAt === null) return null
  const at = lastPetAt + config.petCooldownMs
  return at > now ? at : null
}

/** Sorteio ponderado de uma tabela de presentes, com `roll` em [0, 1). */
export function pickGift<T extends { weight: number }>(table: readonly T[], roll: number): T {
  const total = table.reduce((sum, row) => sum + row.weight, 0)
  let cursor = roll * total
  for (const row of table) {
    cursor -= row.weight
    if (cursor < 0) return row
  }
  const last = table[table.length - 1]
  if (!last) throw new Error('empty gift table')
  return last
}
