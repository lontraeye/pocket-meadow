import type { GameState, HealMachineView } from './api'

// Estruturas do jardim, uma por peça (PROGRESSAO.md 4.3, passo 2): o que
// vários lugares da tela perguntam sobre todas as bancadas e máquinas juntas.

/** Quem está operando alguma bancada (fora do passeio, do time e do daycare). */
export function benchOperatorIds(game: Pick<GameState, 'garden'>): Set<number> {
  return new Set(game.garden.benches.flatMap((bench) => (bench.operatorId === null ? [] : [bench.operatorId])))
}

/** A máquina do jardim com mais cargas (a que a cura antes da luta usa). null = nenhuma no jardim. */
export function bestHealMachine(game: Pick<GameState, 'garden'>): HealMachineView | null {
  const placed = game.garden.healMachines.filter((machine) => machine.placed)
  return placed.reduce<HealMachineView | null>((best, machine) => (!best || machine.charges > best.charges ? machine : best), null)
}
