import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { daycareConfig, daycareXpPerHour } from '../config/daycare.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { trainerConfig } from '../config/trainer.js'
import { applyDaycareHours, levelsGainedFromStay } from './daycare.js'
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
    const expected = applyDaycareHours(5, 0, 2)
    assert.equal(result.daycare.length, 1)
    assert.equal(result.daycare[0]?.lastSettledAt, now - 0.5 * hour)
    assert.equal(result.daycare[0]?.level, expected.level)
    assert.equal(result.daycare[0]?.xp, expected.xp)
    assert.equal(result.daycare[0]?.xpGained, expected.xpGained)
  })

  test('a taxa sobe quando o nível sobe no meio da liquidação', () => {
    // 8 h no Nv 5: 7×15 = 105, na 8ª hora sobe e sobra 9 XP no Nv 6.
    // A 9ª hora já rende no Nv 6: +18, fica 27.
    const result = applyCatchUp(
      state({ daycare: [{ ...slot, level: 5, xp: 0, lastSettledAt: now - 9 * hour }] }),
      now,
    )
    assert.equal(result.daycare[0]?.level, 6)
    assert.equal(result.daycare[0]?.xp, 27)
    assert.equal(result.daycare[0]?.xpGained, 8 * 15 + 18)
    assert.equal(daycareXpPerHour(5), 15)
    assert.equal(daycareXpPerHour(6), 18)
  })

  test('sobe de nível e carrega o XP que sobrou', () => {
    const hours = 8
    const result = applyCatchUp(state({ daycare: [{ ...slot, lastSettledAt: now - hours * hour }] }), now)
    const expected = applyDaycareHours(5, 0, hours)
    assert.equal(result.daycare[0]?.level, expected.level)
    assert.equal(result.daycare[0]?.xp, expected.xp)
  })

  test('para de render depois do limite de tempo acumulado a partir de entered_at', () => {
    const enteredAt = now - daycareConfig.maxMs - 10 * hour
    const result = applyCatchUp(
      state({ daycare: [{ ...slot, level: 50, enteredAt, lastSettledAt: enteredAt }] }),
      now,
    )
    assert.equal(result.daycare[0]?.lastSettledAt, enteredAt + daycareConfig.maxMs)
    assert.equal(result.daycare[0]?.xpGained, applyDaycareHours(50, 0, daycareConfig.maxHours).xpGained)
    const again = applyCatchUp(
      state({ daycare: [{ ...slot, level: 50, enteredAt, lastSettledAt: enteredAt + daycareConfig.maxMs }] }),
      now,
    )
    assert.deepEqual(again.daycare, [])
  })

  test('não passa do nível máximo', () => {
    const enteredAt = now - daycareConfig.maxMs
    const result = applyCatchUp(
      state({
        daycare: [
          {
            ...slot,
            level: progressConfig.levelCap - 1,
            xp: xpToNext(progressConfig.levelCap - 1) - 1,
            enteredAt,
            lastSettledAt: enteredAt,
          },
        ],
      }),
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
        effects: [
          {
            id: 1,
            effectKey: 'daycare_boost',
            multiplier: 2,
            createdAt: now - 3 * hour,
            expiresAt: now + hour,
          },
        ],
      }),
      now,
    )
    assert.equal(boosted.daycare[0]?.xpGained, (base.daycare[0]?.xpGained ?? 0) * 2)
    assert.equal(boosted.daycare[0]?.xp, (base.daycare[0]?.xp ?? 0) * 2)
  })

  test('Nanab desalinhada: 2 h de efeito valem 2 h de bônus, divididas entre 3 horas', () => {
    // Nv 50: 150 XP/h. Janela de settledFrom+0,5h a +2,5h: horas com 0,5, 1 e 0,5
    // de bônus → 225 + 300 + 225 = 750, ou seja, 450 normais + 300 (2 h de bônus).
    const settledFrom = now - 3 * hour
    const result = applyCatchUp(
      state({
        daycare: [{ ...slot, level: 50, lastSettledAt: settledFrom }],
        effects: [
          {
            id: 4,
            effectKey: 'daycare_boost',
            multiplier: 2,
            createdAt: settledFrom + 0.5 * hour,
            expiresAt: settledFrom + 2.5 * hour,
          },
        ],
      }),
      now,
    )
    assert.equal(daycareXpPerHour(50), 150)
    assert.equal(result.daycare[0]?.xpGained, 750)
  })

  test('Nanab: hora ganha bônus na fração dentro da janela', () => {
    const settledFrom = now - 3 * hour
    const base = applyCatchUp(
      state({ daycare: [{ ...slot, level: 50, lastSettledAt: settledFrom }] }),
      now,
    )
    const baseXp = base.daycare[0]?.xpGained ?? 0
    assert.equal(baseXp, 3 * daycareXpPerHour(50))

    // Venceu no fim da 1ª hora: só ela tem bônus.
    const expiredMid = applyCatchUp(
      state({
        daycare: [{ ...slot, level: 50, lastSettledAt: settledFrom }],
        effects: [
          {
            id: 1,
            effectKey: 'daycare_boost',
            multiplier: 2,
            createdAt: settledFrom - hour,
            expiresAt: settledFrom + hour,
          },
        ],
      }),
      now,
    )
    assert.equal(expiredMid.daycare[0]?.xpGained, daycareXpPerHour(50) * 2 + 2 * daycareXpPerHour(50))
    assert.deepEqual(expiredMid.deleteEffectIds, [1])

    // Criado no início da 3ª hora: só ela tem bônus.
    const createdMid = applyCatchUp(
      state({
        daycare: [{ ...slot, level: 50, lastSettledAt: settledFrom }],
        effects: [
          {
            id: 2,
            effectKey: 'daycare_boost',
            multiplier: 2,
            createdAt: settledFrom + 2 * hour,
            expiresAt: now + hour,
          },
        ],
      }),
      now,
    )
    assert.equal(createdMid.daycare[0]?.xpGained, 2 * daycareXpPerHour(50) + daycareXpPerHour(50) * 2)

    // Ativo o período inteiro.
    const full = applyCatchUp(
      state({
        daycare: [{ ...slot, level: 50, lastSettledAt: settledFrom }],
        effects: [
          {
            id: 3,
            effectKey: 'daycare_boost',
            multiplier: 2,
            createdAt: settledFrom,
            expiresAt: now,
          },
        ],
      }),
      now,
    )
    assert.equal(full.daycare[0]?.xpGained, baseXp * 2)
  })

  test('um dia cheio no Nv 5 rende cerca de 3 níveis e no Nv 50 cerca de 1', () => {
    const from5 = applyDaycareHours(5, 0, daycareConfig.maxHours)
    // Dois level ups + quase o terceiro (~2,9 da tabela da seção 5.9).
    assert.equal(from5.level, 7)
    assert.ok(from5.xp / xpToNext(7) > 0.8)

    const from50 = applyDaycareHours(50, 0, daycareConfig.maxHours)
    assert.equal(from50.level, 51)
    assert.ok(from50.xp < xpToNext(51))
    assert.equal(levelsGainedFromStay(from50.level, from50.xp, from50.xpGained), 1)
  })
})

describe('efeitos e encontros', () => {
  test('apaga só os efeitos por tempo que venceram', () => {
    const result = applyCatchUp(
      state({
        effects: [
          { id: 1, effectKey: 'catch_boost', multiplier: 1.5, createdAt: now - hour, expiresAt: now },
          { id: 2, effectKey: 'daycare_boost', multiplier: 2, createdAt: now - hour, expiresAt: now + 1 },
          { id: 3, effectKey: 'rare_boost', multiplier: 2, createdAt: now - hour, expiresAt: null },
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
