import assert from 'node:assert/strict'
import test from 'node:test'
import { isPokemonType } from '../../config/types.js'
import {
  abilityImmunity,
  calcDamage,
  moveCooldownMs,
  offensiveStat,
  speedFactor,
  typeMultiplier,
  type DamageInput,
} from './damage.js'
import { applyEvYield } from './evs.js'
import { runBattle } from './run.js'
import { isFinishTooEarly, simConfig } from './config.js'
import { parseBattleSetup, serializeBattleSetup } from './setupJson.js'
import type { BattleInput, BattleSetup, SimFighter, SimMove } from './types.js'
import { mulberry32 } from '../mulberry32.js'
import { traitsConfig } from '../../config/traits.js'

function dmg(
  input: Omit<DamageInput, 'attackerMaxHp' | 'defenderMaxHp'> & {
    attackerMaxHp?: number
    defenderMaxHp?: number
  },
): number {
  return calcDamage({
    ...input,
    attackerMaxHp: input.attackerMaxHp ?? input.attackerHp,
    defenderMaxHp: input.defenderMaxHp ?? input.defenderHp,
  })
}

function move(partial: Partial<SimMove> & Pick<SimMove, 'name' | 'type' | 'power'>): SimMove {
  return {
    damageClass: 'physical',
    ...partial,
  }
}

function fighter(partial: Partial<SimFighter> & Pick<SimFighter, 'speciesId' | 'level'>): SimFighter {
  const base = {
    id: null as number | null,
    types: ['normal'] as SimFighter['types'],
    stats: { hp: 50, attack: 40, defense: 40, spAttack: 40, spDefense: 40, speed: 40 },
    fastMove: move({ name: 'tackle', type: 'normal', power: 40 }),
    chargedMove: move({ name: 'body-slam', type: 'normal', power: 85 }),
    abilityKey: 'none',
  }
  return { ...base, ...partial, stats: { ...base.stats, ...partial.stats } }
}

function setup(team: SimFighter[], wild: SimFighter): BattleSetup {
  return { team, wild }
}

test('mesma seed + setup + inputs → mesmo resultado e log', () => {
  const s = setup(
    [fighter({ id: 1, speciesId: 19, level: 20, stats: { hp: 60, attack: 55, defense: 30, spAttack: 30, spDefense: 30, speed: 80 } })],
    fighter({ speciesId: 16, level: 10, stats: { hp: 35, attack: 25, defense: 25, spAttack: 25, spDefense: 25, speed: 40 } }),
  )
  const inputs: BattleInput[] = [
    { t: 0, action: 'fast' },
    { t: 1200, action: 'fast' },
    { t: 2400, action: 'charged' },
  ]
  const a = runBattle({ setup: s, seed: 42, inputs })
  const b = runBattle({ setup: s, seed: 42, inputs })
  assert.deepEqual(a, b)
})

test('toque durante cooldown e carregado sem energia são ignorados', () => {
  const s = setup(
    [fighter({ id: 1, speciesId: 1, level: 20 })],
    fighter({ speciesId: 2, level: 50, stats: { hp: 200, attack: 10, defense: 80, spAttack: 10, spDefense: 80, speed: 10 } }),
  )
  const result = runBattle({
    setup: s,
    seed: 7,
    inputs: [
      { t: 0, action: 'charged' }, // sem energia
      { t: 0, action: 'fast' },
      { t: 1, action: 'fast' }, // cooldown
    ],
  })
  const ignored = result.log.filter((e) => e.kind === 'ignored')
  assert.ok(ignored.some((e) => e.kind === 'ignored' && e.reason === 'energy'))
  assert.ok(ignored.some((e) => e.kind === 'ignored' && e.reason === 'cooldown'))
})

