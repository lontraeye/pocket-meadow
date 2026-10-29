import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { BATTLE_XP_DIV, BATTLE_XP_LEVEL_EXP, battleConfig } from '../config/battle.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { trainerCatchXp, trainerWinXp, trainerXpToNext } from '../config/trainer.js'
import {
  applyRareWeights,
  battleXp,
  battleXpSharers,
  catchChance,
  fighterXp,
  power,
  rollChance,
  rollWild,
  skipWildRolls,
  teamPower,
  winChance,
} from './battle.js'
import { rollBattleSeed } from './berries.js'
import { mulberry32 } from './rng.js'
import { grantXp } from './xp.js'

const demo = {
  slots: [
    { speciesId: 16, weight: 40, minLevel: 2, maxLevel: 6 },
    { speciesId: 25, weight: 5, minLevel: 2, maxLevel: 6 },
  ],
  shinyRate: battleConfig.shinyRate,
}

function take(seed: number, count: number): number[] {
  const rng = mulberry32(seed)
  return Array.from({ length: count }, () => rng())
}

describe('rng', () => {
  test('mulberry32 da seed 1 começa nesta sequência', () => {
    assert.deepEqual(take(1, 3), [0.6270739405881613, 0.002735721180215478, 0.5274470399599522])
  })

  test('a mesma seed repete; outra seed diverge', () => {
    assert.deepEqual(take(1, 4), take(1, 4))
    assert.deepEqual(take(3_000_000_000, 3), take(3_000_000_000, 3))
    assert.notEqual(take(1, 1)[0], take(2, 1)[0])
  })
})

describe('rolagens do encontro', () => {
  test('a ordem é slot, nível, shiny, batalha, captura', () => {
    const draws = [0.5, 0, 0, 0.1, 0.1]
    let index = 0
    const rng = () => draws[index++] ?? 1
    const wild = rollWild(rng, {
      slots: [
        { speciesId: 16, weight: 1, minLevel: 2, maxLevel: 5 },
        { speciesId: 25, weight: 1, minLevel: 2, maxLevel: 5 },
      ],
      shinyRate: 0.5,
    })
    assert.deepEqual(wild, { speciesId: 25, level: 2, isShiny: true })
    assert.equal(rollChance(0.5, rng), true)
    assert.equal(rollChance(0.05, rng), false)
    assert.equal(index, 5)
  })

  test('a mesma seed gera o mesmo selvagem, batalha, captura e semente', () => {
    const seed = 0xabcde
    const play = () => {
      const rng = mulberry32(seed)
      const wild = rollWild(rng, demo)
      const won = rollChance(0.42, rng)
      const caught = rollChance(0.8, rng)
      const drop = won ? rollBattleSeed(rng) : null
      return { wild, won, caught, drop }
    }
    assert.deepEqual(play(), play())

    const left = mulberry32(seed)
    rollWild(left, demo)
    const right = mulberry32(seed)
    skipWildRolls(right)
    assert.equal(left(), right())
  })

  test('shiny e o bônus de raro não mudam a posição da rolagem de batalha', () => {
    const seed = 99
    const low = rollWild(mulberry32(seed), { ...demo, shinyRate: 0 })
    const high = rollWild(mulberry32(seed), { ...demo, shinyRate: 1 })
    assert.equal(low.speciesId, high.speciesId)
    assert.equal(low.level, high.level)
    assert.equal(low.isShiny, false)
    assert.equal(high.isShiny, true)

    const narrow = rollWild(mulberry32(seed), {
      slots: demo.slots.map((slot) => ({ ...slot, minLevel: 2, maxLevel: 2 })),
      shinyRate: demo.shinyRate,
    })
    const wide = rollWild(mulberry32(seed), {
      slots: demo.slots.map((slot) => ({ ...slot, minLevel: 9, maxLevel: 9 })),
      shinyRate: demo.shinyRate,
    })
    assert.equal(narrow.speciesId, wide.speciesId)
    assert.equal(narrow.level, 2)
    assert.equal(wide.level, 9)

    const boosted = mulberry32(seed)
    rollWild(boosted, { ...demo, rareMultiplier: 2, shinyRate: 1 })
    const skipped = mulberry32(seed)
    skipWildRolls(skipped)
    assert.equal(boosted(), skipped())
  })

  test('o bônus de raro dobra só espécies com peso até RARE_WEIGHT_MAX', () => {
    const boosted = applyRareWeights(
      [
        { speciesId: 16, weight: 50 },
        { speciesId: 19, weight: 20 },
        { speciesId: 25, weight: 10 },
        { speciesId: 10, weight: 5 },
      ],
      2,
    )
    assert.deepEqual(
      boosted.map((spawn) => spawn.weight),
      [50, 20, 20, 10],
    )
  })
})

