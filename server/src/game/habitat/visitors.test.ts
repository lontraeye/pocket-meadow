import assert from 'node:assert/strict'
import test from 'node:test'
import type { Region } from '../../config/regions.js'
import { rollVisitor, visitorPool, type VisitorSpecies } from './visitors.js'

// Uma área de mato do capítulo 1 e uma caverna do capítulo 2 (pesos somam 100).
const regions = [
  {
    slug: 'rota',
    name: 'Rota',
    gameRegion: 'johto',
    chapter: 1,
    minTrainerLevel: 1,
    sources: [],
    slots: [
      { speciesId: 74, minLevel: 3, maxLevel: 5, weight: 60 }, // Geodude, comum
      { speciesId: 95, minLevel: 4, maxLevel: 4, weight: 5 }, // Onix, raro aqui
      { speciesId: 16, minLevel: 2, maxLevel: 4, weight: 35 }, // Pidgey
    ],
    methods: {},
    wildLevelRange: [2, 5],
  },
  {
    slug: 'caverna',
    name: 'Caverna',
    gameRegion: 'johto',
    chapter: 2,
    minTrainerLevel: 1,
    sources: [],
    slots: [
      { speciesId: 95, minLevel: 8, maxLevel: 9, weight: 50 }, // Onix, comum mas captura 45
      { speciesId: 67, minLevel: 30, maxLevel: 32, weight: 20 }, // Machoke, acima do teto
      { speciesId: 74, minLevel: 6, maxLevel: 8, weight: 30 },
    ],
    methods: {},
    wildLevelRange: [6, 32],
  },
] as unknown as Region[]

const species: VisitorSpecies[] = [
  { id: 74, type1: 'rock', type2: 'ground', captureRate: 255, isLegendary: false, isMythical: false },
  { id: 95, type1: 'rock', type2: 'ground', captureRate: 45, isLegendary: false, isMythical: false },
  { id: 16, type1: 'normal', type2: 'flying', captureRate: 255, isLegendary: false, isMythical: false },
  { id: 67, type1: 'fighting', type2: null, captureRate: 90, isLegendary: false, isMythical: false },
]

test('só vem quem é do tipo, das áreas abertas, comum e fácil de capturar', () => {
  const first = visitorPool('rochedo', 1, regions, species)
  assert.deepEqual(first.entries.map((entry) => entry.speciesId), [74])
  assert.deepEqual(first.excluded, [{ speciesId: 95, reason: 'raro nas rotas' }])

  // No capítulo 2 o Onix é comum na caverna, mas difícil de capturar; o Machoke passa do teto.
  const second = visitorPool('rochedo', 2, regions, species)
  assert.deepEqual(second.entries.map((entry) => entry.speciesId), [74])
  assert.deepEqual(
    second.excluded.map((row) => row.reason),
    [`Nv 30 > ${second.levelCap}`, 'captura 45'],
  )
  assert.deepEqual(visitorPool('pradaria', 1, regions, species).entries.map((entry) => entry.speciesId), [16])
  assert.deepEqual(visitorPool('basico', 2, regions, species).entries, [])
})

test('o nível fica entre o mais baixo das rotas e o teto do capítulo', () => {
  const pool = visitorPool('rochedo', 2, regions, species)
  const geodude = pool.entries[0]!
  assert.equal(geodude.minLevel, 3)
  assert.equal(geodude.maxLevel, Math.min(8, pool.levelCap))
  assert.deepEqual(rollVisitor(pool, () => 0), { speciesId: 74, level: 3 })
  assert.deepEqual(rollVisitor(pool, () => 0.999), { speciesId: 74, level: geodude.maxLevel })
  assert.equal(rollVisitor({ entries: [], excluded: [], levelCap: 5 }, () => 0), null)
})
