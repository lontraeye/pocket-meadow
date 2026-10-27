/** Reexporta a simulação compartilhada (alias @sim → server) para a 8.3. */
export { runBattle, simConfig, battleRngSeed } from './sim'

export function percent(chance: number): string {
  return `${Math.round(chance * 100)}%`
}
