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
import { catchUpMult, daycareConfig, daycareXpPerHour } from '../src/config/daycare.js'
import { leaderConfigs } from '../src/config/leaders.js'
import { leagueTrainers } from '../src/config/league.js'
import { loadRegions } from '../src/config/regions.js'
import { battleXp } from '../src/game/battle.js'
import { gardenXp } from '../src/game/pets.js'
import { grantXp } from '../src/game/xp.js'
import { readSpeciesSnapshot } from '../src/seed/apply.js'

const PLAYER = {
  /** Sessões por dia e o intervalo entre elas (a noite fecha as 24 h). */
  sessionsPerDay: 4,
  gapHours: 4,
  /** Minutos de cada sessão e de cada luta (contando achar o encontro): o tempo também limita as lutas. */
  minutesPerSession: 12,
  minutesPerFight: 1.5,
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
  /** O time vence o líder com tantos membros quanto ele tem, cada um neste tanto abaixo do ás. */
  leaderMargin: 2,
  /** Felicidade média do time no jardim (XP de pet). */
  happiness: 80,
  /** Cuidador do daycare a partir do capítulo 2 (o primeiro tier, Sentret e cia.). */
  caretakerMult: 1.25,
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

/** Lutas por dia no capítulo: a energia dos campos ou o tempo das sessões, o que acabar antes. */
function fightsPerDay(chapter: number): number {
  const cleared = new Set(milestoneConfigs.slice(0, chapter - 1).map((milestone) => milestone.key))
  const spotShare = cleared.has('azalea') ? 1 - PLAYER.fieldShare : 0
  const byEnergy = energyPerDay() * (1 - spotShare) * battleConfig.fieldSize
  const byTime = (PLAYER.sessionsPerDay * PLAYER.minutesPerSession) / PLAYER.minutesPerFight
  return Math.min(byEnergy, byTime)
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
  const fights = fightsPerDay(chapter)
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

// ---------------------------------------------------------------------------
// Tempo da campanha: quantos dias o time leva para chegar ao nível de cada
// líder, com o XP das lutas (no mato do capítulo), do daycare e do jardim.


const baseExperience = new Map(readSpeciesSnapshot().species.map((row) => [row.id, row.baseExperience]))
const regions = loadRegions()

/** Mato do capítulo: espécie, nível do meio e peso de cada slot. */
function chapterSlots(chapter: number) {
  return regions
    .filter((region) => region.chapter === chapter)
    .flatMap((region) => region.slots)
    .map((slot) => ({
      base: baseExperience.get(slot.speciesId) ?? 50,
      level: Math.round((slot.minLevel + slot.maxLevel) / 2),
      weight: slot.weight,
    }))
}

/** XP médio de uma vitória no mato do capítulo para um Pokémon do nível dado. */
function xpPerFight(chapter: number, fighterLevel: number): number {
  const slots = chapterSlots(chapter)
  const total = slots.reduce((sum, slot) => sum + slot.weight, 0)
  return slots.reduce((sum, slot) => sum + battleXp(slot.base, slot.level, fighterLevel) * slot.weight, 0) / total
}

function wildAverage(chapter: number): number {
  const slots = chapterSlots(chapter)
  const total = slots.reduce((sum, slot) => sum + slot.weight, 0)
  return slots.reduce((sum, slot) => sum + slot.level * slot.weight, 0) / total
}

type Member = { level: number; xp: number }

function give(member: Member, gain: number): void {
  const next = grantXp(member.level, member.xp, Math.max(0, gain))
  member.level = next.level
  member.xp = next.xp
}

console.log('')
console.log(
  `Tempo da campanha: o time vence com tantos membros quanto o líder tem, cada um no ás − ${PLAYER.leaderMargin}; ` +
    `luta no mato do capítulo, daycare nas vagas do marco (cuidador ×${fmt(PLAYER.caretakerMult, 2)} do cap. 2) e XP de pet com felicidade ${PLAYER.happiness}.`,
)
console.log('')
const campaignHeader = ['Cap.', 'Líder (ás)', 'Alvo', 'Selvagem', 'Time no início', 'Dias', 'Lutas', 'XP da luta', 'Daycare', 'Jardim']
console.log(`| ${campaignHeader.join(' | ')} |`)
console.log(`|${campaignHeader.map(() => '---').join('|')}|`)

// Os 8 líderes e, no capítulo 9, a Liga: time cheio, alvo no ás do campeão. A
// conta não modela as cinco lutas seguidas sem cura: o tempo da Liga é o mínimo.
const gates = [
  ...leaderConfigs.map((leader) => ({
    label: leader.name.replace('Líder de ', ''),
    ace: Math.max(...leader.foes.map((foe) => foe.level)),
    needed: leader.foes.length,
  })),
  {
    label: 'Liga',
    ace: Math.max(...leagueTrainers.flatMap((trainer) => trainer.foes.map((foe) => foe.level))),
    needed: trainerConfig.teamMax,
  },
]

const team: Member[] = [{ level: trainerConfig.starterLevel, xp: 0 }]
let totalDays = 0
let leaderDays = 0
for (const [index, gate] of gates.entries()) {
  const chapter = index + 1
  const cleared = new Set(milestoneConfigs.slice(0, chapter - 1).map((milestone) => milestone.key))
  const daycareSlots = gardenUnlocks(cleared).daycareSlots
  const ace = gate.ace
  const target = ace - PLAYER.leaderMargin
  const needed = gate.needed
  // Quem falta no time entra capturado no nível médio do mato do capítulo.
  while (team.length < needed) team.push({ level: Math.round(wildAverage(chapter)), xp: 0 })
  team.sort((a, b) => b.level - a.level)
  const startLevels = team.slice(0, needed).map((member) => member.level).join(', ')

  const fightsPerHour = fightsPerDay(chapter) / dayHours
  const caretaker = chapter >= 2 ? PLAYER.caretakerMult : 1
  const got = { fight: 0, daycare: 0, garden: 0 }
  let hours = 0
  const core = () => [...team].sort((a, b) => b.level - a.level).slice(0, needed)
  while (core().some((member) => member.level < target) && hours < 60 * dayHours) {
    const members = core()
    // Daycare: os mais baixos (o mais alto fica lutando); ninguém passa do mais alto do time.
    const sorted = [...members].sort((a, b) => a.level - b.level)
    const inDaycare = new Set(sorted.slice(0, Math.min(daycareSlots, members.length - 1)))
    const fighters = members.filter((member) => !inDaycare.has(member))
    const top = Math.max(...fighters.map((member) => member.level))
    const average = members.reduce((sum, member) => sum + member.level, 0) / members.length
    for (const member of inDaycare) {
      if (member.level >= top) continue
      const gain = daycareXpPerHour(member.level, catchUpMult(member.level, average) * caretaker)
      got.daycare += gain
      give(member, gain)
    }
    // Luta: as vitórias da hora divididas entre quem luta (cada um no próprio nível).
    for (const member of fighters) {
      const gain = (fightsPerHour / fighters.length) * xpPerFight(chapter, member.level)
      got.fight += gain
      give(member, gain)
      const pet = gardenXp(member.level, PLAYER.happiness, 1)
      got.garden += pet
      give(member, pet)
    }
    hours += 1
  }
  const days = hours / dayHours
  totalDays += days
  if (index < leaderConfigs.length) leaderDays += days
  const all = got.fight + got.daycare + got.garden || 1
  const pct = (value: number) => `${fmt((value / all) * 100)}%`
  console.log(
    `| ${[
      chapter,
      `${gate.label} (${ace})`,
      `${needed} × ${target}`,
      fmt(wildAverage(chapter)),
      startLevels,
      fmt(days, 1),
      fmt(days * fightsPerDay(chapter)),
      pct(got.fight),
      pct(got.daycare),
      pct(got.garden),
    ].join(' | ')} |`,
  )
}
console.log('')
console.log(`Total até a Blackthorn: ${fmt(leaderDays, 1)} dias (alvo: ~${fmt(PLAYER.daysPerChapter * leaderConfigs.length, 1)}). Até o campeão: ${fmt(totalDays, 1)} dias (alvo: ~${fmt(PLAYER.daysPerChapter * gates.length, 1)}). Daycare: ${fmt(daycareConfig.levelsPerHour * 24, 1)} níveis por dia no ritmo normal.`)
