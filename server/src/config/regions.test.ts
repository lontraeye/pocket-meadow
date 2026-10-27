import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { regionStatus, regions } from './regions.js'

describe('regiões', () => {
  test('o status público não leva a tabela de spawn', () => {
    const route = regions.find((region) => region.slug === 'route-1')
    assert.ok(route)
    const status = regionStatus(route, 1)
    assert.deepEqual(Object.keys(status).sort(), ['minTrainerLevel', 'name', 'slug', 'unlocked', 'wildLevelRange'])
    assert.equal(status.unlocked, true)
    assert.deepEqual(status.wildLevelRange, route.wildLevelRange)
  })

  test('nível 1 abre a Rota 1, nível 3 a floresta e nível 6 a Rota 30', () => {
    const open = (level: number) =>
      regions.filter((region) => regionStatus(region, level).unlocked).map((region) => region.slug)
    assert.deepEqual(open(1), ['route-1'])
    assert.deepEqual(open(3), ['route-1', 'viridian-forest'])
    assert.deepEqual(open(6), ['route-1', 'viridian-forest', 'route-30'])
  })

  test('só espécies da geração 1 e 2, com peso positivo', () => {
    for (const region of regions) {
      assert.ok(region.spawns.length > 0)
      for (const spawn of region.spawns) {
        assert.ok(spawn.speciesId >= 1 && spawn.speciesId <= 251)
        assert.ok(spawn.weight > 0)
      }
    }
  })
})
