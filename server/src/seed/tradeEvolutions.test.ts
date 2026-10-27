import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSpeciesSnapshot } from './apply.js'

// Gen 1–2: as evoluções por troca da PokéAPI (PLANNING.md, seção 5.15).
const GEN12_TRADE = [
  [61, 186], // Poliwhirl → Politoed
  [64, 65], // Kadabra → Alakazam
  [67, 68], // Machoke → Machamp
  [75, 76], // Graveler → Golem
  [79, 199], // Slowpoke → Slowking
  [93, 94], // Haunter → Gengar
  [95, 208], // Onix → Steelix
  [117, 230], // Seadra → Kingdra
  [123, 212], // Scyther → Scizor
  [137, 233], // Porygon → Porygon2
] as const

test('o snapshot marca exatamente as 10 evoluções por troca da Gen 1–2', () => {
  const { evolutions } = readSpeciesSnapshot()
  const trades = evolutions
    .filter((row) => row.viaTrade)
    .map((row) => [row.fromSpeciesId, row.toSpeciesId] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  assert.deepEqual(
    trades,
    [...GEN12_TRADE].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  )
  assert.equal(trades.length, 10)
})