test('Velocidade maior → cooldown menor, dentro de 0,8–1,2', () => {
  const fast = move({ name: 'quick-attack', type: 'normal', power: 40 })
  const slowCd = moveCooldownMs(fast, 30, 50)
  const midCd = moveCooldownMs(fast, 80, 50)
  const highCd = moveCooldownMs(fast, 120, 50)
  assert.ok(highCd < midCd)
  assert.ok(midCd < slowCd)
  const fSlow = speedFactor(30, 50)
  const fFast = speedFactor(120, 50)
  assert.ok(fSlow <= simConfig.speedFactorMax + 1e-9)
  assert.ok(fFast >= simConfig.speedFactorMin - 1e-9)
  assert.ok(fSlow >= fFast)
})

test('STAB, efetividade, imunidade e fraqueza ×4', () => {
  assert.equal(typeMultiplier('fire', ['grass']), 2)
  assert.equal(typeMultiplier('fire', ['grass', 'bug']), 4)
  assert.equal(typeMultiplier('ground', ['flying']), 0)
  assert.ok(isPokemonType('fairy'))

  const rng = mulberry32(1)
  const atk = fighter({
    speciesId: 4,
    level: 50,
    types: ['fire'],
    stats: { hp: 100, attack: 80, defense: 50, spAttack: 80, spDefense: 50, speed: 50 },
    fastMove: move({ name: 'ember', type: 'fire', power: 40, damageClass: 'special' }),
  })
  const def = fighter({
    speciesId: 1,
    level: 50,
    types: ['grass', 'bug'],
    stats: { hp: 100, attack: 50, defense: 50, spAttack: 50, spDefense: 40, speed: 50 },
  })
  assert.ok(
    dmg({
      attacker: atk,
      defender: def,
      move: atk.fastMove,
      attackStat: 80,
      defenseStat: 40,
      attackerHp: 100,
      defenderHp: 100,
      rng,
    }) > 20,
  )

  const fly = fighter({ speciesId: 16, level: 20, types: ['flying'], abilityKey: 'levitate' })
  const groundMove = move({ name: 'earthquake', type: 'ground', power: 100 })
  assert.equal(
    dmg({
      attacker: atk,
      defender: fly,
      move: groundMove,
      attackStat: 80,
      defenseStat: 40,
      attackerHp: 100,
      defenderHp: 100,
      rng: mulberry32(2),
    }),
    0,
  )
})

