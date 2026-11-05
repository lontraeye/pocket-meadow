import assert from 'node:assert/strict'
import test from 'node:test'
import { abandonAfterMs, simConfig, timeLimitOf } from './config.js'

test('tempo da luta: 60 s, mais 30 s por Pokémon a mais do treinador', () => {
  assert.equal(timeLimitOf({}), simConfig.timeLimitMs)
  assert.equal(timeLimitOf({ foes: [1] }), simConfig.timeLimitMs)
  assert.equal(timeLimitOf({ foes: [1, 2, 3, 4, 5, 6] }), 210_000)
})

test('abandono: folga para a pausa de cada troca por desmaio', () => {
  const solo = abandonAfterMs({ team: [1] })
  assert.equal(solo, simConfig.timeLimitMs + simConfig.abandonSlackMs)
  const six = abandonAfterMs({ team: [1, 2, 3, 4, 5, 6], foes: [1, 2, 3, 4, 5] })
  assert.equal(six, 180_000 + 5 * simConfig.sendPauseSlackMs + simConfig.abandonSlackMs)
})
