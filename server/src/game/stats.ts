import { natureMultiplier, type StatKey } from '../config/natures.js'

export type StatBlock = {
  hp: number
  attack: number
  defense: number
  spAttack: number
  spDefense: number
  speed: number
}

/** HP = ⌊(2B + IV + ⌊EV/4⌋) · L/100⌋ + L + 10 */
export function calcHp(base: number, iv: number, ev: number, level: number): number {
  return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10
}

/** demais = ⌊(⌊(2B + IV + ⌊EV/4⌋) · L/100⌋ + 5) · nature⌋ */
export function calcStat(
  base: number,
  iv: number,
  ev: number,
  level: number,
  natureKey: string,
  stat: StatKey,
): number {
  const inner = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5
  return Math.floor(inner * natureMultiplier(natureKey, stat))
}

export function calcStats(input: {
  base: StatBlock
  ivs: StatBlock
  evs: StatBlock
  level: number
  nature: string
}): StatBlock {
  const { base, ivs, evs, level, nature } = input
  return {
    hp: calcHp(base.hp, ivs.hp, evs.hp, level),
    attack: calcStat(base.attack, ivs.attack, evs.attack, level, nature, 'attack'),
    defense: calcStat(base.defense, ivs.defense, evs.defense, level, nature, 'defense'),
    spAttack: calcStat(base.spAttack, ivs.spAttack, evs.spAttack, level, nature, 'spAttack'),
    spDefense: calcStat(base.spDefense, ivs.spDefense, evs.spDefense, level, nature, 'spDefense'),
    speed: calcStat(base.speed, ivs.speed, evs.speed, level, nature, 'speed'),
  }
}

/** Avaliação dos IVs para a ficha: % do máximo (186) e 0–5 estrelas. */
export function ivRating(ivs: StatBlock): { total: number; percent: number; stars: number } {
  const total = ivs.hp + ivs.attack + ivs.defense + ivs.spAttack + ivs.spDefense + ivs.speed
  const percent = Math.round((total / 186) * 100)
  const stars = Math.min(5, Math.floor((total / 186) * 5 + 1e-9))
  return { total, percent, stars }
}