test('habilidades do conjunto (5.18)', () => {
  const baseAtk = fighter({
    speciesId: 1,
    level: 50,
    types: ['normal'],
    stats: { hp: 100, attack: 80, defense: 50, spAttack: 80, spDefense: 50, speed: 50 },
  })
  const baseDef = fighter({
    speciesId: 2,
    level: 50,
    types: ['normal'],
    stats: { hp: 100, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
  })
  // Sturdy
  const sturdy = { ...baseDef, abilityKey: 'sturdy', stats: { ...baseDef.stats, hp: 40 } }
  assert.equal(
    dmg({
      attacker: { ...baseAtk, stats: { ...baseAtk.stats, attack: 200 } },
      defender: sturdy,
      move: move({ name: 'hyper-beam', type: 'normal', power: 150 }),
      attackStat: 200,
      defenseStat: 20,
      attackerHp: 100,
      defenderHp: 40,
      rng: mulberry32(3),
    }),
    39,
  )

  // Huge Power / Hustle / Intimidate (ofensivo)
  assert.equal(offensiveStat({ ...baseAtk, abilityKey: 'huge-power' }, 'physical', false), 160)
  assert.equal(offensiveStat({ ...baseAtk, abilityKey: 'hustle' }, 'physical', false), 120)
  assert.equal(offensiveStat(baseAtk, 'physical', true), Math.floor((80 * 2) / 3))

  // Thick Fat
  const thick = { ...baseDef, abilityKey: 'thick-fat' }
  const fireMove = move({ name: 'ember', type: 'fire', power: 40, damageClass: 'special' })
  const normalFire = dmg({
    attacker: { ...baseAtk, types: ['fire'], fastMove: fireMove },
    defender: baseDef,
    move: fireMove,
    attackStat: 80,
    defenseStat: 50,
    attackerHp: 100,
    defenderHp: 100,
    rng: mulberry32(4),
  })
  const thickDmg = dmg({
    attacker: { ...baseAtk, types: ['fire'], fastMove: fireMove },
    defender: thick,
    move: fireMove,
    attackStat: 80,
    defenseStat: 50,
    attackerHp: 100,
    defenderHp: 100,
    rng: mulberry32(4),
  })
  assert.ok(thickDmg < normalFire)

  // Blaze / Torrent / Overgrow / Swarm com HP ≤ ⅓
  const blazeAtk = {
    ...baseAtk,
    types: ['fire'] as const,
    abilityKey: 'blaze',
    fastMove: fireMove,
  }
  const low = dmg({
    attacker: blazeAtk,
    defender: baseDef,
    move: fireMove,
    attackStat: 80,
    defenseStat: 50,
    attackerHp: Math.floor(100 / 3),
    attackerMaxHp: 100,
    defenderHp: 100,
    rng: mulberry32(5),
  })
  const full = dmg({
    attacker: blazeAtk,
    defender: baseDef,
    move: fireMove,
    attackStat: 80,
    defenseStat: 50,
    attackerHp: 100,
    attackerMaxHp: 100,
    defenderHp: 100,
    rng: mulberry32(5),
  })
  assert.ok(low > full)

  for (const [key, type] of [
    ['torrent', 'water'],
    ['overgrow', 'grass'],
    ['swarm', 'bug'],
  ] as const) {
    const m = move({ name: key, type, power: 40, damageClass: 'special' })
    const boosted = dmg({
      attacker: { ...baseAtk, types: [type], abilityKey: key, fastMove: m },
      defender: baseDef,
      move: m,
      attackStat: 80,
      defenseStat: 50,
      attackerHp: Math.floor(100 / 3),
      attackerMaxHp: 100,
      defenderHp: 100,
      rng: mulberry32(6),
    })
    const plain = dmg({
      attacker: { ...baseAtk, types: [type], abilityKey: key, fastMove: m },
      defender: baseDef,
      move: m,
      attackStat: 80,
      defenseStat: 50,
      attackerHp: 100,
      attackerMaxHp: 100,
      defenderHp: 100,
      rng: mulberry32(6),
    })
    assert.ok(boosted > plain, key)
  }

  // Imunidades
  assert.deepEqual(abilityImmunity('levitate', 'ground'), { immune: true, healFraction: 0 })
  assert.deepEqual(abilityImmunity('flash-fire', 'fire'), { immune: true, healFraction: 0 })
  assert.deepEqual(abilityImmunity('water-absorb', 'water'), { immune: true, healFraction: 1 / 4 })
  assert.deepEqual(abilityImmunity('volt-absorb', 'electric'), { immune: true, healFraction: 1 / 4 })
  assert.equal(
    dmg({
      attacker: baseAtk,
      defender: { ...baseDef, abilityKey: 'flash-fire' },
      move: fireMove,
      attackStat: 80,
      defenseStat: 50,
      attackerHp: 100,
      defenderHp: 100,
      rng: mulberry32(7),
    }),
    0,
  )

  // Sniper: só listado até haver crítico
  assert.equal(offensiveStat({ ...baseAtk, abilityKey: 'sniper' }, 'physical', false), 80)

  // Intimidate no log
  const result = runBattle({
    setup: setup(
      [
        fighter({
          id: 1,
          speciesId: 24,
          level: 40,
          abilityKey: 'intimidate',
          stats: { hp: 120, attack: 90, defense: 60, spAttack: 60, spDefense: 60, speed: 90 },
        }),
      ],
      fighter({
        speciesId: 10,
        level: 5,
        stats: { hp: 20, attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 20 },
      }),
    ),
    seed: 99,
  })
  assert.equal(result.result, 'win')
  assert.ok(result.log.some((e) => e.kind === 'intimidate'))

  // Water Absorb cura no log
  const absorbFight = runBattle({
    setup: setup(
      [
        fighter({
          id: 1,
          speciesId: 7,
          level: 30,
          types: ['water'],
          abilityKey: 'water-absorb',
          stats: { hp: 80, attack: 40, defense: 40, spAttack: 40, spDefense: 40, speed: 40 },
          fastMove: move({ name: 'water-gun', type: 'water', power: 40, damageClass: 'special' }),
        }),
      ],
      fighter({
        speciesId: 60,
        level: 20,
        types: ['water'],
        stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 30 },
        fastMove: move({ name: 'water-gun', type: 'water', power: 40, damageClass: 'special' }),
        chargedMove: null,
      }),
    ),
    seed: 12,
  })
  assert.ok(absorbFight.log.some((e) => e.kind === 'heal'))
})

