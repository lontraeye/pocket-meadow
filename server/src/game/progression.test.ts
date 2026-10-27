import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { progressConfig, xpToNext } from '../config/progress.js'
import { CANDY_XP, EVOLVE_XP_BY_STAGE, evolveTrainerXp } from '../config/progression.js'
import { dosesToCap, evolutionBlock, parseNickname, planFeed, planRelease, releaseCandies } from './progression.js'

const owned = [
  { id: 1, location: 'garden' as const, level: 5, isShiny: false, evolutionChainId: 10 },
  { id: 2, location: 'garden' as const, level: 8, isShiny: true, evolutionChainId: 10 },
  { id: 3, location: 'daycare' as const, level: 4, isShiny: false, evolutionChainId: 16 },
]

describe('soltura', () => {
  test('doce da linha cresce com o nível e o shiny triplica; o genérico não', () => {
    assert.deepEqual(releaseCandies(4, false), { chain: 3, generic: 1 })
    assert.deepEqual(releaseCandies(5, false), { chain: 4, generic: 1 })
    assert.deepEqual(releaseCandies(5, true), { chain: 12, generic: 1 })
    assert.deepEqual(releaseCandies(10, false), { chain: 5, generic: 1 })
  })

  test('o lote é tudo ou nada: daycare, desconhecido ou último Pokémon', () => {
    const ok = planRelease([1], owned)
    assert.equal(ok.ok, true)
    if (ok.ok) assert.deepEqual(ok.releases[0], { id: 1, evolutionChainId: 10, chain: 4, generic: 1 })

    const daycare = planRelease([3], owned)
    assert.deepEqual(daycare, { ok: false, error: 'in_daycare', pokemonId: 3 })

    const missing = planRelease([9], owned)
    assert.deepEqual(missing, { ok: false, error: 'pokemon_not_found', pokemonId: 9 })

    const last = planRelease([1, 2], owned.filter((mon) => mon.id !== 3))
    assert.deepEqual(last, { ok: false, error: 'last_pokemon' })

    const blocked = planRelease([1, 2, 3], owned)
    assert.equal(blocked.ok, false)
    if (!blocked.ok) assert.equal(blocked.error, 'in_daycare')

    assert.equal(planRelease([], owned).ok, false)
    assert.equal(planRelease([1, 1], owned).ok, false)
  })
})

describe('alimentação', () => {
  test('cada dose dá CANDY_XP e não passa do nível máximo', () => {
    const one = planFeed(5, 0, 1)
    assert.deepEqual(one, { ok: true, doses: 1, xpGained: CANDY_XP, level: 5, xp: CANDY_XP, levelsGained: 0 })

    const leveled = planFeed(5, 0, 5)
    assert.equal(leveled.ok, true)
    if (leveled.ok) {
      assert.equal(leveled.xpGained, 5 * CANDY_XP)
      assert.equal(leveled.level, 6)
      assert.equal(leveled.xp, 5 * CANDY_XP - xpToNext(5))
      assert.equal(leveled.levelsGained, 1)
    }
  })

  test('consome só as doses que cabem até o nível máximo', () => {
    const cap = progressConfig.levelCap
    const almost = planFeed(cap - 1, xpToNext(cap - 1) - 1, 5)
    assert.equal(almost.ok, true)
    if (almost.ok) {
      assert.equal(almost.doses, 1)
      assert.equal(almost.level, cap)
      assert.equal(almost.xp, 0)
      assert.equal(dosesToCap(cap - 1, xpToNext(cap - 1) - 1), 1)
    }
    assert.deepEqual(planFeed(cap, 0, 1), { ok: false, error: 'level_cap' })
    assert.equal(planFeed(5, 0, 0).ok, false)
  })
})

describe('evolução e apelido', () => {
  test('evoluir exige o nível mínimo e o XP do treinador segue o estágio', () => {
    assert.deepEqual(evolutionBlock(15, 16), { ok: false, error: 'level_too_low', min: 16 })
    assert.deepEqual(evolutionBlock(16, 16), { ok: true })
    assert.equal(evolveTrainerXp(2), EVOLVE_XP_BY_STAGE[2])
    assert.equal(evolveTrainerXp(3), EVOLVE_XP_BY_STAGE[3])
    assert.equal(evolveTrainerXp(1), 0)
  })

  test('apelido aparado, vazio volta ao nome, e controle não passa', () => {
    assert.deepEqual(parseNickname('  Brasa '), { ok: true, nickname: 'Brasa' })
    assert.deepEqual(parseNickname('   '), { ok: true, nickname: null })
    assert.deepEqual(parseNickname(null), { ok: true, nickname: null })
    assert.equal(parseNickname('a'.repeat(13)).ok, false)
    assert.equal(parseNickname('oi\nla').ok, false)
    assert.equal(parseNickname(4).ok, false)
  })
})
