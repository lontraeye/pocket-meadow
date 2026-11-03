import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HEAL_ANIM_TOTAL_MS, HEAL_IDLE, healAnimFrame } from './healMachineFrames.ts'

test('idle e animação de cura: enche, brilha e volta vazia', () => {
  assert.equal(HEAL_IDLE, 0)
  assert.equal(healAnimFrame(0), 0)
  assert.equal(healAnimFrame(80), 1)
  assert.equal(healAnimFrame(HEAL_ANIM_TOTAL_MS - 1), 0)
  assert.equal(healAnimFrame(HEAL_ANIM_TOTAL_MS), null)
  assert.equal(healAnimFrame(HEAL_ANIM_TOTAL_MS + 500), null)
})
