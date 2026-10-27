import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSpeciesSnapshot } from '../seed/apply.js'
import { isPokemonType, pokemonTypes, typeEffectiveness } from './types.js'

test('todo tipo que aparece em species tem linha e coluna na tabela de efetividade', () => {
  const used = new Set<string>()
  for (const row of readSpeciesSnapshot().species) {
    used.add(row.type1)
    if (row.type2) used.add(row.type2)
  }
  for (const type of used) {
    assert.ok(isPokemonType(type), `tipo desconhecido em species: ${type}`)
    assert.ok(type in typeEffectiveness, `falta linha para ${type}`)
    for (const defender of pokemonTypes) {
      assert.equal(typeof typeEffectiveness[type][defender], 'number', `${type}→${defender}`)
    }
    for (const attacker of pokemonTypes) {
      assert.equal(typeof typeEffectiveness[attacker][type], 'number', `${attacker}→${type}`)
    }
  }
})

test('a tabela cobre os 18 tipos em ambas as direções', () => {
  assert.equal(pokemonTypes.length, 18)
  for (const attacker of pokemonTypes) {
    assert.equal(Object.keys(typeEffectiveness[attacker]).length, 18)
    for (const defender of pokemonTypes) {
      const factor = typeEffectiveness[attacker][defender]
      assert.ok([0, 0.5, 1, 2].includes(factor), `${attacker}→${defender}=${factor}`)
    }
  }
})
