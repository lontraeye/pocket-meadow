// Conta do ritmo do jardim e da exploração (PROGRESSAO.md, item 7), lendo os
// configs de verdade: quanto entra e quanto sai por dia em cada capítulo, para
// um jogador de algumas sessões por dia. É uma média, não uma simulação de
// sorteios; serve para ver de onde vem o aperto quando um número muda.
//   npm run economia
//
// O modelo de jogador fica em PLAYER; mude ali para ver outro jeito de jogar.

import { APRICORN_ITEM, RECIPES, TREES, apricornConfig } from '../src/config/apricorn.js'
import { battleConfig } from '../src/config/battle.js'
import { FIRST_GROWTH_MULT, berries, bushDeathChance } from '../src/config/berries.js'
import { BUILD_RECIPES, STONE_ITEM, WOOD_ITEM } from '../src/config/buildRecipes.js'
import { gardenUnlocks } from '../src/config/gardenUnlocks.js'
import { healConfig } from '../src/config/heal.js'
import { milestoneConfigs } from '../src/config/milestones.js'
import { petConfig } from '../src/config/pets.js'
import { progressConfig } from '../src/config/progress.js'
import { spotDropsConfig } from '../src/config/spotDrops.js'
import { trainerConfig } from '../src/config/trainer.js'

const PLAYER = {
  /** Sessões por dia e o intervalo entre elas (a noite fecha as 24 h). */
  sessionsPerDay: 4,
  gapHours: 4,
  /** Johto em ~3 semanas: 9 capítulos (8 líderes + Liga). */
  daysPerChapter: 21 / 9,
  /** Da energia, quanto vai para revelar campo; o resto vai para as manchas (árvore, pedra). */
  fieldShare: 0.7,
  /** Tenta capturar 1 de cada N Pokémon enfrentados. */
  captureEvery: 3,
  /** Chance média por bola: comuns no começo (~75%), mais raros no fim (~45%). */
  catchChance: (chapter: number) => 0.75 - (0.3 * (chapter - 1)) / 8,
  /** Quantos do time entram em média por luta (cada um paga a fome da luta). */
  fightersPerFight: 1.5,
  /** O time cresce: 2 no capítulo 1, cheio (6) do 5 em diante. */
  teamSize: (chapter: number) => Math.min(6, chapter + 1),
  /** Canteiros com Oran (o resto planta berry de captura). */
  oranPlotShare: 0.5,
  /** Apricorns vermelhos das missões do dia (3 comuns × 2 e o baú com 3; config/missions). */
  missionApricorns: 9,
}

const hour = 60 * 60 * 1000
const dayHours = 24

/** Média de um sorteio de tabela: quanto do item sai por uso da mancha. */
function perUse(table: readonly { itemKey: string; weight: number; min?: number; max?: number }[], itemKey: string): number {
  const total = table.reduce((sum, row) => sum + row.weight, 0)
  const row = table.find((entry) => entry.itemKey === itemKey)
  if (!row || total === 0) return 0
  const quantity = ((row.min ?? 1) + (row.max ?? 1)) / 2
  return spotDropsConfig.chance * (row.weight / total) * quantity
}

/** Colheitas esperadas de um arbusto antes de secar. */
function harvestsPerBush(): number {
  let alive = 1
  let expected = 0
  for (let n = 1; n <= 50 && alive > 0; n += 1) {
    expected += alive
    alive *= 1 - bushDeathChance(n)
  }
  return expected
}

/** Colheitas por dia de um canteiro: limitadas pelo crescimento e pelas sessões. */
function harvestsPerDay(growMs: number): number {
  const growHours = growMs / hour
  const bySessions = PLAYER.sessionsPerDay
  const byGrowth = dayHours / Math.max(growHours, PLAYER.gapHours)
  const steady = Math.min(bySessions, byGrowth)
  // O primeiro crescimento leva FIRST_GROWTH_MULT vezes; dilui na vida do arbusto.
  const life = harvestsPerBush()
  return steady * (life / (life + FIRST_GROWTH_MULT - 1))
}

function energyPerDay(): number {
  const regenHours = progressConfig.energyRegenMs / hour
  const perGap = Math.min(trainerConfig.energyMax, PLAYER.gapHours / regenHours)
  return trainerConfig.energyMax + (PLAYER.sessionsPerDay - 1) * perGap
}

function fmt(value: number, digits = 0): string {
  return value.toFixed(digits).replace('.', ',')
}

