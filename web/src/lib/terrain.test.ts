import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MASK_KEYS,
  TILE_H,
  TILE_W,
  cellAt,
  defaultMask,
  inDiamond,
  overlaysAt,
  parseTileFile,
  tileOrigin,
  type TerrainGrid,
} from './terrain.js'

test('losangos cobrem o plano sem buraco nem sobreposição', () => {
  const hits = new Map<string, number>()
  for (let row = -3; row <= 3; row += 1) {
    for (let col = -3; col <= 3; col += 1) {
      const o = tileOrigin(col, row)
      for (let y = 0; y < TILE_H; y += 1) {
        for (let x = 0; x < TILE_W; x += 1) {
          if (!inDiamond(x, y)) continue
          const key = `${o.x + x},${o.y + y}`
          hits.set(key, (hits.get(key) ?? 0) + 1)
        }
      }
    }
  }
  // Uma janela no meio, longe da borda do recorte.
  for (let y = -6; y < 6; y += 1) {
    for (let x = -12; x < 12; x += 1) assert.equal(hits.get(`${x},${y}`), 1, `pixel ${x},${y}`)
  }
})

test('cellAt devolve o bloco de cada pixel', () => {
  for (const [col, row] of [[0, 0], [2, 1], [1, 3], [4, 4]] as const) {
    const o = tileOrigin(col, row)
    for (let y = 0; y < TILE_H; y += 1) {
      for (let x = 0; x < TILE_W; x += 1) {
        if (!inDiamond(x, y)) continue
        assert.deepEqual(cellAt(o.x + x + 0.5, o.y + y + 0.5), { col, row })
      }
    }
  }
})

test('máscaras padrão: dentro do losango, e o canto é parte dos dois lados', () => {
  for (const key of MASK_KEYS) {
    const mask = defaultMask(key)
    let on = 0
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) continue
      on += 1
      assert.ok(inDiamond(i % TILE_W, Math.floor(i / TILE_W)))
    }
    assert.ok(on > 0, key)
  }
  const ne = defaultMask('lado-ne')
  const n = defaultMask('canto-n')
  for (let i = 0; i < n.length; i += 1) if (n[i]) assert.equal(ne[i], 1)
})

const grid = (rows: string[]): TerrainGrid => {
  const map: Record<string, string> = { g: 'grama', t: 'terra', a: 'agua', '.': '' }
  const cells = rows.flatMap((line) => [...line].map((ch) => map[ch] || null))
  return { cols: rows[0]?.length ?? 0, rows: rows.length, cells }
}

test('overlaysAt: quem tem prioridade maior entra pelo lado; canto só quando os lados não são dele', () => {
  // Terra no meio, grama a nordeste (row − 1) e a sudeste (col + 1).
  const g = grid(['tgt', 'ttg', 'ttt'])
  assert.deepEqual(overlaysAt(g, 1, 1), [{ terrain: 'grama', masks: ['lado-ne', 'lado-se'] }])
  // A grama não recebe nada da terra.
  assert.deepEqual(overlaysAt(g, 1, 0), [])
  // Só a diagonal de cima (col − 1, row − 1) é grama: canto norte.
  const corner = grid(['gtt', 'ttt', 'ttt'])
  assert.deepEqual(overlaysAt(corner, 1, 1), [{ terrain: 'grama', masks: ['canto-n'] }])
  // A água está abaixo da terra na prioridade: não entra na terra.
  const two = grid(['ata', 'ttg', 'ttt'])
  assert.deepEqual(
    overlaysAt(two, 1, 1).map((o) => o.terrain),
    ['grama'],
  )
  const mixed = grid(['tgt', 'atg', 'ttt'])
  assert.deepEqual(overlaysAt(mixed, 1, 1).map((o) => o.terrain), ['grama'])
  // A água recebe a terra pelos lados e a grama pelo canto leste, por cima.
  assert.deepEqual(overlaysAt(mixed, 0, 1), [
    { terrain: 'terra', masks: ['lado-ne', 'lado-se', 'lado-so'] },
    { terrain: 'grama', masks: ['canto-l'] },
  ])
})

test('parseTileFile: terreno com variação e máscaras', () => {
  assert.deepEqual(parseTileFile('/x/grama-1.png'), { kind: 'terrain', terrain: 'grama', variant: 1 })
  assert.deepEqual(parseTileFile('agua-funda-2.png'), { kind: 'terrain', terrain: 'agua-funda', variant: 2 })
  assert.deepEqual(parseTileFile('mascara-lado-so.png'), { kind: 'mask', mask: 'lado-so' })
  assert.deepEqual(parseTileFile('mascara-canto-l.png'), { kind: 'mask', mask: 'canto-l' })
  assert.equal(parseTileFile('preview.png'), null)
})