test('tempo limite e troca automática ao cair', () => {
  const tank = fighter({
    id: 1,
    speciesId: 1,
    level: 5,
    stats: { hp: 10, attack: 5, defense: 5, spAttack: 5, spDefense: 5, speed: 5 },
  })
  const ally = fighter({
    id: 2,
    speciesId: 2,
    level: 50,
    stats: { hp: 200, attack: 120, defense: 80, spAttack: 80, spDefense: 80, speed: 100 },
  })
  const boss = fighter({
    speciesId: 150,
    level: 70,
    stats: { hp: 300, attack: 150, defense: 100, spAttack: 150, spDefense: 100, speed: 120 },
    fastMove: move({ name: 'psychic', type: 'psychic', power: 40, damageClass: 'special' }),
    chargedMove: move({ name: 'psychic', type: 'psychic', power: 90, damageClass: 'special' }),
  })
  const switched = runBattle({ setup: setup([tank, ally], boss), seed: 11 })
  assert.ok(switched.log.some((e) => e.kind === 'switch' && e.manual === false))
  assert.ok(switched.enteredSlots.includes(0) && switched.enteredSlots.includes(1))

  // Time limite: dois tanques frágeis vs boss que não mata rápido o suficiente → timeout
  const stall = runBattle({
    setup: setup(
      [
        fighter({
          id: 1,
          speciesId: 1,
          level: 100,
          stats: { hp: 500, attack: 1, defense: 200, spAttack: 1, spDefense: 200, speed: 1 },
          chargedMove: null,
        }),
      ],
      fighter({
        speciesId: 150,
        level: 100,
        stats: { hp: 500, attack: 1, defense: 200, spAttack: 1, spDefense: 200, speed: 1 },
        chargedMove: null,
      }),
    ),
    seed: 3,
  })
  assert.equal(stall.result, 'timeout')
  assert.ok(stall.durationMs >= simConfig.timeLimitMs)
})

test('finish_too_early: duração do log maior que o tempo real', () => {
  assert.equal(isFinishTooEarly(100, 2000, 400), true)
  assert.equal(isFinishTooEarly(2000, 2000, 400), false)
  assert.equal(isFinishTooEarly(1800, 2000, 400), false)
})

test('automático vence fraco e perde para forte', () => {
  const hero = fighter({
    id: 1,
    speciesId: 25,
    level: 40,
    stats: { hp: 100, attack: 90, defense: 60, spAttack: 90, spDefense: 60, speed: 110 },
    fastMove: move({ name: 'thunder-shock', type: 'electric', power: 40, damageClass: 'special' }),
    chargedMove: move({ name: 'thunderbolt', type: 'electric', power: 90, damageClass: 'special' }),
  })
  const weak = fighter({
    speciesId: 10,
    level: 3,
    types: ['bug'],
    stats: { hp: 15, attack: 8, defense: 8, spAttack: 8, spDefense: 8, speed: 15 },
  })
  const strong = fighter({
    speciesId: 150,
    level: 80,
    types: ['psychic'],
    stats: { hp: 250, attack: 160, defense: 120, spAttack: 160, spDefense: 120, speed: 140 },
    fastMove: move({ name: 'confusion', type: 'psychic', power: 50, damageClass: 'special' }),
    chargedMove: move({ name: 'psychic', type: 'psychic', power: 90, damageClass: 'special' }),
  })
  assert.equal(runBattle({ setup: setup([hero], weak), seed: 1 }).result, 'win')
  const tough = runBattle({ setup: setup([hero], strong), seed: 2 }).result
  assert.ok(tough === 'lose' || tough === 'timeout')
})

