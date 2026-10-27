import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyStages, stageFactor, critChanceDenom } from './effects.js'
import { parseBattleSetup, serializeBattleSetup } from './setupJson.js'
import { runBattle } from './run.js'
import { simConfig } from './config.js'
import {
  canReceiveAilment,
  effectChancePercent,
  typeBlocksAilment,
} from './status.js'
import { calcDamage, offensiveStat, rollCriticalAgainst } from './damage.js'
import { mulberry32 } from '../mulberry32.js'
import type { BattleSetup, SimFighter, SimMove } from './types.js'

function move(partial: Partial<SimMove> & Pick<SimMove, 'name' | 'type' | 'power'>): SimMove {
  return {
    damageClass: 'physical',
    ailment: null,
    ailmentChance: 0,
    statChanges: [],
    statChance: 0,
    statOnSelf: false,
    drain: 0,
    critRate: 0,
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

test('estágios: multiplicadores (2+n)/2 e 2/(2−n)', () => {
  assert.deepEqual(stageFactor(0), { num: 2, den: 2 })
  assert.deepEqual(stageFactor(1), { num: 3, den: 2 })
  assert.deepEqual(stageFactor(2), { num: 4, den: 2 })
  assert.deepEqual(stageFactor(-1), { num: 2, den: 3 })
  assert.deepEqual(stageFactor(-2), { num: 2, den: 4 })
})

test('crítico: chance normal 1/24, alta 1/8, Super Luck sobe um degrau', () => {
  assert.equal(critChanceDenom(0, 'none', 24, 8, 2), 24)
  assert.equal(critChanceDenom(1, 'none', 24, 8, 2), 8)
  assert.equal(critChanceDenom(0, 'super-luck', 24, 8, 2), 8)
  assert.equal(critChanceDenom(1, 'super-luck', 24, 8, 2), 2)
})

test('crítico: Battle Armor imune; Sniper ×9/4; ignora estágio −atk e +def', () => {
  const atk = fighter({
    id: 1,
    speciesId: 1,
    level: 50,
    stats: { hp: 100, attack: 80, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
    fastMove: move({ name: 'slash', type: 'normal', power: 70, critRate: 1 }),
  })
  const def = fighter({
    speciesId: 2,
    level: 50,
    stats: { hp: 100, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
  })
  assert.equal(rollCriticalAgainst(atk.fastMove, atk, { ...def, abilityKey: 'battle-armor' }, mulberry32(1)), false)

  const flat = emptyStages()
  const base = calcDamage({
    attacker: atk,
    defender: def,
    move: atk.fastMove,
    attackStat: offensiveStat(atk, 'physical', flat, null, true),
    defenseStat: 50,
    attackerHp: 100,
    attackerMaxHp: 100,
    defenderHp: 100,
    defenderMaxHp: 100,
    critical: true,
    rng: mulberry32(9),
  })
  const sniper = calcDamage({
    attacker: { ...atk, abilityKey: 'sniper' },
    defender: def,
    move: atk.fastMove,
    attackStat: offensiveStat({ ...atk, abilityKey: 'sniper' }, 'physical', flat, null, true),
    defenseStat: 50,
    attackerHp: 100,
    attackerMaxHp: 100,
    defenderHp: 100,
    defenderMaxHp: 100,
    critical: true,
    rng: mulberry32(9),
  })
  assert.ok(sniper > base)

  // Crítico ignora −atk do atacante
  const withNeg = offensiveStat(atk, 'physical', { ...flat, attack: -3 }, null, true)
  const without = offensiveStat(atk, 'physical', flat, null, true)
  assert.equal(withNeg, without)
})

test('imunidade de tipo a status', () => {
  assert.equal(typeBlocksAilment('burn', ['fire']), true)
  assert.equal(typeBlocksAilment('paralysis', ['electric']), true)
  assert.equal(typeBlocksAilment('poison', ['steel']), true)
  assert.equal(typeBlocksAilment('freeze', ['ice']), true)
  assert.equal(canReceiveAilment('burn', fighter({ speciesId: 4, level: 5, types: ['fire'] })), false)
})

test('rápido: chance ÷3; sono/congelamento/confusão não saem do rápido', () => {
  assert.equal(effectChancePercent(30, true, false), 10)
  assert.equal(effectChancePercent(10, false, false), 10)
  assert.equal(effectChancePercent(10, false, true), 20)
  assert.ok(!(simConfig.fastAilments as readonly string[]).includes('sleep'))
  assert.ok(!(simConfig.fastAilments as readonly string[]).includes('freeze'))
  assert.ok(!(simConfig.fastAilments as readonly string[]).includes('confusion'))
})

test('ember pode queimar; giga-drain cura; take-down causa recuo', () => {
  // Ember: força chance 100% via move
  const ember = move({
    name: 'ember',
    type: 'fire',
    power: 40,
    damageClass: 'special',
    ailment: 'burn',
    ailmentChance: 100,
  })
  let burned = false
  for (let seed = 1; seed < 200 && !burned; seed += 1) {
    const result = runBattle({
      setup: setup(
        [
          fighter({
            id: 1,
            speciesId: 4,
            level: 20,
            types: ['fire'],
            fastMove: ember,
            chargedMove: null,
            stats: { hp: 80, attack: 40, defense: 40, spAttack: 70, spDefense: 40, speed: 60 },
          }),
        ],
        fighter({
          speciesId: 16,
          level: 10,
          types: ['normal', 'flying'],
          stats: { hp: 200, attack: 20, defense: 40, spAttack: 20, spDefense: 40, speed: 20 },
        }),
      ),
      seed,
      inputs: [{ t: 0, action: 'fast' }],
      untilMs: 500,
    })
    burned = result.log.some((e) => e.kind === 'status' && e.status === 'burn' && e.applied)
  }
  assert.ok(burned, 'ember deveria queimar com chance 100%')

  const drainMove = move({
    name: 'giga-drain',
    type: 'grass',
    power: 75,
    damageClass: 'special',
    drain: 50,
  })
  // Dreno só cura se o atacante já perdeu vida: espera o selvagem acertar antes.
  const drainResult = runBattle({
    setup: setup(
      [
        fighter({
          id: 1,
          speciesId: 1,
          level: 30,
          types: ['grass'],
          fastMove: drainMove,
          chargedMove: null,
          stats: { hp: 80, attack: 40, defense: 40, spAttack: 80, spDefense: 40, speed: 50 },
        }),
      ],
      fighter({
        speciesId: 7,
        level: 20,
        types: ['water'],
        stats: { hp: 120, attack: 60, defense: 40, spAttack: 30, spDefense: 40, speed: 80 },
      }),
    ),
    seed: 42,
    inputs: [{ t: 900, action: 'fast' }],
    untilMs: 1500,
  })
  assert.ok(drainResult.log.some((e) => e.kind === 'move' && e.side === 'wild' && e.damage > 0))
  assert.ok(drainResult.log.some((e) => e.kind === 'drain' && e.amount > 0))

  const recoilMove = move({
    name: 'take-down',
    type: 'normal',
    power: 90,
    damageClass: 'physical',
    drain: -25,
  })
  const recoilResult = runBattle({
    setup: setup(
      [
        fighter({
          id: 1,
          speciesId: 19,
          level: 30,
          fastMove: recoilMove,
          chargedMove: null,
          stats: { hp: 100, attack: 80, defense: 40, spAttack: 40, spDefense: 40, speed: 50 },
        }),
      ],
      fighter({
        speciesId: 16,
        level: 20,
        stats: { hp: 150, attack: 30, defense: 40, spAttack: 30, spDefense: 40, speed: 30 },
      }),
    ),
    seed: 7,
    inputs: [{ t: 0, action: 'fast' }],
    untilMs: 800,
  })
  assert.ok(recoilResult.log.some((e) => e.kind === 'recoil' && e.damage > 0))

  const rockHead = runBattle({
    setup: setup(
      [
        fighter({
          id: 1,
          speciesId: 19,
          level: 30,
          abilityKey: 'rock-head',
          fastMove: recoilMove,
          chargedMove: null,
          stats: { hp: 100, attack: 80, defense: 40, spAttack: 40, spDefense: 40, speed: 50 },
        }),
      ],
      fighter({
        speciesId: 16,
        level: 20,
        stats: { hp: 150, attack: 30, defense: 40, spAttack: 30, spDefense: 40, speed: 30 },
      }),
    ),
    seed: 7,
    inputs: [{ t: 0, action: 'fast' }],
    untilMs: 800,
  })
  assert.ok(!rockHead.log.some((e) => e.kind === 'recoil'))
})

test('setup antigo sem campos de efeito ainda roda', () => {
  const legacy = JSON.stringify({
    team: [
      {
        id: 1,
        speciesId: 4,
        level: 10,
        types: ['fire'],
        stats: { hp: 40, attack: 40, defense: 40, spAttack: 50, spDefense: 40, speed: 50 },
        fastMove: { name: 'ember', type: 'fire', power: 40, damageClass: 'special' },
        chargedMove: null,
        abilityKey: 'blaze',
      },
    ],
    wild: {
      id: null,
      speciesId: 16,
      level: 5,
      types: ['normal', 'flying'],
      stats: { hp: 30, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
      fastMove: { name: 'tackle', type: 'normal', power: 40, damageClass: 'physical' },
      chargedMove: null,
      abilityKey: 'none',
    },
  })
  const parsed = parseBattleSetup(legacy)
  assert.equal(parsed.team[0]!.fastMove.ailment, null)
  assert.equal(parsed.team[0]!.fastMove.drain, 0)
  const result = runBattle({
    setup: parsed,
    seed: 3,
    inputs: [{ t: 0, action: 'fast' }],
    untilMs: 2000,
  })
  assert.ok(result.log.some((e) => e.kind === 'move'))
  // Round-trip com campos novos
  const again = parseBattleSetup(JSON.stringify(serializeBattleSetup(parsed)))
  assert.equal(again.team[0]!.fastMove.critRate, 0)
})

test('determinismo com efeitos secundários', () => {
  const s = setup(
    [
      fighter({
        id: 1,
        speciesId: 4,
        level: 25,
        types: ['fire'],
        fastMove: move({
          name: 'ember',
          type: 'fire',
          power: 40,
          damageClass: 'special',
          ailment: 'burn',
          ailmentChance: 100,
        }),
        chargedMove: null,
        stats: { hp: 70, attack: 40, defense: 40, spAttack: 70, spDefense: 40, speed: 55 },
      }),
    ],
    fighter({
      speciesId: 16,
      level: 15,
      types: ['normal', 'flying'],
      stats: { hp: 180, attack: 30, defense: 40, spAttack: 30, spDefense: 40, speed: 40 },
    }),
  )
  const a = runBattle({ setup: s, seed: 99, inputs: [{ t: 0, action: 'fast' }, { t: 2000, action: 'fast' }] })
  const b = runBattle({ setup: s, seed: 99, inputs: [{ t: 0, action: 'fast' }, { t: 2000, action: 'fast' }] })
  assert.deepEqual(a, b)
})

test('Shield Dust bloqueia ailment; Serene Grace dobra chance', () => {
  assert.equal(effectChancePercent(10, false, true), 20)
  const ember = move({
    name: 'ember',
    type: 'fire',
    power: 40,
    damageClass: 'special',
    ailment: 'burn',
    ailmentChance: 100,
  })
  const shielded = runBattle({
    setup: setup(
      [
        fighter({
          id: 1,
          speciesId: 4,
          level: 20,
          types: ['fire'],
          fastMove: ember,
          chargedMove: null,
          stats: { hp: 80, attack: 40, defense: 40, spAttack: 70, spDefense: 40, speed: 60 },
        }),
      ],
      fighter({
        speciesId: 16,
        level: 10,
        abilityKey: 'shield-dust',
        stats: { hp: 200, attack: 20, defense: 40, spAttack: 20, spDefense: 40, speed: 20 },
      }),
    ),
    seed: 1,
    inputs: [{ t: 0, action: 'fast' }],
    untilMs: 500,
  })
  assert.ok(!shielded.log.some((e) => e.kind === 'status' && e.applied))
})

test('Guts: Ataque ×3/2 com status e ignora corte da queimadura', () => {
  const flat = emptyStages()
  const mon = fighter({
    speciesId: 1,
    level: 20,
    abilityKey: 'guts',
    stats: { hp: 50, attack: 100, defense: 40, spAttack: 40, spDefense: 40, speed: 40 },
  })
  const withBurn = offensiveStat(mon, 'physical', flat, 'burn', false)
  const plain = offensiveStat({ ...mon, abilityKey: 'none' }, 'physical', flat, null, false)
  assert.ok(withBurn > plain)
})

test('crítico: Battle Armor no atacante não impede o crítico dele', () => {
  const atk = fighter({
    id: 1,
    speciesId: 140,
    level: 50,
    abilityKey: 'battle-armor',
    fastMove: move({ name: 'slash', type: 'normal', power: 70, critRate: 1 }),
  })
  const def = fighter({ speciesId: 2, level: 50 })
  let crits = 0
  for (let seed = 1; seed <= 200; seed += 1) {
    if (rollCriticalAgainst(atk.fastMove, atk, def, mulberry32(seed))) crits += 1
  }
  assert.ok(crits > 0)
})

test('veneno volta a tirar vida quando o Pokémon sai e entra de novo', () => {
  // Chance 300 ÷ 3 no rápido = 100%: o primeiro golpe do selvagem envenena.
  const sting = move({ name: 'poison-sting', type: 'poison', power: 10, ailment: 'poison', ailmentChance: 300 })
  const tank = { hp: 200, attack: 10, defense: 200, spAttack: 10, spDefense: 200, speed: 40 }
  const result = runBattle({
    setup: setup(
      [
        fighter({ id: 1, speciesId: 1, level: 50, stats: tank, chargedMove: null }),
        fighter({ id: 2, speciesId: 4, level: 50, stats: tank, chargedMove: null }),
      ],
      fighter({ speciesId: 16, level: 50, stats: tank, fastMove: sting, chargedMove: null }),
    ),
    seed: 7,
    inputs: [
      { t: 3000, action: 'switch', slot: 1 },
      { t: 6000, action: 'switch', slot: 0 },
    ],
    untilMs: 10_000,
  })
  const back = result.log.find((e) => e.kind === 'enter' && e.side === 'player' && e.slot === 0 && e.t >= 6000)
  assert.ok(back, 'voltou para o slot 0')
  const ticksAfter = result.log.filter(
    (e) => e.kind === 'status_damage' && e.side === 'player' && e.t > 6000,
  )
  assert.ok(ticksAfter.length > 0)
})
