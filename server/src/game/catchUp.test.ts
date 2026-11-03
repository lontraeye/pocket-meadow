import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { daycareConfig, daycareXpPerHour } from '../config/daycare.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { trainerConfig } from '../config/trainer.js'
import { applyDaycareHours, levelsGainedFromStay } from './daycare.js'
import { applyCatchUp, energyFullAt, nextEnergyAt, type CatchUpState } from './catchUp.js'

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

  test('energyFullAt: null quando cheia; senão âncora + faltantes × regen', () => {
    assert.equal(energyFullAt(max, now - regen), null)
    assert.equal(energyFullAt(8, 1_000), 1_000 + 2 * regen)
    assert.equal(energyFullAt(0, 500), 500 + max * regen)
    assert.equal(nextEnergyAt(8, 1_000), 1_000 + regen)
    assert.equal(nextEnergyAt(max, 1_000), null)
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
    // O XP por hora é uma fração do XP do próximo nível: sobe junto com o nível.
    assert.ok(daycareXpPerHour(6) > daycareXpPerHour(5))
    const result = applyCatchUp(
      state({ daycare: [{ ...slot, level: 5, xp: 0, lastSettledAt: now - 9 * hour }] }),
      now,
    )
    const expected = applyDaycareHours(5, 0, 9)
    assert.equal(result.daycare[0]?.level, expected.level)
    assert.equal(result.daycare[0]?.xp, expected.xp)
    assert.ok((result.daycare[0]?.level ?? 0) > 5)
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
    // Janela de settledFrom+0,5h a +2,5h: horas com ×1,5, ×2 e ×1,5 (Nv 50, sem subir de nível).
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
    const expected = 2 * daycareXpPerHour(50, 1.5) + daycareXpPerHour(50, 2)
    assert.equal(result.daycare[0]?.xpGained, expected)
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

  test('Nanab que vence no meio da hora fica até essa hora ser liquidada', () => {
    const settledFrom = now - 0.5 * hour
    const nanab = {
      id: 5,
      effectKey: 'daycare_boost',
      multiplier: 2,
      createdAt: settledFrom - 1.5 * hour,
      expiresAt: settledFrom + 0.25 * hour,
    }
    const daycare = [{ ...slot, level: 50, lastSettledAt: settledFrom }]
    // Hora ainda aberta: nada liquida e o efeito não pode sair.
    const early = applyCatchUp(state({ daycare, effects: [nanab] }), now)
    assert.deepEqual(early.daycare, [])
    assert.deepEqual(early.deleteEffectIds, [])

    // Fechada a hora, ela leva 1/4 de bônus e aí o efeito sai.
    const later = applyCatchUp(state({ daycare, effects: [nanab] }), settledFrom + hour)
    assert.equal(later.daycare[0]?.xpGained, Math.floor(daycareXpPerHour(50) * 1.25))
    assert.deepEqual(later.deleteEffectIds, [5])
  })

  test('Nanab vencido sai logo quando o slot já bateu o limite de horas', () => {
    const enteredAt = now - daycareConfig.maxMs - 0.5 * hour
    const result = applyCatchUp(
      state({
        daycare: [{ ...slot, level: 50, enteredAt, lastSettledAt: enteredAt + daycareConfig.maxMs }],
        effects: [{ id: 6, effectKey: 'daycare_boost', multiplier: 2, createdAt: now - 3 * hour, expiresAt: now - hour }],
      }),
      now,
    )
    assert.deepEqual(result.deleteEffectIds, [6])
  })

  test('um dia cheio rende uns 4 níveis em qualquer nível (sem time nem cuidador)', () => {
    for (const start of [5, 50]) {
      const day = applyDaycareHours(start, 0, daycareConfig.maxHours)
      const gained = day.level - start
      assert.ok(gained >= 3 && gained <= 5, `Nv ${start}: +${gained}`)
    }
  })

  test('bônus de alcance: quem está abaixo do time sobe mais rápido, sem passar do time', () => {
    const alone = applyDaycareHours(5, 0, daycareConfig.maxHours)
    const behind = applyDaycareHours(5, 0, daycareConfig.maxHours, 1, {
      context: { teamAverage: 30, teamMax: 32, caretakerMult: 1 },
    })
    assert.ok(behind.level > alone.level + 3, `${behind.level} vs ${alone.level}`)
    // Teto: o nível mais alto do time.
    const capped = applyDaycareHours(5, 0, daycareConfig.maxHours, 1, {
      context: { teamAverage: 30, teamMax: 8, caretakerMult: 1 },
    })
    assert.equal(capped.level, 8)
  })

  test('cuidador multiplica o ganho', () => {
    const base = applyDaycareHours(20, 0, 6)
    const blissey = applyDaycareHours(20, 0, 6, 1, { context: { teamAverage: null, teamMax: null, caretakerMult: 2 } })
    assert.ok(blissey.xpGained > base.xpGained * 1.8)
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

  test('marca como fugidos só os encontros pendentes expirados (sem vitória)', () => {
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
    assert.deepEqual(result.escapeWonEncounterIds, [])
  })

  test('encontro pendente com won_at expirado vira escaped, não fled', () => {
    const result = applyCatchUp(
      state({
        encounters: [
          { id: 1, status: 'pending', expiresAt: now, wonAt: now - hour },
          { id: 2, status: 'pending', expiresAt: now },
        ],
      }),
      now,
    )
    assert.deepEqual(result.escapeWonEncounterIds, [1])
    assert.deepEqual(result.fleeEncounterIds, [2])
  })
})

test('xpToNext segue floor(10 * nível^1.5)', () => {
  assert.equal(xpToNext(1), 10)
  assert.equal(xpToNext(5), 111)
  assert.equal(xpToNext(100), 10000)
})
