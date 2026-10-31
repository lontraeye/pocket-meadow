import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mulberry32 } from './rng.js'
import {
  canLearnMove,
  isFastMove,
  learnChargedOnLevelUp,
  pickWeightedMove,
  rerollCandidates,
  resolveAbilityKey,
  rollLevelOffer,
  rollMoves,
  rollTraits,
  traitsRngSeed,
  type MoveInfo,
} from './traits.js'

const moves = new Map([
  ['scratch', { name: 'scratch', displayName: 'Scratch', type: 'normal', power: 40, damageClass: 'physical' as const }],
  ['ember', { name: 'ember', displayName: 'Ember', type: 'fire', power: 40, damageClass: 'special' as const }],
  ['flamethrower', { name: 'flamethrower', displayName: 'Flamethrower', type: 'fire', power: 90, damageClass: 'special' as const }],
  ['slash', { name: 'slash', displayName: 'Slash', type: 'normal', power: 70, damageClass: 'physical' as const }],
  ['fire-spin', { name: 'fire-spin', displayName: 'Fire Spin', type: 'fire', power: 35, damageClass: 'special' as const }],
  ['tackle', { name: 'tackle', displayName: 'Tackle', type: 'normal', power: 40, damageClass: 'physical' as const }],
])

const learnset = [
  { move: 'scratch', level: 1 },
  { move: 'ember', level: 7 },
  { move: 'slash', level: 20 },
  { move: 'flamethrower', level: 31 },
]

test('isFastMove corta em 55', () => {
  assert.equal(isFastMove(55), true)
  assert.equal(isFastMove(56), false)
})

test('rollTraits é determinístico pela seed derivada', () => {
  const seed = traitsRngSeed(42)
  const input = {
    level: 5,
    learnset,
    abilities: { slot1: 'blaze', slot2: null, hidden: 'solar-power' },
    moves,
  }
  const a = rollTraits(mulberry32(seed), input)
  const b = rollTraits(mulberry32(seed), input)
  assert.deepEqual(a, b)
  assert.equal(a.evs.attack, 0)
  assert.ok(a.ivs.hp >= 0 && a.ivs.hp <= 31)
  assert.equal(a.chargedMove, null)
  assert.equal(a.fastMove, 'scratch')
})

test('sem rápido no nível usa o primeiro da espécie ou tackle', () => {
  const rolled = rollTraits(mulberry32(1), {
    level: 1,
    learnset: [{ move: 'flamethrower', level: 1 }],
    abilities: { slot1: 'blaze', slot2: null, hidden: null },
    moves,
  })
  assert.equal(rolled.fastMove, 'tackle')
  assert.equal(rolled.chargedMove, 'flamethrower')
})

test('resolveAbilityKey cai na 1ª sem segunda ou oculta', () => {
  assert.equal(resolveAbilityKey({ slot1: 'blaze', slot2: null, hidden: 'solar-power' }, '2'), 'blaze')
  assert.equal(resolveAbilityKey({ slot1: 'blaze', slot2: null, hidden: 'solar-power' }, 'hidden'), 'solar-power')
})

test('canLearnMove aceita só o pool até o nível', () => {
  assert.equal(canLearnMove(learnset, 5, 'scratch', moves), true)
  assert.equal(canLearnMove(learnset, 5, 'flamethrower', moves), false)
  assert.equal(canLearnMove(learnset, 31, 'flamethrower', moves), true)
})

// Rng fixo: devolve os valores da lista, um por chamada.
const fixed = (...values: number[]) => () => values.shift() ?? 0

test('slot de carregado vazio: entra um carregado sorteado entre os que conhece', () => {
  // No Nv 31 conhece slash (20) e flamethrower (31): 0,9 sorteia o 2º.
  const charged = learnChargedOnLevelUp(fixed(0.9), {
    fromLevel: 19,
    toLevel: 31,
    learnset,
    moves,
    chargedMove: null,
  })
  assert.equal(charged, 'flamethrower')
  assert.equal(
    learnChargedOnLevelUp(fixed(0), { fromLevel: 19, toLevel: 31, learnset, moves, chargedMove: null }),
    'slash',
  )
})

