import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { progressConfig, xpToNext } from '../config/progress.js'
import { trainerConfig } from '../config/trainer.js'
import { applyCatchUp, type CatchUpState } from './catchUp.js'

const now = 1_800_000_000_000
const regen = progressConfig.energyRegenMs
const hour = 60 * 60 * 1000
const max = trainerConfig.energyMax

function state(overrides: Partial<CatchUpState> = {}): CatchUpState {
  return {
    trainer: { energy: max, energyUpdatedAt: now },
    daycare: [],
    effects: [],
    encounters: [],
    ...overrides,
  }
}

describe('energia', () => {
  test('cheia: âncora vai para agora e não há próximo ponto', () => {
    const result = applyCatchUp(state({ trainer: { energy: max, energyUpdatedAt: now - 5 * regen } }), now)
    assert.deepEqual(result.trainer, { energy: max, energyUpdatedAt: now })
    assert.equal(result.energyNextAt, null)
  })

  test('menos de um intervalo: nada muda', () => {
    const trainer = { energy: 3, energyUpdatedAt: now - regen + 1 }
    const result = applyCatchUp(state({ trainer }), now)
    assert.deepEqual(result.trainer, trainer)
    assert.equal(result.energyNextAt, trainer.energyUpdatedAt + regen)
  })

  test('ganha por intervalo inteiro e preserva a fração restante', () => {
    const result = applyCatchUp(state({ trainer: { energy: 3, energyUpdatedAt: now - 2.5 * regen } }), now)
    assert.equal(result.trainer.energy, 5)
    assert.equal(result.trainer.energyUpdatedAt, now - 0.5 * regen)
    assert.equal(result.energyNextAt, now + 0.5 * regen)
  })

  test('não passa do máximo e, ao encher, a âncora vai para agora', () => {
    const result = applyCatchUp(state({ trainer: { energy: max - 1, energyUpdatedAt: now - 5 * regen } }), now)
    assert.deepEqual(result.trainer, { energy: max, energyUpdatedAt: now })
    assert.equal(result.energyNextAt, null)
  })

  test('aplicar duas vezes seguidas dá o mesmo resultado', () => {
    const first = applyCatchUp(state({ trainer: { energy: 2, energyUpdatedAt: now - 3.7 * regen } }), now)
    const second = applyCatchUp(state({ trainer: first.trainer }), now)
    assert.deepEqual(second.trainer, first.trainer)
  })
})

describe('daycare', () => {
  const slot = { pokemonId: 7, level: 5, xp: 0, enteredAt: now - 10 * hour, lastSettledAt: now - 10 * hour }

  test('menos de uma hora desde o último acerto: slot não aparece no resultado', () => {
    const result = applyCatchUp(state({ daycare: [{ ...slot, lastSettledAt: now - hour + 1 }] }), now)
    assert.deepEqual(result.daycare, [])
  })

  test('aplica só horas inteiras e guarda a fração para depois', () => {
    const result = applyCatchUp(state({ daycare: [{ ...slot, xp: 0, lastSettledAt: now - 2.5 * hour }] }), now)
    const gained = 2 * progressConfig.daycareXpPerHour
    assert.equal(result.daycare.length, 1)
    assert.equal(result.daycare[0]?.lastSettledAt, now - 0.5 * hour)
    assert.equal(result.daycare[0]?.xp, gained < xpToNext(5) ? gained : result.daycare[0]?.xp)
  })

  test('sobe de nível e carrega o XP que sobrou', () => {
    const hours = Math.ceil(xpToNext(5) / progressConfig.daycareXpPerHour)
    const result = applyCatchUp(state({ daycare: [{ ...slot, lastSettledAt: now - hours * hour }] }), now)
    assert.equal(result.daycare[0]?.level, 6)
    assert.equal(result.daycare[0]?.xp, hours * progressConfig.daycareXpPerHour - xpToNext(5))
  })

  test('para de render depois do limite de tempo acumulado', () => {
    const enteredAt = now - progressConfig.daycareMaxMs - 10 * hour
    const result = applyCatchUp(
      state({ daycare: [{ ...slot, level: 50, enteredAt, lastSettledAt: enteredAt }] }),
      now,
    )
    assert.equal(result.daycare[0]?.lastSettledAt, enteredAt + progressConfig.daycareMaxMs)
    const again = applyCatchUp(
      state({ daycare: [{ ...slot, level: 50, enteredAt, lastSettledAt: enteredAt + progressConfig.daycareMaxMs }] }),
      now,
    )
    assert.deepEqual(again.daycare, [])
  })

  test('não passa do nível máximo', () => {
    const enteredAt = now - progressConfig.daycareMaxMs
    const result = applyCatchUp(
      state({ daycare: [{ ...slot, level: progressConfig.levelCap - 1, xp: xpToNext(progressConfig.levelCap - 1) - 1, enteredAt, lastSettledAt: enteredAt }] }),
      now,
    )
    assert.deepEqual(
      { level: result.daycare[0]?.level, xp: result.daycare[0]?.xp },
      { level: progressConfig.levelCap, xp: 0 },
    )
  })

  test('efeito daycare_boost ativo multiplica o XP', () => {
    const base = applyCatchUp(state({ daycare: [{ ...slot, level: 50, lastSettledAt: now - 3 * hour }] }), now)
    const boosted = applyCatchUp(
      state({
        daycare: [{ ...slot, level: 50, lastSettledAt: now - 3 * hour }],
        effects: [{ id: 1, effectKey: 'daycare_boost', multiplier: 2, expiresAt: now + hour }],
      }),
      now,
    )
    assert.equal(boosted.daycare[0]?.xp, (base.daycare[0]?.xp ?? 0) * 2)
  })
})

describe('efeitos e encontros', () => {
  test('apaga só os efeitos por tempo que venceram', () => {
    const result = applyCatchUp(
      state({
        effects: [
          { id: 1, effectKey: 'catch_boost', multiplier: 1.5, expiresAt: now },
          { id: 2, effectKey: 'daycare_boost', multiplier: 2, expiresAt: now + 1 },
          { id: 3, effectKey: 'rare_boost', multiplier: 2, expiresAt: null },
        ],
      }),
      now,
    )
    assert.deepEqual(result.deleteEffectIds, [1])
  })

  test('marca como fugidos só os encontros pendentes vencidos', () => {
    const result = applyCatchUp(
      state({
        encounters: [
          { id: 1, status: 'pending', expiresAt: now },
          { id: 2, status: 'pending', expiresAt: now + 1 },
          { id: 3, status: 'caught', expiresAt: now - hour },
        ],
      }),
      now,
    )
    assert.deepEqual(result.fleeEncounterIds, [1])
  })
})

test('xpToNext segue floor(10 * nível^1.5)', () => {
  assert.equal(xpToNext(1), 10)
  assert.equal(xpToNext(5), 111)
  assert.equal(xpToNext(100), 10000)
})
