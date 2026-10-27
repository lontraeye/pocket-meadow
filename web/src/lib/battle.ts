import type { BattleRules } from './api'

// Espelha winChance e teamPower de server/src/game/battle.ts.
// Os números vêm do servidor; a conta é instantânea enquanto o time muda.
export function previewWinChance(powers: number[], wildPower: number, rules: BattleRules): number {
  const ranked = [...powers].sort((a, b) => b - a)
  const team = ranked.reduce((sum, value, index) => sum + value * (rules.teamWeights[index] ?? 0), 0)
  if (!(wildPower > 0) || !(team > 0)) return rules.minChance
  const chance = 1 / (1 + Math.exp(-rules.k * Math.log(team / wildPower)))
  return Math.min(rules.maxChance, Math.max(rules.minChance, chance))
}

export function percent(chance: number): string {
  return `${Math.round(chance * 100)}%`
}
