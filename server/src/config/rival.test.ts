import assert from 'node:assert/strict'
import test from 'node:test'
import { placeBySlug } from './places.js'
import { rivalFightOfKey, rivalFights, rivalLineFor, rivalTrainerKey } from './rival.js'
import { trainerConfig } from './trainer.js'
import { checkTrainers, trainerByKey } from './trainers.js'

test('rival: cada luta fica num lugar que existe, do capítulo dela ou antes', () => {
  for (const fight of rivalFights) {
    const place = placeBySlug(fight.place)
    assert.ok(place, `${fight.key}: lugar ${fight.place}`)
    assert.ok(place.chapter <= fight.chapter, `${fight.key}: ${fight.place} abre no cap. ${place.chapter}`)
  }
})

test('rival: começa com o inicial que vence o do jogador', () => {
  const { chikorita, cyndaquil, totodile } = trainerConfig.starters
  const aceOf = (starter: number) =>
    trainerByKey(rivalTrainerKey('rival-1', rivalLineFor(starter)))!.foes.at(-1)!.speciesId
  assert.equal(aceOf(chikorita), cyndaquil)
  assert.equal(aceOf(cyndaquil), totodile)
  assert.equal(aceOf(totodile), chikorita)
  // Sem inicial conhecido (conta antiga): fogo.
  assert.equal(rivalLineFor(null), 'fire')
})

test('rival: as variações passam no boot e voltam para a luta certa', () => {
  assert.doesNotThrow(() => checkTrainers())
  assert.equal(trainerByKey('rival-3/water')?.kind, 'rival')
  assert.equal(rivalFightOfKey('rival-3/water')?.key, 'rival-3')
  assert.equal(trainerByKey('rival-3'), undefined)
})
