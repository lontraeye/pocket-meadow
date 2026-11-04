// Visitantes no banco (PLANNING 5.22): liquidados no catch-up, por timestamp.
// Cada habitat pronto (menos o básico) recebe um visitante por vez; ele fica
// `stayMs` e vai embora. Quem chegou e foi embora enquanto o jogador estava
// fora não fica acumulado: o relógio só anda até a próxima chegada que ainda
// está no jardim. Chamar dentro de immediate().

import { and, eq, lte } from 'drizzle-orm'
import { battleConfig } from '../config/battle.js'
import { milestoneConfigs } from '../config/milestones.js'
import { loadRegions } from '../config/regions.js'
import { habitatKind } from '../game/habitat/index.js'
import { rollVisitor, visitorConfig, visitorInterval, visitorPool } from '../game/habitat/visitors.js'
import { unitRoll } from '../game/rng.js'
import { getDb } from './client.js'
import { checkedHabitats } from './habitat.js'
import { clearedMilestones } from './milestones.js'
import { habitatVisitors, habitats, species } from './schema.js'

/** O capítulo aberto mais adiante: 1 mais os marcos em ordem já vencidos. */
export function currentChapter(userId: number): number {
  const cleared = clearedMilestones(userId)
  let chapter = 1
  for (const milestone of milestoneConfigs) {
    if (!cleared.has(milestone.key)) break
    chapter = Math.min(milestoneConfigs.length, milestone.chapter + 1)
  }
  return chapter
}

function speciesRows() {
  return getDb()
    .select({
      id: species.id,
      type1: species.type1,
      type2: species.type2,
      captureRate: species.captureRate,
      isLegendary: species.isLegendary,
      isMythical: species.isMythical,
    })
    .from(species)
    .all()
}

export function settleVisitors(userId: number, now: number, roll: () => number = unitRoll): void {
  const db = getDb()
  // Quem já foi embora sai.
  db.delete(habitatVisitors).where(and(eq(habitatVisitors.userId, userId), lte(habitatVisitors.leavesAt, now))).run()
  const present = new Set(
    db
      .select({ habitatId: habitatVisitors.habitatId })
      .from(habitatVisitors)
      .where(eq(habitatVisitors.userId, userId))
      .all()
      .map((row) => row.habitatId),
  )
  const next = new Map(
    db
      .select({ id: habitats.id, at: habitats.visitorNextAt })
      .from(habitats)
      .where(eq(habitats.userId, userId))
      .all()
      .map((row) => [row.id, row.at]),
  )
  let chapter: number | null = null
  let rows: ReturnType<typeof speciesRows> | null = null
  for (const home of checkedHabitats(userId)) {
    const attracts = home.check.ready && habitatKind(home.kind).types !== null
    if (!attracts) {
      // Deixou de estar pronto (ou é básico): o visitante vai embora e o relógio para.
      db.delete(habitatVisitors).where(eq(habitatVisitors.habitatId, home.id)).run()
      if (next.get(home.id) !== null) db.update(habitats).set({ visitorNextAt: null }).where(eq(habitats.id, home.id)).run()
      continue
    }
    let at = next.get(home.id) ?? null
    if (at === null) {
      // Ficou pronto agora: o primeiro chega depois de um intervalo.
      db.update(habitats).set({ visitorNextAt: now + visitorInterval(roll()) }).where(eq(habitats.id, home.id)).run()
      continue
    }
    if (present.has(home.id) || at > now) continue
    // Pula quem teria vindo e ido embora sem ninguém ver.
    while (at + visitorConfig.stayMs <= now) at += visitorConfig.stayMs + visitorInterval(roll())
    if (at > now) {
      db.update(habitats).set({ visitorNextAt: at }).where(eq(habitats.id, home.id)).run()
      continue
    }
    chapter ??= currentChapter(userId)
    rows ??= speciesRows()
    const wild = rollVisitor(visitorPool(home.kind, chapter, loadRegions(), rows), roll)
    const following = at + visitorConfig.stayMs + visitorInterval(roll())
    if (wild) {
      db.insert(habitatVisitors)
        .values({
          userId,
          habitatId: home.id,
          speciesId: wild.speciesId,
          level: wild.level,
          isShiny: roll() < battleConfig.shinyRate,
          arrivedAt: at,
          leavesAt: at + visitorConfig.stayMs,
        })
        .run()
    }
    db.update(habitats).set({ visitorNextAt: following }).where(eq(habitats.id, home.id)).run()
  }
}

export type VisitorView = {
  id: number
  habitatId: number
  speciesId: number
  displayName: string
  level: number
  isShiny: boolean
  leavesAt: number
}

export function visitorsView(userId: number): VisitorView[] {
  return getDb()
    .select({
      id: habitatVisitors.id,
      habitatId: habitatVisitors.habitatId,
      speciesId: habitatVisitors.speciesId,
      displayName: species.displayName,
      level: habitatVisitors.level,
      isShiny: habitatVisitors.isShiny,
      leavesAt: habitatVisitors.leavesAt,
    })
    .from(habitatVisitors)
    .innerJoin(species, eq(species.id, habitatVisitors.speciesId))
    .where(eq(habitatVisitors.userId, userId))
    .orderBy(habitatVisitors.id)
    .all()
}
