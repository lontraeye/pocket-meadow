import assert from 'node:assert/strict'
import test from 'node:test'
import { leaderConfigs } from './leaders.js'
import { checkTrainers, trainerByKey, type TrainerConfig } from './trainers.js'

const sample = leaderConfigs[0]!.foes[0]!

function fake(patch: Partial<TrainerConfig['foes'][number]>): TrainerConfig {
  return {
    key: 'boot-fake',
    name: 'Falso',
    kind: 'leader',
    foes: [{ ...sample, ...patch }],
  }
}

test('boot: os treinadores do config têm espécie e golpes válidos', () => {
  assert.doesNotThrow(() => checkTrainers())
  assert.equal(trainerByKey('violet')?.kind, 'leader')
  assert.equal(trainerByKey('nao-existe'), undefined)
})

test('boot: espécie ou golpe errado falha', () => {
  assert.throws(() => checkTrainers([fake({ speciesId: 999_999 })]), /species 999999/)
  assert.throws(() => checkTrainers([fake({ fastMove: 'nao-existe' })]), /fast move nao-existe/)
  assert.throws(() => checkTrainers([fake({ fastMove: 'hydro-pump' })]), /fast move hydro-pump/)
  assert.throws(() => checkTrainers([fake({ chargedMove: 'tackle' })]), /charged move tackle/)
})
