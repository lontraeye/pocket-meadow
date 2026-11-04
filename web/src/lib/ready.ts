import type { BenchView, DaycareState, GardenGift, MissionsView, PetView, PlotState, TreeView } from './api'
import { benchDone } from './benchJob'

export type ReadyInput = {
  plots: (Pick<PlotState, 'plotIndex' | 'readyAt'> & { deadAt?: number | null })[]
  daycare: Pick<DaycareState, 'slots'>
  missions: Pick<MissionsView, 'day' | 'list' | 'chest'>
  gifts: Pick<GardenGift, 'id'>[]
  /** Só os Pokémon do jardim (quem está no PC ou no daycare não tem necessidades). */
  pets: { id: number; pet: Pick<PetView, 'hunger' | 'affection' | 'petReadyAt'> }[]
  needThreshold: number
  /** As árvores no jardim (as guardadas não crescem nem avisam). */
  trees: Pick<TreeView, 'id' | 'ready' | 'cap' | 'readyAts'>[]
  /** O lote de cada bancada que está trabalhando. */
  benchJobs: Pick<NonNullable<BenchView['job']>, 'id' | 'quantity' | 'unitMs' | 'startedAt' | 'collected' | 'perUnit'>[]
}

/** Para onde o toque no aviso leva: o primeiro item que tem lugar próprio. */
export type ReadyTarget = 'plot' | 'missions' | 'daycare' | null

export type ReadyStatus = {
  /** Índices dos canteiros com berry pronta (ordenados). */
  readyPlots: number[]
  berryCount: number
  daycareFullCount: number
  missionCount: number
  chestReady: boolean
  giftCount: number
  hungryCount: number
  wantPetCount: number
  treesFull: number
  benchReady: number
  /**
   * Uma chave por coisa pronta (`p0@readyAt`, `d1@fullAt`, `m12`, `c2026-11-03`,
   * `g5`, `h7`, `a7`, `t@cheia`, `b3@2`). O horário entra para uma berry replantada no mesmo
   * canteiro, ou um daycare renovado, contar como novidade.
   */
  ids: string[]
  target: ReadyTarget
  /** Texto curto para o aviso do jardim, ou null se não há nada. */
  summary: string | null
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)))

/** O que está pronto agora, pelo relógio do servidor no cliente. */
export function readyStatus(input: ReadyInput, now: number): ReadyStatus {
  // Arbusto seco não dá berry: entra à parte, para lembrar de limpar e replantar.
  const plots = input.plots
    .filter((plot) => !plot.deadAt && plot.readyAt <= now)
    .sort((a, b) => a.plotIndex - b.plotIndex)
  const deadPlots = input.plots.filter((plot) => !!plot.deadAt)
  const fullSlots = input.daycare.slots.filter((slot) => slot.fullAt <= now)
  const missions = input.missions.list.filter((mission) => mission.done && !mission.claimed)
  const chestReady = input.missions.chest.ready && !input.missions.chest.claimed
  const hungry = input.pets.filter((mon) => mon.pet.hunger < input.needThreshold)
  // Carinho só entra quando está baixo de verdade e já pode ser feito; o
  // coração do balão aparece antes disso, mas no aviso viraria ruído.
  const wantPet = input.pets.filter(
    (mon) =>
      mon.pet.affection < input.needThreshold && (mon.pet.petReadyAt === null || mon.pet.petReadyAt <= now),
  )

  // Árvores cheias (5.23): o que o servidor contou mais o que amadureceu depois.
  const fullTrees = input.trees.filter(
    (tree) => tree.ready + tree.readyAts.filter((at) => at <= now).length >= tree.cap,
  )

  // Poké Balls prontas nas bancadas, esperando coletar.
  const readyOf = (job: ReadyInput['benchJobs'][number]) => (benchDone(job, now) - job.collected) * job.perUnit
  const benchReady = input.benchJobs.reduce((sum, job) => sum + readyOf(job), 0)

  const readyPlots = plots.map((plot) => plot.plotIndex)
  const berryCount = readyPlots.length
  const daycareFullCount = fullSlots.length
  const missionCount = missions.length
  const giftCount = input.gifts.length
  const ids = [
    ...plots.map((plot) => `p${plot.plotIndex}@${plot.readyAt}`),
    ...missions.map((mission) => `m${mission.id}`),
    ...(chestReady ? [`c${input.missions.day}`] : []),
    ...fullSlots.map((slot) => `d${slot.slotIndex}@${slot.fullAt}`),
    ...input.gifts.map((gift) => `g${gift.id}`),
    ...hungry.map((mon) => `h${mon.id}`),
    ...wantPet.map((mon) => `a${mon.id}`),
    ...fullTrees.map((tree) => `t${tree.id}@${tree.readyAts.at(-1) ?? 'cheia'}`),
    ...deadPlots.map((plot) => `x${plot.plotIndex}@${plot.deadAt}`),
    // Uma chave por lote, e outra quando ele acaba: o lote inteiro pronto volta a avisar.
    ...input.benchJobs
      .filter((job) => readyOf(job) > 0)
      .map((job) => `b${job.id}@${benchDone(job, now) === job.quantity ? 'fim' : 'parcial'}`),
  ]

  // Primeiro o que tem lugar para onde ir (o toque leva ao primeiro), depois o
  // que já está à vista no jardim.
  const parts: string[] = []
  if (berryCount > 0) parts.push(count(berryCount, '1 berry pronta', '# berries prontas'))
  if (missionCount > 0) parts.push(count(missionCount, '1 missão pronta', '# missões prontas'))
  if (chestReady) parts.push('baú pronto')
  if (daycareFullCount > 0) parts.push(count(daycareFullCount, 'daycare cheio', '# no daycare cheios'))
  if (fullTrees.length > 0) parts.push(count(fullTrees.length, 'árvore cheia', '# árvores cheias'))
  if (deadPlots.length > 0) parts.push(count(deadPlots.length, '1 arbusto seco', '# arbustos secos'))
  if (benchReady > 0) parts.push(count(benchReady, '1 bola pronta', '# bolas prontas'))
  if (giftCount > 0) parts.push(count(giftCount, '1 presente', '# presentes'))
  if (hungry.length > 0) parts.push(`${hungry.length} com fome`)
  if (wantPet.length > 0) parts.push(count(wantPet.length, '1 quer carinho', '# querem carinho'))

  const target: ReadyTarget =
    berryCount > 0 ? 'plot' : missionCount > 0 || chestReady ? 'missions' : daycareFullCount > 0 ? 'daycare' : null

  return {
    readyPlots,
    berryCount,
    daycareFullCount,
    missionCount,
    chestReady,
    giftCount,
    hungryCount: hungry.length,
    wantPetCount: wantPet.length,
    treesFull: fullTrees.length,
    benchReady,
    ids,
    target,
    summary: parts.length > 0 ? parts.join(' · ') : null,
  }
}

/** Mostra o aviso se há algo pronto que não estava entre os dispensados. */
export function shouldShowReadyBanner(ready: ReadyStatus, dismissed: readonly string[]): boolean {
  if (ready.summary === null) return false
  return ready.ids.some((id) => !dismissed.includes(id))
}
