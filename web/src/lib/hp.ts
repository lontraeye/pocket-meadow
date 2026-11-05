// HP de luta na tela. O servidor manda o hpRatio liquidado em `game.now`.
// Desmaiado (faintedUntil no futuro) fica em 0: o descanso não o levanta.
// Ao passar de faintedUntil, volta com faintRecoverRatio e, no jardim, o
// descanso conta a partir daí. Fora do jardim o HP não sobe.

import type { GameState, OwnedPokemon } from './api'

function clamp(ratio: number): number {
  if (ratio <= 0) return 0
  if (ratio >= 1) return 1
  return ratio
}

/** Fração de HP agora (0..1). */
export function liveHpRatio(mon: OwnedPokemon, game: GameState, now: number): number {
  const until = mon.faintedUntil
  if (until != null && now < until) return 0
  const woke = until != null && now >= until
  const base = woke ? game.garden.faintRecoverRatio : clamp(mon.hpRatio)
  if (mon.location !== 'garden' || base >= 1) return clamp(base)
  const since = woke ? until : game.now
  return Math.min(1, base + Math.max(0, now - since) / Math.max(1, game.garden.restFullMs))
}

/** Quanto falta para encher (0 = cheio, desmaiado ou fora do jardim). */
export function hpFullInMs(mon: OwnedPokemon, game: GameState, now: number): number {
  if (mon.location !== 'garden') return 0
  if (mon.faintedUntil != null && now < mon.faintedUntil) return 0
  return Math.max(0, (1 - liveHpRatio(mon, game, now)) * game.garden.restFullMs)
}

/** "1h20" ou "45min": o que falta para sair do desmaio. */
export function formatFaintLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 60_000))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h <= 0) return `${m}min`
  return `${h}h${String(m).padStart(2, '0')}`
}

/** Texto do desmaio, ou null se já pode lutar. */
export function faintLabel(mon: OwnedPokemon, now: number): string | null {
  if (mon.faintedUntil == null || now >= mon.faintedUntil) return null
  return `desmaiado · volta em ${formatFaintLeft(mon.faintedUntil - now)}`
}
