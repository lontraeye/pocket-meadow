import assert from 'node:assert/strict'
import test from 'node:test'
import type { GameState, OwnedPokemon } from './api.ts'
import { faintLabel, formatFaintLeft, liveHpRatio } from './hp.ts'

const restFullMs = 4 * 60 * 60 * 1000
const game = { now: 1_000_000, garden: { restFullMs, faintRecoverRatio: 0.1 } } as GameState

function mon(patch: Partial<OwnedPokemon>): OwnedPokemon {
  return { location: 'garden', hpRatio: 0, faintedUntil: null, ...patch } as OwnedPokemon
}

test('desmaiado não sobe de 0; depois do prazo volta com 0,1 e descansa', () => {
  const until = game.now + 2 * 60 * 60 * 1000
  const fainted = mon({ faintedUntil: until })
  assert.equal(liveHpRatio(fainted, game, game.now + 60_000), 0)
  assert.equal(faintLabel(mon({ faintedUntil: game.now + 80 * 60_000 }), game.now), 'desmaiado · volta em 1h20')
  assert.equal(formatFaintLeft(80 * 60_000), '1h20')

  const woke = game.now + restFullMs / 2
  assert.equal(liveHpRatio(mon({ faintedUntil: game.now }), game, woke), 0.6)
  assert.equal(liveHpRatio(mon({ location: 'pc', faintedUntil: game.now }), game, woke), 0.1)
})

test('ferido no jardim descansa a partir do HP atual, não do zero', () => {
  assert.equal(liveHpRatio(mon({ hpRatio: 0.25 }), game, game.now + restFullMs / 2), 0.75)
})
