import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calmAgitation, fleeChanceAt } from './flee.js'

test('fuga sobe a cada erro e tem teto', () => {
  assert.equal(fleeChanceAt(1), 0.1)
  assert.equal(fleeChanceAt(2), 0.25)
  assert.equal(fleeChanceAt(3), 0.4)
  assert.equal(fleeChanceAt(7), 0.9)
  assert.equal(fleeChanceAt(20), 0.9)
})

test('acalmar reduz ou zera a agitação', () => {
  assert.equal(calmAgitation(5, 2), 3)
  assert.equal(calmAgitation(1, 2), 0)
  assert.equal(calmAgitation(4, 'all'), 0)
  assert.equal(calmAgitation(3, undefined), 3)
})
