import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canLiveIn, type GardenCell, recognizeHabitats } from './index.js'

/** Um retângulo de casas com o mesmo chão (e objeto, se houver). */
function rect(col0: number, row0: number, w: number, h: number, floor: string | null, object: string | null = null): GardenCell[] {
  const out: GardenCell[] = []
  for (let row = row0; row < row0 + h; row += 1) {
    for (let col = col0; col < col0 + w; col += 1) out.push({ col, row, floor, object })
  }
  return out
}

/** Troca (ou põe) as casas de `patch` em `base`. */
function paint(base: GardenCell[], patch: GardenCell[]): GardenCell[] {
  const at = (c: GardenCell) => `${c.col},${c.row}`
  const map = new Map(base.map((c) => [at(c), c]))
  for (const cell of patch) map.set(at(cell), cell)
  return [...map.values()]
}

test('água ≥ 50% vira Lago; 6 casas dão 2 vagas, 10 dão 3', () => {
  const [small] = recognizeHabitats(paint(rect(0, 0, 3, 2, 'agua'), rect(0, 1, 1, 1, 'areia')))
  assert.equal(small?.biome, 'lago')
  assert.equal(small?.capacity, 2)
  assert.equal(small?.tiles.length, 6)
  const [big] = recognizeHabitats(rect(0, 0, 5, 2, 'agua'))
  assert.equal(big?.capacity, 3)
  const [huge] = recognizeHabitats(rect(0, 0, 6, 6, 'agua'))
  assert.equal(huge?.capacity, 3, 'mais de 3 vagas não')
})

test('pequena demais é decoração, mesmo com a mistura certa', () => {
  const [zone] = recognizeHabitats(rect(0, 0, 5, 1, 'agua'))
  assert.equal(zone?.tooSmall, true)
  assert.equal(zone?.biome, null)
  assert.equal(zone?.capacity, 0)
  assert.equal(zone?.nearest, null, 'a mistura bate: falta só tamanho')
})

test('areia, terra e pedra viram Rochedo só com pedra ≥ 20%', () => {
  const sandy = rect(0, 0, 3, 3, 'areia')
  const [noRock] = recognizeHabitats(sandy)
  assert.equal(noRock?.biome, 'basico', 'sem receita, vira básico')
  assert.equal(noRock?.capacity, 2)
  assert.equal(noRock?.nearest?.biome, 'rochedo')
  assert.deepEqual(noRock?.nearest?.gaps, [{ materials: ['pedra'], have: 0, need: 2 }])
  // Uma rocha (objeto, peso 3) em 9 casas: 3 de 12 pontos = 25% de pedra.
  const [rocky] = recognizeHabitats(paint(sandy, [{ col: 1, row: 1, floor: 'areia', object: 'rocha' }]))
  assert.equal(rocky?.biome, 'rochedo')
  assert.equal(rocky?.weight, 12)
})

test('objeto conta mais que o chão', () => {
  // 6 casas de grama com 2 rochas: planta 6 de 12 (50%) não é Pradaria; pedra 50% não é Rochedo (pedra+areia+terra 50%).
  const cells = paint(rect(0, 0, 3, 2, 'grama'), [
    { col: 0, row: 0, floor: 'grama', object: 'rocha' },
    { col: 2, row: 1, floor: 'grama', object: 'rocha' },
  ])
  const [zone] = recognizeHabitats(cells)
  assert.equal(zone?.fractions.planta, 0.5)
  assert.equal(zone?.fractions.pedra, 0.5)
  assert.equal(zone?.biome, 'basico')
})

test('a ordem das receitas decide: água vence planta', () => {
  // Metade água, metade grama: Lago (água ≥ 50%) vem antes da Pradaria.
  const [zone] = recognizeHabitats(paint(rect(0, 0, 4, 2, 'grama'), rect(0, 0, 4, 1, 'agua')))
  assert.equal(zone?.biome, 'lago')
})

test('gramado, caminho e cerca separam; encostar funde; diagonal não liga', () => {
  const left = rect(0, 0, 3, 2, 'agua')
  const right = rect(4, 0, 3, 2, 'grama')
  assert.equal(recognizeHabitats([...left, ...right]).length, 2, 'gramado no meio')
  assert.equal(recognizeHabitats([...left, ...right, ...rect(3, 0, 1, 2, 'caminho')]).length, 2, 'caminho no meio')
  assert.equal(recognizeHabitats([...left, ...right, ...rect(3, 0, 1, 2, 'grama', 'cerca')]).length, 2, 'cerca no meio')
  const merged = recognizeHabitats([...left, ...right, ...rect(3, 0, 1, 2, 'grama')])
  assert.equal(merged.length, 1, 'encostados viram uma zona só')
  assert.equal(merged[0]?.tiles.length, 14)
  const diagonal = recognizeHabitats([
    { col: 0, row: 0, floor: 'agua', object: null },
    { col: 1, row: 1, floor: 'agua', object: null },
  ])
  assert.equal(diagonal.length, 2)
})

test('objeto em cima do gramado conta; chave desconhecida é ignorada', () => {
  const trees = rect(0, 0, 3, 2, null, 'arvore')
  const [zone] = recognizeHabitats(trees)
  assert.equal(zone?.biome, 'pradaria')
  assert.equal(recognizeHabitats(rect(0, 0, 3, 3, 'marmore')).length, 0)
})

test('resultado não depende da ordem da entrada', () => {
  const cells = [...rect(0, 0, 3, 2, 'agua'), ...rect(5, 3, 2, 3, 'lava'), ...rect(5, 0, 3, 2, 'grama')]
  const a = recognizeHabitats(cells)
  const b = recognizeHabitats([...cells].reverse())
  assert.deepEqual(a, b)
  assert.deepEqual(
    a.map((z) => z.tiles[0]),
    [
      { col: 0, row: 0 },
      { col: 5, row: 0 },
      { col: 5, row: 3 },
    ],
  )
})

test('Cratera, Usina, Bosque sombrio e Campo gelado', () => {
  const crater = paint(rect(0, 0, 3, 2, 'lava'), rect(0, 0, 3, 1, 'pedra'))
  assert.equal(recognizeHabitats(crater)[0]?.biome, 'cratera')
  const plant = paint(rect(0, 0, 3, 2, 'terra'), [{ col: 0, row: 0, floor: 'terra', object: 'gerador' }])
  assert.equal(recognizeHabitats(plant)[0]?.biome, 'usina')
  assert.equal(recognizeHabitats(rect(0, 0, 3, 2, 'chao-escuro'))[0]?.biome, 'bosque-sombrio')
  assert.equal(recognizeHabitats(rect(0, 0, 3, 2, 'neve'))[0]?.biome, 'campo-gelado')
})

test('canLiveIn: um dos dois tipos basta; no básico, qualquer um', () => {
  assert.equal(canLiveIn(['fire'], 'basico'), true)
  assert.equal(canLiveIn(['grass', 'poison'], 'bosque-sombrio'), true)
  assert.equal(canLiveIn(['grass', 'poison'], 'pradaria'), true)
  assert.equal(canLiveIn(['fire'], 'lago'), false)
})
