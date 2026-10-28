import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  SEED_DROP_CHANCE,
  SEED_EXTRA_CHANCE,
  UPROOT_SEED_RETURN_CHANCE,
  berries,
  getBerry,
  plotSlotsUnlocked,
  nextPlotSlotLevel,
  trainerLevelRewards,
} from '../config/berries.js'
import { mulberry32 } from './rng.js'
import {
  applyEnergyBerry,
  planBerryUse,
  planHarvest,
  planUproot,
  pickSeedByWeight,
  rewardsForLevelsGained,
  rollBattleSeed,
} from './berries.js'

describe('arrancar', () => {
  test('a semente volta só abaixo da chance', () => {
    assert.deepEqual(planUproot('oran', 0), { seedReturned: true, credits: [{ itemKey: 'seed:oran', quantity: 1 }] })
    assert.deepEqual(planUproot('oran', UPROOT_SEED_RETURN_CHANCE - 0.001).seedReturned, true)
    assert.deepEqual(planUproot('oran', UPROOT_SEED_RETURN_CHANCE), { seedReturned: false, credits: [] })
  })
})

describe('colheita', () => {
  test('o yield fica no intervalo e a semente extra respeita a chance', () => {
    const berry = berries.oran
    const low = planHarvest(berry, { yieldUnit: 0, extraSeed: 0.99 })
    assert.equal(low.berryAmount, 2)
    assert.equal(low.seedAmount, 1)
    const high = planHarvest(berry, { yieldUnit: 0.999, extraSeed: SEED_EXTRA_CHANCE - 0.001 })
    assert.equal(high.berryAmount, 3)
    assert.equal(high.seedAmount, 2)
    assert.deepEqual(high.credits.map((row) => row.itemKey), ['berry:oran', 'seed:oran'])
  })
})

describe('usar berry', () => {
  test('Oran soma energia até o teto e recusa com energia cheia', () => {
    const now = 1_000
    const ok = applyEnergyBerry(8, 100, 2, now, 10)
    assert.deepEqual(ok, { ok: true, energy: 10, energyUpdatedAt: now, gained: 2 })
    const mid = applyEnergyBerry(5, 100, 2, now, 10)
    assert.deepEqual(mid, { ok: true, energy: 7, energyUpdatedAt: 100, gained: 2 })
    assert.deepEqual(applyEnergyBerry(10, 100, 2, now, 10), { ok: false, error: 'energy_full' })
  })

  test('efeito por cargas ou tempo renova o mesmo effect_key', () => {
    const pinap = planBerryUse(berries.pinap, { energy: 5, energyUpdatedAt: 1, hasSameEffect: true }, 50)
    assert.equal(pinap.ok, true)
    if (pinap.ok) {
      assert.equal(pinap.apply.kind, 'replace_effect')
      if (pinap.apply.kind === 'replace_effect') {
        assert.equal(pinap.apply.effectKey, 'catch_boost')
        assert.equal(pinap.apply.renewed, true)
        assert.equal(pinap.apply.charges, 1)
      }
    }
    const nanab = planBerryUse(berries.nanab, { energy: 5, energyUpdatedAt: 1, hasSameEffect: false }, 1_000)
    assert.equal(nanab.ok, true)
    if (nanab.ok && nanab.apply.kind === 'replace_effect') {
      assert.equal(nanab.apply.effectKey, 'daycare_boost')
      assert.equal(nanab.apply.expiresAt, 1_000 + 2 * 60 * 60 * 1000)
      assert.equal(nanab.apply.renewed, false)
    }
  })
})

describe('recompensas e sementes', () => {
  test('sobe vários níveis e soma as recompensas de cada um', () => {
    const rewards = rewardsForLevelsGained(1, 5, () => 'lum')
    assert.deepEqual(rewards, [
      { itemKey: 'ball:great', quantity: 3 },
      { itemKey: 'ball:poke', quantity: 20 },
      { itemKey: 'seed:nanab', quantity: 1 },
      { itemKey: 'seed:oran', quantity: 4 },
      { itemKey: 'seed:razz', quantity: 1 },
    ])
    assert.ok(trainerLevelRewards(10).some((row) => 'kind' in row && row.kind === 'random_seed'))
  })

  test('a semente da batalha usa a chance e os pesos do config', () => {
    const miss = rollBattleSeed(() => SEED_DROP_CHANCE)
    assert.equal(miss, null)
    const hit = rollBattleSeed(mulberry32(1))
    // Com seed 1 a primeira rolagem é < 0.1 neste PRNG; só checamos forma.
    if (hit) {
      assert.ok(hit.itemKey.startsWith('seed:'))
      assert.ok(getBerry(hit.berryKey))
    }
    const key = pickSeedByWeight(mulberry32(42))
    assert.ok(getBerry(key))
  })

  test('canteiros: 2 no nível 1, o 3º no 8 e o 4º no 20', () => {
    assert.equal(plotSlotsUnlocked(1), 2)
    assert.equal(nextPlotSlotLevel(1), 8)
    assert.equal(plotSlotsUnlocked(8), 3)
    assert.equal(nextPlotSlotLevel(8), 20)
    assert.equal(plotSlotsUnlocked(20), 4)
    assert.equal(nextPlotSlotLevel(20), null)
  })
})
