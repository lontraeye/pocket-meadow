import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ballMultiplier, ballsConfig, isMasterBall, rollBattleBall } from './balls.js'
import { mulberry32 } from '../game/mulberry32.js'

test('multiplicadores fixos', () => {
  const base = { throwIndex: 0, wildLevel: 10, types: ['normal'] as const }
  assert.equal(ballMultiplier({ key: 'poke', ...base }), 1)
  assert.equal(ballMultiplier({ key: 'premier', ...base }), 1)
  assert.equal(ballMultiplier({ key: 'luxury', ...base }), 1)
  assert.equal(ballMultiplier({ key: 'great', ...base }), 1.5)
  assert.equal(ballMultiplier({ key: 'ultra', ...base }), 2)
  assert.equal(ballMultiplier({ key: 'master', ...base }), 1)
  assert.ok(isMasterBall('master'))
})

test('Quick Ball: ×4 no 1º lançamento, ×1 depois', () => {
  const types = ['normal'] as const
  assert.equal(ballMultiplier({ key: 'quick', throwIndex: 0, wildLevel: 20, types }), 4)
  assert.equal(ballMultiplier({ key: 'quick', throwIndex: 1, wildLevel: 20, types }), 1)
  assert.equal(ballMultiplier({ key: 'quick', throwIndex: 5, wildLevel: 20, types }), 1)
})

test('Timer Ball: cresce com lançamentos anteriores, teto ×4', () => {
  const types = ['normal'] as const
  assert.equal(ballMultiplier({ key: 'timer', throwIndex: 0, wildLevel: 20, types }), 1)
  assert.equal(ballMultiplier({ key: 'timer', throwIndex: 1, wildLevel: 20, types }), 1.3)
  assert.equal(ballMultiplier({ key: 'timer', throwIndex: 5, wildLevel: 20, types }), 2.5)
  assert.equal(ballMultiplier({ key: 'timer', throwIndex: 10, wildLevel: 20, types }), 4)
  assert.equal(ballMultiplier({ key: 'timer', throwIndex: 20, wildLevel: 20, types }), 4)
})

test('Net Ball: ×3 contra Inseto ou Água', () => {
  const base = { key: 'net', throwIndex: 0, wildLevel: 15 }
  assert.equal(ballMultiplier({ ...base, types: ['bug'] }), 3)
  assert.equal(ballMultiplier({ ...base, types: ['water'] }), 3)
  assert.equal(ballMultiplier({ ...base, types: ['water', 'flying'] }), 3)
  assert.equal(ballMultiplier({ ...base, types: ['fire'] }), 1)
  assert.equal(ballMultiplier({ ...base, types: ['normal', 'flying'] }), 1)
})

test('Nest Ball: forte em nível baixo, teto ×4', () => {
  const types = ['normal'] as const
  assert.equal(ballMultiplier({ key: 'nest', throwIndex: 0, wildLevel: 1, types }), 4)
  assert.equal(ballMultiplier({ key: 'nest', throwIndex: 0, wildLevel: 11, types }), 3)
  assert.equal(ballMultiplier({ key: 'nest', throwIndex: 0, wildLevel: 31, types }), 1)
  assert.equal(ballMultiplier({ key: 'nest', throwIndex: 0, wildLevel: 41, types }), 1)
  assert.equal(ballMultiplier({ key: 'nest', throwIndex: 0, wildLevel: 50, types }), 1)
})

test('rollBattleBall: acha bola na chance do config, com quantidade da tabela', () => {
  let found = 0
  let rolls = 0
  for (let seed = 1; seed <= 2000; seed += 1) {
    const drop = rollBattleBall(mulberry32(seed))
    rolls += 1
    if (!drop) continue
    found += 1
    assert.ok(drop.itemKey === 'ball:poke' || drop.itemKey === 'ball:great')
    assert.ok(drop.quantity >= 1 && drop.quantity <= 2)
  }
  const rate = found / rolls
  assert.ok(Math.abs(rate - ballsConfig.battleDrop.chance) < 0.05, `taxa ${rate}`)
})
