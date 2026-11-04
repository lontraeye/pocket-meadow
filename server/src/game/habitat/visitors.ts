// Visitantes dos habitats (PLANNING 5.22 e 5.16): Pokémon selvagens que
// aparecem num habitat pronto do tipo deles. Quem pode vir sai das tabelas de
// encontro das áreas já abertas, com quatro travas para não aparecer algo forte
// ou raro demais só porque o habitat é do tipo (pedido em 2026-11-04):
//   1. raro nas rotas (peso até RARE_WEIGHT_MAX em todas as áreas) não vem;
//   2. difícil de capturar (taxa abaixo de `minCaptureRate`) não vem;
//   3. lendário e mítico não vêm;
//   4. quem só aparece acima do nível médio do mato do capítulo não vem
//      (o Machoke Nv 32 das cavernas não visita um Rochedo).
// O nível sai entre o mais baixo das rotas e esse teto.
// Puro: recebe as áreas e as espécies (o servidor e o script de balanço).

import { RARE_WEIGHT_MAX } from '../../config/battle.js'
import type { Region } from '../../config/regions.js'
import { type HabitatKind, habitatKind } from './area.js'

const hourMs = 60 * 60 * 1000

export const visitorConfig = {
  /** Taxa de captura mínima (255 = fácil; Onix, Dratini e Scyther têm 45). */
  minCaptureRate: 90,
  /** Depois que um vai embora (ou o habitat fica pronto), o próximo chega neste intervalo. */
  intervalMinMs: 3 * hourMs,
  intervalMaxMs: 6 * hourMs,
  /** Quanto tempo o visitante fica esperando. */
  stayMs: 4 * hourMs,
}

/** Intervalo até o próximo, sorteado entre o mínimo e o máximo. `roll` em [0, 1). */
export function visitorInterval(roll: number, config = visitorConfig): number {
  return Math.round(config.intervalMinMs + roll * (config.intervalMaxMs - config.intervalMinMs))
}

export type VisitorSpecies = {
  id: number
  type1: string
  type2: string | null
  captureRate: number
  isLegendary: boolean
  isMythical: boolean
}

export type VisitorEntry = { speciesId: number; minLevel: number; maxLevel: number; weight: number }
export type VisitorPool = {
  entries: VisitorEntry[]
  /** Teto de nível: a média do mato do capítulo. */
  levelCap: number
  /** Do tipo, mas fora: por quê (para o script de balanço). */
  excluded: { speciesId: number; reason: string }[]
}

/**
 * Quem pode visitar o habitat do tipo no capítulo: as espécies do tipo nas
 * tabelas (mato, água, árvore, pedra) das áreas até o capítulo, com o peso
 * somado das tabelas (o comum vem mais) e o nível mais baixo delas.
 */
export function visitorPool(
  kindKey: HabitatKind,
  chapter: number,
  regions: readonly Region[],
  species: readonly VisitorSpecies[],
  config = visitorConfig,
): VisitorPool {
  const kind = habitatKind(kindKey)
  if (kind.types === null) return { entries: [], excluded: [], levelCap: 0 }
  const types = kind.types as readonly string[]
  const byId = new Map(species.map((row) => [row.id, row]))
  const levelCap = wildAverage(chapter, regions)
  const seen = new Map<number, { weight: number; level: number; top: number; common: boolean }>()
  for (const region of regions) {
    if (region.chapter === null || region.chapter > chapter) continue
    for (const table of [region.slots, ...Object.values(region.methods)]) {
      // Peso de cada espécie nesta tabela (as tabelas somam 100).
      const inTable = new Map<number, { weight: number; level: number; top: number }>()
      for (const slot of table ?? []) {
        const row = inTable.get(slot.speciesId) ?? { weight: 0, level: slot.minLevel, top: slot.maxLevel }
        row.weight += slot.weight
        row.level = Math.min(row.level, slot.minLevel)
        row.top = Math.max(row.top, slot.maxLevel)
        inTable.set(slot.speciesId, row)
      }
      for (const [speciesId, row] of inTable) {
        const total = seen.get(speciesId) ?? { weight: 0, level: row.level, top: row.top, common: false }
        total.weight += row.weight
        total.level = Math.min(total.level, row.level)
        total.top = Math.max(total.top, row.top)
        total.common ||= row.weight > RARE_WEIGHT_MAX
        seen.set(speciesId, total)
      }
    }
  }
  const entries: VisitorEntry[] = []
  const excluded: VisitorPool['excluded'] = []
  for (const [speciesId, row] of seen) {
    const info = byId.get(speciesId)
    if (!info) continue
    if (!types.includes(info.type1) && !(info.type2 !== null && types.includes(info.type2))) continue
    let reason: string | null = null
    if (info.isLegendary || info.isMythical) reason = 'lendário'
    else if (!row.common) reason = 'raro nas rotas'
    else if (info.captureRate < config.minCaptureRate) reason = `captura ${info.captureRate}`
    else if (row.level > levelCap) reason = `Nv ${row.level} > ${levelCap}`
    if (reason) excluded.push({ speciesId, reason })
    else entries.push({ speciesId, minLevel: row.level, maxLevel: Math.min(row.top, levelCap), weight: row.weight })
  }
  entries.sort((a, b) => b.weight - a.weight || a.speciesId - b.speciesId)
  excluded.sort((a, b) => a.speciesId - b.speciesId)
  return { entries, excluded, levelCap }
}

/** Nível médio do mato do capítulo (o último capítulo com mato, se este não tiver). */
export function wildAverage(chapter: number, regions: readonly Region[]): number {
  for (let at = chapter; at >= 1; at -= 1) {
    const slots = regions.filter((region) => region.chapter === at).flatMap((region) => region.slots)
    const total = slots.reduce((sum, slot) => sum + slot.weight, 0)
    if (total > 0) return Math.round(slots.reduce((sum, slot) => sum + ((slot.minLevel + slot.maxLevel) / 2) * slot.weight, 0) / total)
  }
  return 5
}

/** Sorteia o visitante: espécie pelo peso e nível entre o mínimo e o teto. `roll` em [0, 1). */
export function rollVisitor(pool: VisitorPool, roll: () => number): { speciesId: number; level: number } | null {
  const total = pool.entries.reduce((sum, entry) => sum + entry.weight, 0)
  if (total <= 0) return null
  let pick = roll() * total
  const entry = pool.entries.find((row) => (pick -= row.weight) < 0) ?? pool.entries[pool.entries.length - 1]!
  const level = entry.minLevel + Math.floor(roll() * (entry.maxLevel - entry.minLevel + 1))
  return { speciesId: entry.speciesId, level }
}