describe('batalha', () => {
  test('Mewtwo nv 70 contra três nv 40 de BST 500 fica em torno de 42%, e sozinho no mínimo de 5%', () => {
    const wild = power(680, 70)
    const ally = power(500, 40)
    assert.equal(wild, 5440)
    assert.equal(ally, 2500)
    assert.equal(teamPower([ally, ally, ally]), 5000)
    assert.equal(teamPower([ally]), 2500)
    const trio = winChance(teamPower([ally, ally, ally]), wild)
    assert.ok(Math.abs(trio - 0.42) < 0.01, `trio ${trio}`)
    assert.equal(winChance(teamPower([ally]), wild), battleConfig.minChance)
  })

  test('poderes iguais dão 50%, e os extremos ficam no clamp', () => {
    assert.equal(winChance(1000, 1000), 0.5)
    assert.equal(winChance(1, 1_000_000), battleConfig.minChance)
    assert.equal(winChance(1_000_000, 1), battleConfig.maxChance)
  })

  test('o poder do time ordena do maior para o menor antes dos pesos', () => {
    assert.equal(teamPower([100, 400, 250]), 400 * 1 + 250 * 0.6 + 100 * 0.4)
    assert.equal(teamPower([100, 400, 250]), teamPower([400, 100, 250]))
  })

  test('constantes iniciais da batalha e da captura', () => {
    assert.equal(battleConfig.shinyRate, 1 / 512)
    assert.equal(battleConfig.encounterTtlMs, 30 * 60 * 1000)
    assert.deepEqual(battleConfig.teamWeights, [1, 0.6, 0.4])
    assert.equal(battleConfig.xpDiv, BATTLE_XP_DIV)
    assert.equal(battleConfig.xpLevelExp, BATTLE_XP_LEVEL_EXP)
    assert.equal(catchChance(255), 1)
    assert.equal(catchChance(3), battleConfig.catchMin)
    assert.equal(catchChance(45), (45 / 255) * battleConfig.catchMult)
    assert.equal(catchChance(45, 1.5), (45 / 255) * battleConfig.catchMult * 1.5)
    assert.equal(catchChance(255, 4), 1)
  })
})

describe('xp', () => {
  test('o XP de batalha segue os exemplos da seção 5.5 e divide por quem recebe', () => {
    assert.equal(battleXp(50, 3, 5), 23)
    assert.equal(battleXp(50, 3, 30), 3)
    assert.equal(battleXp(112, 4, 5), 79)
    assert.equal(battleXp(49, 8, 6), 96)
    assert.equal(battleXp(395, 10, 10), 791)
    assert.equal(fighterXp(50, 3, 5, 1), 23)
    assert.equal(fighterXp(50, 3, 5, 2), 11)
    assert.equal(xpToNext(5), 111)
    assert.equal(xpToNext(30), 1643)
    assert.equal(xpToNext(6), 146)
    assert.equal(xpToNext(10), 316)
  })

  test('só quem entrou e não desmaiou divide o XP', () => {
    assert.deepEqual(battleXpSharers([0, 1], []), [0, 1])
    assert.deepEqual(battleXpSharers([0, 1], [0]), [1])
    assert.deepEqual(battleXpSharers([0], [0]), [])
    // Bench (slot 2 nunca entrou) não aparece, mesmo sem KO.
    assert.deepEqual(battleXpSharers([0], [1]), [0])
  })

  test('level up reaproveita xpToNext e pode subir mais de um nível', () => {
    assert.equal(xpToNext(1), 10)
    assert.deepEqual(grantXp(1, 5, 6), { level: 2, xp: 1, levelsGained: 1 })
    assert.deepEqual(grantXp(1, 0, xpToNext(1) + xpToNext(2)), { level: 3, xp: 0, levelsGained: 2 })
  })

  test('não passa do nível máximo', () => {
    const cap = progressConfig.levelCap
    assert.deepEqual(grantXp(cap, 0, 100), { level: cap, xp: 0, levelsGained: 0 })
    const capped = grantXp(cap - 1, xpToNext(cap - 1) - 1, 5)
    assert.deepEqual({ level: capped.level, xp: capped.xp }, { level: cap, xp: 0 })
  })

  test('a curva do treinador segue floor(30 * nível^1.7)', () => {
    assert.equal(trainerXpToNext(1), 30)
    assert.equal(trainerXpToNext(2), 97)
    assert.equal(trainerWinXp(4), 16)
    assert.equal(trainerCatchXp(4), 14)
  })
})