test('EVs respeitam tetos 252 e 510', () => {
  const cur = { hp: 250, attack: 250, defense: 0, spAttack: 0, spDefense: 0, speed: 0 }
  const next = applyEvYield(cur, { hp: 10, attack: 10, defense: 10, spAttack: 0, spDefense: 0, speed: 0 })
  assert.equal(next.hp, 252)
  assert.equal(next.attack, 252)
  assert.equal(next.defense, 6)
  assert.equal(next.hp + next.attack + next.defense, 510)
})

test('inputs com t negativo ou fora de ordem falham', () => {
  const s = setup([fighter({ id: 1, speciesId: 1, level: 10 })], fighter({ speciesId: 2, level: 10 }))
  assert.throws(() => runBattle({ setup: s, seed: 1, inputs: [{ t: -1, action: 'fast' }] }))
  assert.throws(() =>
    runBattle({
      setup: s,
      seed: 1,
      inputs: [
        { t: 100, action: 'fast' },
        { t: 50, action: 'fast' },
      ],
    }),
  )
})

test('após desmaio, toques no intervalo de troca não travam a fila', () => {
  const fragile = fighter({
    id: 1,
    speciesId: 1,
    level: 5,
    stats: { hp: 1, attack: 5, defense: 5, spAttack: 5, spDefense: 5, speed: 40 },
  })
  const ally = fighter({
    id: 2,
    speciesId: 2,
    level: 30,
    stats: { hp: 80, attack: 70, defense: 50, spAttack: 50, spDefense: 50, speed: 80 },
  })
  const boss = fighter({
    speciesId: 150,
    level: 50,
    stats: { hp: 200, attack: 120, defense: 80, spAttack: 120, spDefense: 80, speed: 100 },
    fastMove: move({ name: 'psychic', type: 'psychic', power: 40, damageClass: 'special' }),
    chargedMove: null,
  })
  const inputs: BattleInput[] = []
  for (let t = 0; t <= 15_000; t += 100) {
    inputs.push({ t, action: 'fast' })
  }
  const result = runBattle({ setup: setup([fragile, ally], boss), seed: 1, inputs })
  const faint = result.log.find((e) => e.kind === 'faint' && e.side === 'player')
  assert.ok(faint)
  assert.ok(result.log.some((e) => e.kind === 'ignored' && e.reason === 'switching'))
  const after = result.log.filter(
    (e) => e.kind === 'move' && e.side === 'player' && faint.kind === 'faint' && e.t > faint.t,
  )
  assert.ok(after.length >= 3, `2º aliado deveria atacar várias vezes; got ${after.length}`)
})

test('finish usa o setup gravado (alimentar no meio não muda o resultado)', () => {
  const wild = fighter({
    speciesId: 16,
    level: 5,
    stats: { hp: 30, attack: 25, defense: 25, spAttack: 20, spDefense: 25, speed: 40 },
  })
  const atStart = setup(
    [
      fighter({
        id: 1,
        speciesId: 1,
        level: 5,
        stats: { hp: 40, attack: 35, defense: 30, spAttack: 35, spDefense: 30, speed: 35 },
      }),
    ],
    wild,
  )
  const inputs: BattleInput[] = []
  for (let t = 0; t <= 20_000; t += 1100) inputs.push({ t, action: 'fast' })
  const frozen = parseBattleSetup(JSON.stringify(serializeBattleSetup(atStart)))
  const withoutFeed = runBattle({ setup: frozen, seed: 42, inputs })
  const fed = setup(
    [
      fighter({
        id: 1,
        speciesId: 1,
        level: 20,
        stats: { hp: 80, attack: 70, defense: 60, spAttack: 70, spDefense: 60, speed: 70 },
      }),
    ],
    wild,
  )
  const withFeedRebuild = runBattle({ setup: fed, seed: 42, inputs })
  const withFeedButFrozen = runBattle({ setup: frozen, seed: 42, inputs })
  assert.deepEqual(withoutFeed, withFeedButFrozen)
  assert.notDeepEqual(withoutFeed.log, withFeedRebuild.log)
})

