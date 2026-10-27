import type { DaycareState, PlotState } from './api'

export type ReadyInput = {
  plots: Pick<PlotState, 'plotIndex' | 'readyAt'>[]
  daycare: Pick<DaycareState, 'slots'>
}

export type ReadyStatus = {
  /** Índices dos canteiros com berry pronta (ordenados). */
  readyPlots: number[]
  berryCount: number
  daycareFullCount: number
  /**
   * Uma chave por coisa pronta, com o horário dela (`p0@readyAt`, `d1@fullAt`).
   * O horário entra para uma berry replantada no mesmo canteiro, ou um daycare
   * renovado, contar como novidade.
   */
  ids: string[]
  /** Texto curto para o aviso do jardim, ou null se não há nada. */
  summary: string | null
}

/** O que está pronto agora, pelo relógio do servidor no cliente. */
export function readyStatus(input: ReadyInput, now: number): ReadyStatus {
  const plots = input.plots.filter((plot) => plot.readyAt <= now).sort((a, b) => a.plotIndex - b.plotIndex)
  const fullSlots = input.daycare.slots.filter((slot) => slot.fullAt <= now)
  const readyPlots = plots.map((plot) => plot.plotIndex)
  const berryCount = readyPlots.length
  const daycareFullCount = fullSlots.length
  const ids = [
    ...plots.map((plot) => `p${plot.plotIndex}@${plot.readyAt}`),
    ...fullSlots.map((slot) => `d${slot.slotIndex}@${slot.fullAt}`),
  ]

  const parts: string[] = []
  if (berryCount === 1) parts.push('1 berry pronta')
  else if (berryCount > 1) parts.push(`${berryCount} berries prontas`)
  if (daycareFullCount === 1) parts.push('daycare cheio')
  else if (daycareFullCount > 1) parts.push(`${daycareFullCount} no daycare cheios`)

  return { readyPlots, berryCount, daycareFullCount, ids, summary: parts.length > 0 ? parts.join(' · ') : null }
}

/** Mostra o aviso se há algo pronto que não estava entre os dispensados. */
export function shouldShowReadyBanner(ready: ReadyStatus, dismissed: readonly string[]): boolean {
  if (ready.summary === null) return false
  return ready.ids.some((id) => !dismissed.includes(id))
}
