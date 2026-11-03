// Prévia da estadia no daycare (PLANNING.md, 5.21), com as mesmas regras do
// servidor (config/daycare.ts e game/daycare.ts): o XP por hora é uma fração do
// XP do próximo nível, com o bônus de alcance e o do cuidador. O servidor manda
// as regras e o time no estado.
import type { DaycareContext, DaycareRules } from './api'

function xpToNext(level: number, rules: DaycareRules): number {
  return Math.floor(rules.xpBase * level ** rules.xpExponent)
}

function catchUpMult(level: number, rules: DaycareRules, context: DaycareContext): number {
  if (context.teamAverage === null || level >= context.teamAverage) return 1
  return Math.min(rules.catchUpMax, 1 + (context.teamAverage - level) * rules.catchUpPerLevel)
}

/** Onde o Pokémon termina depois de `hours` horas (por padrão, uma estadia cheia). */
export function simulateStay(
  level: number,
  xp: number,
  rules: DaycareRules,
  context: DaycareContext,
  hours = rules.maxHours,
): { level: number; xpGained: number } {
  const cap = rules.levelCap
  let lv = level
  let cur = xp
  let gained = 0
  for (let h = 0; h < hours && lv < cap; h += 1) {
    const rate = Math.max(
      1,
      Math.floor(xpToNext(lv, rules) * rules.levelsPerHour * catchUpMult(lv, rules, context) * context.caretakerMult),
    )
    let left = rate
    while (left > 0 && lv < cap) {
      const need = xpToNext(lv, rules) - cur
      if (left >= need) {
        left -= need
        gained += need
        lv += 1
        cur = 0
      } else {
        cur += left
        gained += left
        left = 0
      }
    }
  }
  return { level: lv, xpGained: gained }
}
