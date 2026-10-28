import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isChargedMove } from '../game/traits.js'
import { readSpeciesSnapshot } from './apply.js'
import { learnsetFor, movesByName, speciesLearnset } from './traitsData.js'

const moves = movesByName()

function firstChargedLevel(speciesId: number): number {
  for (const entry of learnsetFor(speciesId)) {
    const info = moves.get(entry.move)
    if (info && isChargedMove(info.power)) return entry.level
  }
  return Number.POSITIVE_INFINITY
}

test('o pool inclui os golpes das pré-evoluções, no menor nível da linha', () => {
  // Ninetales não aprende carregado por nível; a Vulpix aprende Flamethrower.
  assert.equal(speciesLearnset(38).some((entry) => entry.move === 'flamethrower'), false)
  assert.ok(learnsetFor(38).some((entry) => entry.move === 'flamethrower'))
  // Charmeleon aprende Slash no 33; o Charmander, no 30.
  assert.equal(learnsetFor(5).find((entry) => entry.move === 'slash')?.level, 30)
})

test('o pool não repete golpe e segue ordenado por nível', () => {
  const pool = learnsetFor(5)
  assert.equal(new Set(pool.map((entry) => entry.move)).size, pool.length)
  for (let i = 1; i < pool.length; i += 1) assert.ok(pool[i - 1]!.level <= pool[i]!.level)
})

test('nenhuma evolução tira o golpe carregado que a pré-evolução já tinha', () => {
  // Se a pré-evolução já conhece um carregado no nível em que evolui, a espécie
  // nova também conhece: o sorteio na evolução nunca deixa o slot vazio.
  for (const evolution of readSpeciesSnapshot().evolutions) {
    const before = firstChargedLevel(evolution.fromSpeciesId)
    const after = firstChargedLevel(evolution.toSpeciesId)
    assert.ok(after <= before, `${evolution.fromSpeciesId}→${evolution.toSpeciesId}: ${before} → ${after}`)
  }
})
