import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBattleSetup } from './encounterBattle.js'
import { mulberry32 } from './mulberry32.js'
import { wildTraitsSeed } from './sim/seeds.js'
import { rollTraits } from './traits.js'
import { abilitiesFor, learnsetFor, movesByName } from '../seed/traitsData.js'

test('traços do selvagem na luta = traços da captura (mesma seed)', () => {
  const encounterSeed = 0xcafebabe
  const moves = movesByName()
  const speciesId = 16
  const level = 4
  const traits = rollTraits(mulberry32(wildTraitsSeed(encounterSeed)), {
    level,
    learnset: learnsetFor(speciesId),
    abilities: abilitiesFor(speciesId),
    moves,
  })
  const built = buildBattleSetup({
    team: [
      {
        id: 1,
        speciesId: 1,
        level: 5,
        type1: 'grass',
        type2: 'poison',
        hp: 45,
        attack: 49,
        defense: 49,
        spAttack: 65,
        spDefense: 65,
        speed: 45,
        ivHp: 15,
        ivAttack: 15,
        ivDefense: 15,
        ivSpAttack: 15,
        ivSpDefense: 15,
        ivSpeed: 15,
        evHp: 0,
        evAttack: 0,
        evDefense: 0,
        evSpAttack: 0,
        evSpDefense: 0,
        evSpeed: 0,
        nature: 'hardy',
        abilitySlot: '1',
        fastMove: 'tackle',
        chargedMove: null,
      },
    ],
    wild: {
      id: speciesId,
      type1: 'normal',
      type2: 'flying',
      hp: 40,
      attack: 45,
      defense: 40,
      spAttack: 35,
      spDefense: 35,
      speed: 56,
      evHp: 0,
      evAttack: 0,
      evDefense: 0,
      evSpAttack: 0,
      evSpDefense: 0,
      evSpeed: 1,
    },
    wildLevel: level,
    encounterSeed,
    abilitiesFor,
    learnsetFor,
    moves,
  })
  const wild = built.setup.wild
  assert.equal(wild.fastMove.name, traits.fastMove)
  assert.equal(wild.chargedMove?.name ?? null, traits.chargedMove)
  assert.equal(wild.level, level)
  // Re-rolar com a mesma seed reproduz o indivíduo capturado.
  const again = rollTraits(mulberry32(wildTraitsSeed(encounterSeed)), {
    level,
    learnset: learnsetFor(speciesId),
    abilities: abilitiesFor(speciesId),
    moves,
  })
  assert.deepEqual(again, traits)
})
