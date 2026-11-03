import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readyStatus, shouldShowReadyBanner, type ReadyInput } from './ready.ts'

const now = 1_000_000

function input(over: Partial<ReadyInput> = {}): ReadyInput {
  return {
    plots: [],
    daycare: { slots: [] },
    missions: { day: '2026-11-03', list: [], chest: { ready: false, claimed: false, reward: { trainerXp: 0, genericCandies: 0, items: [] } } },
    gifts: [],
    pets: [],
    needThreshold: 40,
    trees: [{ key: 'apricorn_tree', unlocked: true, ready: 0, cap: 5, readyAts: [now + 1000] }],
    benchJob: null,
    ...over,
  }
}

const mission = (id: number, done: boolean, claimed: boolean) =>
  ({ id, done, claimed }) as ReadyInput['missions']['list'][number]
const pet = (id: number, hunger: number, affection: number, petReadyAt: number | null = null) => ({
  id,
  pet: { hunger, affection, petReadyAt },
})

test('nada pronto: sem aviso', () => {
  const ready = readyStatus(input({ pets: [pet(1, 80, 80)] }), now)
  assert.equal(ready.summary, null)
  assert.equal(ready.target, null)
  assert.equal(shouldShowReadyBanner(ready, []), false)
})

test('junta tudo na ordem: o que tem lugar primeiro, depois o que está no jardim', () => {
  const ready = readyStatus(
    input({
      plots: [{ plotIndex: 2, readyAt: now - 1 }, { plotIndex: 0, readyAt: now + 1 }],
      missions: { ...input().missions, list: [mission(1, true, false), mission(2, true, true), mission(3, false, false)] },
      gifts: [{ id: 5 }, { id: 6 }],
      pets: [pet(1, 10, 80), pet(2, 30, 10), pet(3, 90, 10, now + 60_000)],
    }),
    now,
  )
  assert.equal(ready.summary, '1 berry pronta · 1 missão pronta · 2 presentes · 2 com fome · 1 quer carinho')
  assert.deepEqual(ready.readyPlots, [2])
  assert.equal(ready.target, 'plot')
  assert.deepEqual(ready.ids, [`p2@${now - 1}`, 'm1', 'g5', 'g6', 'h1', 'h2', 'a2'])
})

test('sem berry, o toque vai para as missões; o baú conta', () => {
  const ready = readyStatus(
    input({ missions: { ...input().missions, chest: { ...input().missions.chest, ready: true } } }),
    now,
  )
  assert.equal(ready.summary, 'baú pronto')
  assert.equal(ready.target, 'missions')
  assert.deepEqual(ready.ids, ['c2026-11-03'])
})

test('baú já resgatado não aparece', () => {
  const ready = readyStatus(
    input({ missions: { ...input().missions, chest: { ...input().missions.chest, ready: true, claimed: true } } }),
    now,
  )
  assert.equal(ready.summary, null)
})

test('só presentes e pets: sem lugar para ir', () => {
  const ready = readyStatus(input({ gifts: [{ id: 1 }], pets: [pet(1, 10, 80)] }), now)
  assert.equal(ready.target, null)
  assert.equal(ready.summary, '1 presente · 1 com fome')
})

test('dispensado volta a aparecer quando surge algo novo', () => {
  const first = readyStatus(input({ gifts: [{ id: 1 }] }), now)
  assert.equal(shouldShowReadyBanner(first, first.ids), false)
  const later = readyStatus(input({ gifts: [{ id: 1 }, { id: 2 }] }), now)
  assert.equal(shouldShowReadyBanner(later, first.ids), true)
})

test('árvore cheia entra no aviso, também quando enche com o app aberto', () => {
  const full = readyStatus(input({ trees: [{ key: 'apricorn_tree', unlocked: true, ready: 5, cap: 5, readyAts: [] }] }), now)
  assert.equal(full.summary, 'árvore cheia')
  assert.equal(full.target, null)
  const filling = { key: 'apricorn_tree', unlocked: true, ready: 4, cap: 5, readyAts: [now + 1000] }
  assert.equal(readyStatus(input({ trees: [filling] }), now).summary, null)
  assert.equal(readyStatus(input({ trees: [filling] }), now + 1000).summary, 'árvore cheia')
  const locked = { key: 'apricorn_tree', unlocked: false, ready: 0, cap: 5, readyAts: [] }
  assert.equal(readyStatus(input({ trees: [{ ...locked, ready: 5 }] }), now).summary, null)
})

test('bolas prontas na bancada, sem contar as já coletadas', () => {
  const job = { id: 3, quantity: 5, unitMs: 1000, startedAt: now - 3500, collected: 1, perUnit: 1 }
  const ready = readyStatus(input({ benchJob: job }), now)
  assert.equal(ready.summary, '2 bolas prontas')
  assert.deepEqual(ready.ids, ['b3@parcial'])
  assert.equal(readyStatus(input({ benchJob: { ...job, collected: 3 } }), now).summary, null)
  assert.deepEqual(readyStatus(input({ benchJob: job }), now + 2000).ids, ['b3@fim'])
  // Com 2 Poké Balls por Apricorn, o aviso conta bolas.
  assert.equal(readyStatus(input({ benchJob: { ...job, perUnit: 2 } }), now).summary, '4 bolas prontas')
})

test('arbusto seco não conta como berry pronta, mas avisa', () => {
  const ready = readyStatus(input({ plots: [{ plotIndex: 1, readyAt: now - 10, deadAt: now - 5 }] }), now)
  assert.equal(ready.berryCount, 0)
  assert.equal(ready.summary, '1 arbusto seco')
  assert.equal(ready.target, null)
})

test('várias árvores cheias somam no aviso', () => {
  const full = (key: string) => ({ key, unlocked: true, ready: 5, cap: 5, readyAts: [] })
  const ready = readyStatus(input({ trees: [full('apricorn_tree'), full('apricorn_tree_blue')] }), now)
  assert.equal(ready.summary, '2 árvores cheias')
})
