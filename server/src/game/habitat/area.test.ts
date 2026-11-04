import assert from 'node:assert/strict'
import test from 'node:test'
import { canLiveInKind, checkHabitat, isConnected, kindBonus, type CellLook } from './area.js'

const strip = (n: number, row = 0) => Array.from({ length: n }, (_, col) => ({ col, row }))
/** Chão por casa a partir de um mapa "col,row" → chão. */
const lookOf = (floors: Record<string, string>, objects: Record<string, string> = {}): CellLook => (col, row) => {
  const floor = floors[`${col},${row}`] ?? null
  const object = objects[`${col},${row}`] ?? null
  return floor === null && object === null ? null : { floor, object }
}

test('casas que se tocam formam um bloco; diagonal não liga', () => {
  assert.equal(isConnected(strip(4)), true)
  assert.equal(isConnected([{ col: 0, row: 0 }, { col: 1, row: 1 }]), false)
  assert.equal(isConnected([]), false)
})

test('o tipo pede metade da área em pontos do material; o resto do chão é livre', () => {
  // Lago de 8 casas pede 4 pontos de água: 3 não fecha, 4 fecha (com margem de areia).
  const tiles = strip(8)
  const three = lookOf({ '0,0': 'agua', '1,0': 'agua', '2,0': 'agua-funda', '3,0': 'areia' })
  assert.deepEqual(checkHabitat('lago', tiles, three), { size: 8, points: 3, need: 4, tooSmall: false, ready: false, capacity: 0 })
  const four = lookOf({ '0,0': 'agua', '1,0': 'agua', '2,0': 'agua-funda', '3,0': 'agua', '4,0': 'areia' })
  assert.equal(checkHabitat('lago', tiles, four).ready, true)
  assert.equal(checkHabitat('lago', tiles, four).capacity, 2)

  // Rochedo conta pedra, areia e terra; 10 casas dão 3 vagas e pedem 5.
  const rocks = lookOf({ '0,0': 'pedra', '1,0': 'areia', '2,0': 'terra', '3,0': 'pedra', '4,0': 'areia' })
  const big = checkHabitat('rochedo', strip(10), rocks)
  assert.deepEqual([big.points, big.need, big.ready, big.capacity], [5, 5, true, 3])
})

test('móvel do material dentro da área vale mais um ponto', () => {
  const look = lookOf({ '0,0': 'pedra', '1,0': 'pedra' }, { '0,0': 'rocha', '2,0': 'rocha' })
  assert.equal(checkHabitat('rochedo', strip(6), look).points, 4)
})

test('pequeno não fica pronto; o básico não pede ponto e aceita qualquer um, sem bônus', () => {
  const empty = lookOf({})
  assert.equal(checkHabitat('pradaria', strip(5), lookOf({ '0,0': 'flores', '1,0': 'flores', '2,0': 'flores' })).tooSmall, true)
  const basic = checkHabitat('basico', strip(6), empty)
  assert.deepEqual([basic.need, basic.ready, basic.capacity], [0, true, 2])
  assert.equal(canLiveInKind(['rock'], 'basico'), true)
  assert.equal(kindBonus(['rock'], 'basico', true), false)
  assert.equal(canLiveInKind(['grass'], 'lago'), false)
  assert.equal(kindBonus(['water', 'flying'], 'lago', true), true)
  assert.equal(kindBonus(['water'], 'lago', false), false)
})
