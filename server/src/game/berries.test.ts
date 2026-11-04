import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  SEED_DROP_CHANCE,
  bushDeathChance,
  UPROOT_SEED_RETURN_CHANCE,
  berries,
  getBerry,
  trainerLevelRewards,
} from '../config/berries.js'
import { mulberry32 } from './rng.js'
import {
  applyEnergyBerry,
  planBerryUse,
  planClear,
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
  test('o yield fica no intervalo do config (só berries)', () => {
    const berry = berries.oran
    const [min, max] = berry.yield
    const low = planHarvest(berry, { yieldUnit: 0 })
    assert.equal(low.berryAmount, min)
    assert.deepEqual(low.credits.map((row) => row.itemKey), ['berry:oran'])
    const high = planHarvest(berry, { yieldUnit: 0.999 })
    assert.equal(high.berryAmount, max)
  })

  test('arbusto: as primeiras colheitas são garantidas e a chance de secar cresce', () => {
    assert.equal(bushDeathChance(1), 0)
    assert.equal(bushDeathChance(2), 0)
    assert.equal(bushDeathChance(3), 0.2)
    assert.ok(Math.abs(bushDeathChance(4) - 0.35) < 1e-9)
    assert.equal(bushDeathChance(20), 1)
  })

  test('limpar o arbusto seco dá 0, 1 ou 2 sementes pelos pesos', () => {
    assert.deepEqual(planClear('oran', 0), { seeds: 0, credits: [] })
    assert.deepEqual(planClear('oran', 0.5), { seeds: 1, credits: [{ itemKey: 'seed:oran', quantity: 1 }] })
    assert.equal(planClear('oran', 0.99).seeds, 2)
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
    assert.equal(pinap.ok, false)
    if (!pinap.ok) assert.equal(pinap.error, 'berry_not_usable')

    const razz = planBerryUse(berries.razz, { energy: 5, energyUpdatedAt: 1, hasSameEffect: true }, 50)
    assert.equal(razz.ok, true)
    if (razz.ok) {
      assert.equal(razz.apply.kind, 'replace_effect')
      if (razz.apply.kind === 'replace_effect') {
        assert.equal(razz.apply.effectKey, 'rare_boost')
        assert.equal(razz.apply.renewed, true)
        assert.equal(razz.apply.charges, 1)
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
      { itemKey: 'mat:apricorn', quantity: 8 },
      { itemKey: 'mat:apricorn-blue', quantity: 2 },
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
})
