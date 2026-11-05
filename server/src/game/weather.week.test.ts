import assert from 'node:assert/strict'
import test from 'node:test'
import { weekStartAt } from './weather.js'

test('a semana vira na segunda, meia-noite de Brasília', () => {
  // Quarta, 2026-11-04 15:00 em Brasília (18:00 UTC) → segunda, 2026-11-02 00:00 em Brasília (03:00 UTC).
  assert.equal(weekStartAt(Date.UTC(2026, 10, 4, 18)), Date.UTC(2026, 10, 2, 3))
  // Segunda 00:30 em Brasília já é a semana nova; domingo 23:30, a anterior.
  assert.equal(weekStartAt(Date.UTC(2026, 10, 9, 3, 30)), Date.UTC(2026, 10, 9, 3))
  assert.equal(weekStartAt(Date.UTC(2026, 10, 9, 2, 30)), Date.UTC(2026, 10, 2, 3))
})
