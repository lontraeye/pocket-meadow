import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { applyRareWeights, rollWild } from '../game/battle.js'
import { slotsFromArea, slotsFromSources, type LocationArea, readRegionsSnapshot } from '../seed/regionTable.js'
import { RARE_WEIGHT_MAX } from './battle.js'
import { loadRegions, methodSlots, regionBySlug, regionConfigs, regionSpecies, regionStatus } from './regions.js'

const morningOnly = (chance: number, min: number, max: number) => ({
  min_level: min,
  max_level: max,
  chance,
  method: { name: 'walk' },
  condition_values: [{ name: 'time-morning' }],
})

const allDay = (chance: number, min: number, max: number) => ({
  min_level: min,
  max_level: max,
  chance,
  method: { name: 'walk' },
  condition_values: [] as { name: string }[],
})

const sampleArea: LocationArea = {
  pokemon_encounters: [
    {
      pokemon: { name: 'pidgey', url: 'https://pokeapi.co/api/v2/pokemon/16/' },
      version_details: [
        {
          version: { name: 'crystal' },
          encounter_details: [morningOnly(30, 2, 3), allDay(30, 7, 7)],
        },
        {
          version: { name: 'gold' },
          encounter_details: [allDay(90, 2, 2)],
        },
      ],
    },
    {
      pokemon: { name: 'rattata', url: 'https://pokeapi.co/api/v2/pokemon/19/' },
      version_details: [
        {
          version: { name: 'crystal' },
          encounter_details: [allDay(30, 2, 3)],
        },
      ],
    },
    {
      pokemon: { name: 'poliwag', url: 'https://pokeapi.co/api/v2/pokemon/60/' },
      version_details: [
        {
          version: { name: 'crystal' },
          encounter_details: [
            {
              min_level: 15,
              max_level: 20,
              chance: 100,
              method: { name: 'surf' },
              condition_values: [],
            },
          ],
        },
      ],
    },
    {
      pokemon: { name: 'meowth', url: 'https://pokeapi.co/api/v2/pokemon/52/' },
      version_details: [
        {
          version: { name: 'crystal' },
          encounter_details: [
            {
              min_level: 5,
              max_level: 5,
              chance: 100,
              method: { name: 'walk' },
              condition_values: [{ name: 'swarm' }],
            },
          ],
        },
      ],
    },
    {
      pokemon: { name: 'pikachu', url: 'https://pokeapi.co/api/v2/pokemon/25/' },
      version_details: [
        {
          version: { name: 'gold' },
          encounter_details: [allDay(50, 2, 2)],
        },
      ],
    },
  ],
}