const headbutt = spotDropsConfig.tables.headbutt
const rockSmash = spotDropsConfig.tables.rockSmash
const woodPerHeadbutt = perUse(headbutt, WOOD_ITEM)
const stonePerSmash = perUse(rockSmash, STONE_ITEM)
const apricornPerHeadbutt = perUse(headbutt, APRICORN_ITEM)
const oran = berries.oran
const oranPerPlotDay = harvestsPerDay(oran.growMs) * ((oran.yield[0] + oran.yield[1]) / 2)
const redTree = TREES.find((tree) => tree.key === 'apricorn_tree')!
const pokeRecipe = RECIPES.find((recipe) => recipe.key === 'poke_ball')!

console.log('Modelo:', JSON.stringify(PLAYER), '(time = min(6, cap. + 1); captura de 75% a 45%)')
console.log(
  `Por uso: ${fmt(woodPerHeadbutt, 2)} madeira e ${fmt(apricornPerHeadbutt, 2)} Apricorn por Headbutt; ${fmt(stonePerSmash, 2)} pedra por Rock Smash.`,
)
console.log(`Arbusto: ${fmt(harvestsPerBush(), 1)} colheitas antes de secar; Oran rende ${fmt(oranPerPlotDay, 1)} por canteiro por dia.`)
for (const recipe of BUILD_RECIPES) {
  const wood = recipe.cost.find((row) => row.itemKey === WOOD_ITEM)?.quantity ?? 0
  const stone = recipe.cost.find((row) => row.itemKey === STONE_ITEM)?.quantity ?? 0
  const uses = wood / woodPerHeadbutt + stone / stonePerSmash
  console.log(`Receita ${recipe.piece}: ${wood} madeira, ${stone} pedra → ~${fmt(uses)} usos de mancha.`)
}
console.log('')

const header = ['Cap.', 'Energia/dia', 'Lutas/dia', 'Manchas/dia', 'Madeira/dia', 'Pedra/dia', 'Berries +/−', 'Bolas +/−', 'Curas/dia']
console.log(`| ${header.join(' | ')} |`)
console.log(`|${header.map(() => '---').join('|')}|`)

for (let chapter = 1; chapter <= milestoneConfigs.length; chapter += 1) {
  // No capítulo N, os marcos dos capítulos anteriores já caíram.
  const cleared = new Set(milestoneConfigs.slice(0, chapter - 1).map((milestone) => milestone.key))
  const unlocks = gardenUnlocks(cleared)
  const hasHeadbutt = cleared.has('azalea')
  const hasRockSmash = cleared.has('ecruteak')

  const energy = energyPerDay()
  const spotShare = hasHeadbutt ? 1 - PLAYER.fieldShare : 0
  const fights = energy * (1 - spotShare) * battleConfig.fieldSize
  const spots = energy * spotShare
  const headbutts = hasRockSmash ? spots / 2 : spots
  const smashes = hasRockSmash ? spots / 2 : 0
  const wood = headbutts * woodPerHeadbutt
  const stone = smashes * stonePerSmash

  // Berries: Oran dos canteiros contra a fome do time (o dia todo e as lutas).
  const berriesIn = unlocks.plotLimit * PLAYER.oranPlotShare * oranPerPlotDay
  const drain = PLAYER.teamSize(chapter) * petConfig.hungerDrainPerHour * dayHours
  const fightHunger = fights * PLAYER.fightersPerFight * petConfig.battleHungerCost
  const berriesOut = (drain + fightHunger) / petConfig.berryFill

  // Bolas: árvores vermelhas na bancada contra as tentativas de captura.
  const redTrees = unlocks.capOf('apricorn_tree')
  const apricorns =
    redTrees * (dayHours / (redTree.intervalMs / hour)) + headbutts * apricornPerHeadbutt + PLAYER.missionApricorns
  // A bancada roda um lote por sessão (no nível mais alto que o capítulo deixa).
  const bench = apricornConfig.bench.levels[unlocks.benchMaxLevel - 1]!
  const benchPerDay = PLAYER.sessionsPerDay * bench.batchSize
  const ballsIn = Math.min(apricorns, benchPerDay) * pokeRecipe.perUnit
  const ballsOut = fights / PLAYER.captureEvery / PLAYER.catchChance(chapter)

  const heals = unlocks.capOf('heal_machine') * (dayHours / (healConfig.machine.rechargeMs / hour))

  console.log(
    `| ${[
      chapter,
      fmt(energy),
      fmt(fights),
      fmt(spots),
      fmt(wood, 1),
      fmt(stone, 1),
      `${fmt(berriesIn)} / ${fmt(berriesOut)}`,
      `${fmt(ballsIn)} / ${fmt(ballsOut)}`,
      fmt(heals),
    ].join(' | ')} |`,
  )
}