test('com carregado no slot, subir de nível não troca nada (sem ofertas)', () => {
  const charged = learnChargedOnLevelUp(fixed(0.9), {
    fromLevel: 19,
    toLevel: 31,
    learnset,
    moves,
    chargedMove: 'slash',
  })
  assert.equal(charged, 'slash')
})

test('antes do primeiro carregado da espécie o slot continua vazio', () => {
  assert.equal(
    learnChargedOnLevelUp(fixed(0.5), { fromLevel: 5, toLevel: 19, learnset, moves, chargedMove: null }),
    null,
  )
})

test('evoluir sorteia os dois golpes de novo pelo conjunto da espécie', () => {
  // Nv 31: rápidos scratch e ember; carregados slash e flamethrower.
  assert.deepEqual(rollMoves(fixed(0.9, 0.9), 31, learnset, moves), { fast: 'ember', charged: 'flamethrower' })
  assert.deepEqual(rollMoves(fixed(0, 0), 31, learnset, moves), { fast: 'scratch', charged: 'slash' })
})

// ---- Golpes que evoluem (5.18, revisto em 2026-10-31) ----------------------

function moveInfo(name: string, power: number): MoveInfo {
  return { name, displayName: name, type: 'normal', power, damageClass: 'physical' } as MoveInfo
}

test('sorteio com peso: o golpe mais forte cai menos', () => {
  const pool = [moveInfo('weak', 40), moveInfo('strong', 120)]
  const rng = mulberry32(11)
  const count = { weak: 0, strong: 0 }
  for (let i = 0; i < 4000; i += 1) count[pickWeightedMove(rng, pool)!.name as 'weak' | 'strong'] += 1
  // Peso 1/40 contra 1/120: o forte sai em ~25% das vezes.
  assert.ok(count.strong > 800 && count.strong < 1200, String(count.strong))
})

test('oferta ao subir de nível: só nos níveis em que a linha aprende golpe, nunca o atual', () => {
  const moves = new Map([
    ['scratch', moveInfo('scratch', 40)],
    ['ember', moveInfo('ember', 40)],
    ['slash', moveInfo('slash', 70)],
    ['flamethrower', moveInfo('flamethrower', 90)],
  ])
  const learnset = [
    { move: 'scratch', level: 1 },
    { move: 'ember', level: 7 },
    { move: 'slash', level: 1 },
    { move: 'flamethrower', level: 31 },
  ]
  const always = () => 0 // toda chance acerta
  // Do 2 ao 6 a linha não aprende nada: sem oferta.
  assert.equal(
    rollLevelOffer(always, { fromLevel: 2, toLevel: 6, learnset, moves, fastMove: 'scratch', chargedMove: 'slash' }),
    null,
  )
  // No 7 entra o Ember (rápido): a oferta é rápida e diferente do Scratch.
  const offer = rollLevelOffer(always, { fromLevel: 6, toLevel: 7, learnset, moves, fastMove: 'scratch', chargedMove: 'slash' })
  assert.equal(offer?.name, 'ember')
  // Sem sorte, sem oferta.
  const never = () => 0.99
  assert.equal(
    rollLevelOffer(never, { fromLevel: 6, toLevel: 7, learnset, moves, fastMove: 'scratch', chargedMove: 'slash' }),
    null,
  )
})

test('doce nunca piora: só golpes iguais ou mais fortes, liberados no nível', () => {
  const moves = new Map([
    ['ember', moveInfo('ember', 40)],
    ['slash', moveInfo('slash', 70)],
    ['bite', moveInfo('bite', 60)],
    ['flamethrower', moveInfo('flamethrower', 90)],
  ])
  const learnset = [
    { move: 'ember', level: 1 },
    { move: 'bite', level: 1 },
    { move: 'slash', level: 10 },
    { move: 'flamethrower', level: 31 },
  ]
  assert.deepEqual(
    rerollCandidates(learnset, 20, moves, 'charged', 'bite').map((info) => info.name),
    ['slash'],
  )
  assert.deepEqual(
    rerollCandidates(learnset, 40, moves, 'charged', 'slash').map((info) => info.name),
    ['flamethrower'],
  )
  assert.deepEqual(rerollCandidates(learnset, 40, moves, 'charged', 'flamethrower'), [])
})