describe('regiões', () => {
  test('o status público não leva a tabela de spawn', () => {
    const route = loadRegions().find((region) => region.slug === 'route-1')
    assert.ok(route)
    const status = regionStatus(route, { level: 1, cleared: new Set(), teamTypes: new Set() })
    assert.deepEqual(Object.keys(status).sort(), [
      'chapter',
      'gameRegion',
      'minTrainerLevel',
      'name',
      'slug',
      'unlocked',
      'wildLevelRange',
    ])
    assert.equal(status.gameRegion, 'kanto')
    assert.equal(status.unlocked, true)
    assert.deepEqual(status.wildLevelRange, route.wildLevelRange)
    assert.equal('slots' in status, false)
  })

  test('Johto abre por marco (não por nível); Kanto continua por nível', () => {
    const open = (level: number, cleared: string[]) =>
      loadRegions()
        .filter((region) => regionStatus(region, { level, cleared: new Set(cleared), teamTypes: new Set() }).unlocked)
        .map((region) => region.slug)
    const chapter1 = ['route-29', 'route-46', 'route-30', 'route-31', 'sprout-tower', 'dark-cave-violet']
    const chapter2 = ['route-32', 'ruins-of-alph', 'union-cave', 'slowpoke-well', 'route-33']
    assert.deepEqual(open(1, []), ['route-1', ...chapter1])
    // Nível alto sem marco não abre o capítulo 2.
    assert.deepEqual(open(20, []), ['route-1', 'viridian-forest', 'mt-moon', ...chapter1])
    assert.deepEqual(open(1, ['violet']), ['route-1', ...chapter1, ...chapter2])
    assert.deepEqual(open(1, ['violet', 'azalea']), ['route-1', ...chapter1, ...chapter2, 'ilex-forest', 'route-34'])
  })

  test('em Johto, cada área tem capítulo, e os capítulos vêm em ordem', () => {
    const johto = loadRegions().filter((region) => region.gameRegion === 'johto')
    assert.ok(johto.length >= 35)
    let last = 0
    for (const region of johto) {
      assert.ok(region.chapter !== null, region.slug)
      assert.ok(region.chapter >= last, `${region.slug} fora de ordem`)
      last = region.chapter
    }
  })

  test('cada região do config está no snapshot, soma 100 e tem slots válidos', () => {
    const snapshot = readRegionsSnapshot()
    const regions = loadRegions()
    assert.equal(regions.length, regionConfigs.length)
    for (const config of regionConfigs) {
      const entry = snapshot[config.slug]
      assert.ok(entry, config.slug)
      assert.deepEqual(entry.sources, config.sources)
      // Mato e cada método: tabela que existe soma 100. Só água pode ficar sem mato.
      const tables = [entry.slots, ...Object.values(entry.methods ?? {})].filter((table) => table.length > 0)
      assert.ok(tables.length > 0, config.slug)
      for (const table of tables) {
        const tenths = Math.round(table.reduce((sum, slot) => sum + slot.weight, 0) * 10)
        assert.equal(tenths, 1000, `${config.slug} soma ${tenths / 10}`)
        for (const slot of table) {
          assert.ok(slot.speciesId >= 1 && slot.speciesId <= 251)
          assert.ok(slot.weight > 0)
          assert.ok(slot.minLevel <= slot.maxLevel)
        }
      }
      const region = regions.find((item) => item.slug === config.slug)
      assert.ok(region)
      const levels = entry.slots.length > 0 ? entry.slots : tables.flat()
      assert.deepEqual(region.wildLevelRange, [
        Math.min(...levels.map((slot) => slot.minLevel)),
        Math.max(...levels.map((slot) => slot.maxLevel)),
      ])
    }
  })

  test('o Razz só mexe em espécies raras', () => {
    assert.equal(RARE_WEIGHT_MAX, 10)
    const slots = [
      { speciesId: 16, weight: 50, minLevel: 2, maxLevel: 3 },
      { speciesId: 19, weight: RARE_WEIGHT_MAX + 0.1, minLevel: 2, maxLevel: 3 },
      { speciesId: 25, weight: RARE_WEIGHT_MAX, minLevel: 4, maxLevel: 4 },
    ]
    const boosted = applyRareWeights(slots, 2)
    assert.deepEqual(
      boosted.map((slot) => slot.weight),
      [50, RARE_WEIGHT_MAX + 0.1, RARE_WEIGHT_MAX * 2],
    )
    assert.equal(boosted[2]?.minLevel, 4)
    assert.equal(boosted[0]?.maxLevel, 3)
  })

  test('raridade é pela soma da espécie, não pelo slot de nível', () => {
    // Pidgey comum dividido em slots pequenos não conta como raro.
    // Pikachu dividido em dois slots que somam 6 conta, nos dois slots.
    const slots = [
      { speciesId: 16, weight: 60, minLevel: 3, maxLevel: 3 },
      { speciesId: 16, weight: 1, minLevel: 7, maxLevel: 7 },
      { speciesId: 25, weight: 4, minLevel: 3, maxLevel: 3 },
      { speciesId: 25, weight: 2, minLevel: 5, maxLevel: 5 },
      { speciesId: 19, weight: 33, minLevel: 2, maxLevel: 4 },
    ]
    assert.deepEqual(
      applyRareWeights(slots, 2).map((slot) => slot.weight),
      [60, 1, 8, 4, 33],
    )
  })

  test('no snapshot, o Razz da Rota 1 não dobra nada e o do Mt. Moon dobra Sandshrew e Clefairy', () => {
    const boostedSpecies = (slug: string) => {
      const region = loadRegions().find((item) => item.slug === slug)
      assert.ok(region)
      const boosted = applyRareWeights(region.slots, 2)
      return [...new Set(region.slots.filter((slot, i) => boosted[i]?.weight !== slot.weight).map((slot) => slot.speciesId))]
    }
    assert.deepEqual(boostedSpecies('route-1'), [])
    assert.deepEqual(boostedSpecies('mt-moon').sort((a, b) => a - b), [27, 35])
  })

  test('a média dos períodos divide o horário único por três e não junta faixas', () => {
    // Pidgey 2–3 só de manhã, chance 30 → média 10.
    // Pidgey 7–7 e Rattata 2–3 sem período, chance 30 → média 30 cada.
    // Total 70. Em décimos: 143, 429 e 429. A sobra de 1 décimo sai do maior
    // empate, o de menor speciesId (Pidgey nv 7): 14.3, 42.8, 42.9.
    // Surf, enxame e a versão gold ficam de fora.
    assert.deepEqual(slotsFromArea(sampleArea, { version: 'crystal', name: 'Exemplo' }), [
      { speciesId: 16, minLevel: 2, maxLevel: 3, weight: 14.3 },
      { speciesId: 16, minLevel: 7, maxLevel: 7, weight: 42.8 },
      { speciesId: 19, minLevel: 2, maxLevel: 3, weight: 42.9 },
    ])
  })

  test('exclude e levelOverride entram na tabela publicada', () => {
    assert.deepEqual(
      slotsFromArea(sampleArea, {
        version: 'crystal',
        name: 'Exemplo',
        exclude: [19],
        levelOverride: [4, 5],
      }),
      [{ speciesId: 16, minLevel: 4, maxLevel: 5, weight: 100 }],
    )
  })

  test('várias fontes: cada uma pesa igual, mesmo com totais diferentes', () => {
    const area = (name: string, id: number, chance: number): LocationArea => ({
      pokemon_encounters: [
        {
          pokemon: { name, url: `https://pokeapi.co/api/v2/pokemon/${id}/` },
          version_details: [{ version: { name: 'crystal' }, encounter_details: [allDay(chance, 5, 5)] }],
        },
      ],
    })
    // Pidgey 100% num andar e Zubat 100% no outro (com chance 40) → 50/50.
    assert.deepEqual(
      slotsFromSources(
        [
          { area: area('pidgey', 16, 100), version: 'crystal' },
          { area: area('zubat', 41, 40), version: 'crystal' },
        ],
        { name: 'Exemplo' },
      ),
      [
        { speciesId: 16, minLevel: 5, maxLevel: 5, weight: 50 },
        { speciesId: 41, minLevel: 5, maxLevel: 5, weight: 50 },
      ],
    )
    // Uma fonte só dá o mesmo que slotsFromArea.
    assert.deepEqual(
      slotsFromSources([{ area: sampleArea, version: 'crystal' }], { name: 'Exemplo' }),
      slotsFromArea(sampleArea, { version: 'crystal', name: 'Exemplo' }),
    )
  })

  test('"sem enxame" conta como mato normal; "com enxame" fica de fora', () => {
    const detail = (chance: number, conditions: string[]) => ({
      min_level: 3,
      max_level: 3,
      chance,
      method: { name: 'walk' },
      condition_values: conditions.map((name) => ({ name })),
    })
    const area: LocationArea = {
      pokemon_encounters: [
        {
          pokemon: { name: 'geodude', url: 'https://pokeapi.co/api/v2/pokemon/74/' },
          version_details: [{ version: { name: 'crystal' }, encounter_details: [detail(60, ['swarm-no'])] }],
        },
        {
          pokemon: { name: 'dunsparce', url: 'https://pokeapi.co/api/v2/pokemon/206/' },
          version_details: [
            { version: { name: 'crystal' }, encounter_details: [detail(40, ['swarm-no', 'time-day']), detail(90, ['swarm-yes'])] },
          ],
        },
      ],
    }
    // Geodude 60 o dia todo; Dunsparce 40 só de dia → média 40/3. Total 73,3.
    assert.deepEqual(slotsFromArea(area, { version: 'crystal', name: 'Exemplo' }), [
      { speciesId: 74, minLevel: 3, maxLevel: 3, weight: 81.8 },
      { speciesId: 206, minLevel: 3, maxLevel: 3, weight: 18.2 },
    ])
  })

  test('área sem walk na versão falha com o nome da região', () => {
    assert.throws(
      () => slotsFromArea({ pokemon_encounters: [] }, { version: 'yellow', name: 'Rota 1' }),
      /Rota 1/,
    )
  })

  test('rollWild gasta 3 chamadas e o nível fica na faixa do slot sorteado', () => {
    const slots = [
      { speciesId: 16, weight: 70, minLevel: 2, maxLevel: 4 },
      { speciesId: 19, weight: 30, minLevel: 7, maxLevel: 9 },
    ]
    const draws = [
      [0, 0.99, 0],
      [0.8, 0, 0.5],
    ]
    const expected = [
      { speciesId: 16, level: 4, isShiny: false },
      { speciesId: 19, level: 7, isShiny: true },
    ]
    for (const [index, draw] of draws.entries()) {
      let calls = 0
      const rng = () => {
        const value = draw[calls] ?? 1
        calls += 1
        return value
      }
      const wild = rollWild(rng, { slots, shinyRate: index === 0 ? 0 : 1 })
      assert.equal(calls, 3)
      assert.deepEqual(wild, expected[index])
    }
  })
})

test('métodos: o nível fica no teto do capítulo (a Super Vara da Rota 30 não dá nível 40)', () => {
  const route = regionBySlug('route-30')!
  const capped = methodSlots(route, 'superRod')
  const walkMax = Math.max(
    ...loadRegions()
      .filter((region) => region.chapter === route.chapter)
      .flatMap((region) => region.slots.map((slot) => slot.maxLevel)),
  )
  assert.ok(capped.length > 0)
  for (const slot of capped) assert.ok(slot.maxLevel <= walkMax && slot.minLevel <= slot.maxLevel)
})

test('cada água tem um método: poça da rota só pesca; lugar só de água só Surf', () => {
  const route = regionBySlug('route-30')!
  assert.ok(route.methods.oldRod && !route.methods.surf)
  const lake = regionBySlug('lake-of-rage')!
  assert.equal(lake.slots.length, 0)
  assert.ok(lake.methods.surf && !lake.methods.oldRod && !lake.methods.goodRod && !lake.methods.superRod)
  assert.ok(regionSpecies(lake).includes(130), 'Gyarados no Lake of Rage')
})
