// HP de luta na tela: o servidor manda o hpRatio liquidado em `game.now`; no
// jardim ele sobe sozinho (descanso, cheio em restFullMs a partir de 0), então
// a tela projeta o que já curou desde então, como as árvores.

import type { GameState, OwnedPokemon } from './api'

/** Fração de HP agora (0..1), com o descanso no jardim desde o último estado. */
export function liveHpRatio(mon: OwnedPokemon, game: GameState, now: number): number {
  const base = Math.max(0, Math.min(1, mon.hpRatio))
  if (mon.location !== 'garden' || base >= 1) return base
  return Math.min(1, base + Math.max(0, now - game.now) / Math.max(1, game.garden.restFullMs))
}

/** Quanto falta para encher (0 = cheio ou fora do jardim, onde não cura). */
export function hpFullInMs(mon: OwnedPokemon, game: GameState, now: number): number {
  if (mon.location !== 'garden') return 0
  return Math.max(0, (1 - liveHpRatio(mon, game, now)) * game.garden.restFullMs)
}