test('moveCooldownMs usa traitsConfig.fastPowerMax, não 55 mágico', () => {
  const edge = move({ name: 'x', type: 'normal', power: traitsConfig.fastPowerMax })
  const over = move({ name: 'y', type: 'normal', power: traitsConfig.fastPowerMax + 1 })
  const fastCd = moveCooldownMs(edge, 80, 50)
  const chargedCd = moveCooldownMs(over, 80, 50)
  assert.ok(chargedCd > fastCd)
})

test('untilMs: foto em t bate com o prefixo do log da luta completa', () => {
  const s = setup(
    [
      fighter({
        id: 1,
        speciesId: 25,
        level: 20,
        stats: { hp: 60, attack: 55, defense: 40, spAttack: 50, spDefense: 40, speed: 70 },
      }),
    ],
    fighter({
      speciesId: 16,
      level: 8,
      stats: { hp: 40, attack: 30, defense: 30, spAttack: 25, spDefense: 30, speed: 45 },
    }),
  )
  const inputs: BattleInput[] = []
  for (let t = 0; t <= 25_000; t += 1200) inputs.push({ t, action: 'fast' })
  const full = runBattle({ setup: s, seed: 21, inputs })
  assert.ok(full.result)
  const mid = Math.max(1, Math.floor(full.durationMs / 2))
  const partial = runBattle({ setup: s, seed: 21, inputs, untilMs: mid })
  assert.equal(partial.snapshot.t, mid)
  assert.equal(partial.result, null)
  assert.deepEqual(
    partial.log,
    full.log.filter((e) => e.t <= mid && e.kind !== 'end'),
  )
  const atEnd = runBattle({ setup: s, seed: 21, inputs, untilMs: full.durationMs })
  assert.equal(atEnd.snapshot.wild.hp, full.snapshot.wild.hp)
  assert.equal(atEnd.snapshot.team[0]?.hp, full.snapshot.team[0]?.hp)
  assert.equal(atEnd.result, full.result)
})

test('automático: mesma seed → mesmos inputs; demora mais que o perfeito', () => {
  const s = setup(
    [
      fighter({
        id: 1,
        speciesId: 25,
        level: 25,
        stats: { hp: 70, attack: 60, defense: 45, spAttack: 55, spDefense: 45, speed: 80 },
        fastMove: move({ name: 'tackle', type: 'normal', power: 40 }),
        chargedMove: null,
      }),
    ],
    fighter({
      speciesId: 16,
      level: 10,
      stats: { hp: 35, attack: 25, defense: 25, spAttack: 20, spDefense: 25, speed: 40 },
      chargedMove: null,
    }),
  )
  const a = runBattle({ setup: s, seed: 77 })
  const b = runBattle({ setup: s, seed: 77 })
  assert.deepEqual(a.inputs, b.inputs)
  assert.ok(a.inputs.length > 0)
  assert.ok(a.inputs[0]!.t >= simConfig.autoReactionMinMs)
  // Mesmos inputs manuais reproduzem a luta automática.
  assert.deepEqual(runBattle({ setup: s, seed: 77, inputs: a.inputs }).log, a.log)

  // Perfeito tocaria em t=0; o automático atrasa o 1º toque (e os seguintes) pela reação.
  assert.ok(a.inputs[0]!.t > 0)
  assert.ok(a.inputs[0]!.t <= simConfig.autoReactionMaxMs)
  const gaps = a.inputs.slice(1).map((inp, i) => inp.t - a.inputs[i]!.t)
  assert.ok(gaps.every((g) => g >= simConfig.autoReactionMinMs))
})
