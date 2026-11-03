import { type MissionKind, missionConfig } from '../config/missions.js'
import { typeDisplayNamePt, type PokemonType } from '../config/types.js'

/** O que o sorteio precisa saber do jogador para só dar missão possível. */
export type MissionContext = {
  level: number
  /** Áreas abertas do capítulo atual (com mato). */
  areas: { slug: string; name: string }[]
  /** Tipos que aparecem nessas áreas. */
  areaTypes: string[]
  /** Tipos do time. */
  teamTypes: string[]
  /** Há espécie dessas áreas que o jogador nunca capturou. */
  hasNewSpecies: boolean
  /** Árvore de Apricorn e bancada abertas (5.23). */
  gardenOpen: boolean
}

export type MissionParams = { region?: string; regionName?: string; type?: string }
export type MissionDraft = { kind: MissionKind; params: MissionParams; target: number }

function possible(kind: MissionKind, ctx: MissionContext): boolean {
  switch (kind) {
    case 'win_area':
      return ctx.areas.length > 0
    case 'catch_type':
      return ctx.areaTypes.length > 0
    case 'catch_new':
      return ctx.hasNewSpecies
    case 'win_with_type':
      return ctx.teamTypes.length > 0
    case 'harvest_apricorn':
    case 'make_balls':
      return ctx.gardenOpen
    case 'harvest_berries':
    case 'feed_pets':
      return true
    default:
      return true
  }
}

function pickOne<T>(list: readonly T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length)] ?? list[0]!
}

/** Sorteia uma missão de um tipo que não está em `exclude`. Null se nada servir. */
export function drawMission(ctx: MissionContext, rng: () => number, exclude: ReadonlySet<MissionKind>): MissionDraft | null {
  const options = (Object.entries(missionConfig.weights) as [MissionKind, number][]).filter(
    ([kind]) => !exclude.has(kind) && possible(kind, ctx),
  )
  const total = options.reduce((sum, [, weight]) => sum + weight, 0)
  if (total <= 0) return null
  let cursor = rng() * total
  let kind = options[0]![0]
  for (const [option, weight] of options) {
    cursor -= weight
    if (cursor < 0) {
      kind = option
      break
    }
  }
  const params: MissionParams = {}
  if (kind === 'win_area') {
    const area = pickOne(ctx.areas, rng)
    params.region = area.slug
    params.regionName = area.name
  } else if (kind === 'catch_type') params.type = pickOne(ctx.areaTypes, rng)
  else if (kind === 'win_with_type') params.type = pickOne(ctx.teamTypes, rng)
  return { kind, params, target: missionConfig.target(kind, ctx.level) }
}

/** As missões do dia: tipos diferentes entre si. */
export function drawDay(ctx: MissionContext, rng: () => number): MissionDraft[] {
  const out: MissionDraft[] = []
  const used = new Set<MissionKind>()
  for (let slot = 0; slot < missionConfig.perDay; slot += 1) {
    const draft = drawMission(ctx, rng, used)
    if (!draft) break
    used.add(draft.kind)
    out.push(draft)
  }
  return out
}

const typeName = (type: string | undefined) => (type ? (typeDisplayNamePt[type as PokemonType] ?? type) : '')

/** Texto da missão para a tela. */
export function missionText(kind: MissionKind, params: MissionParams, target: number): string {
  switch (kind) {
    case 'win_any':
      return `Vença ${target} lutas contra selvagens`
    case 'win_area':
      return `Vença ${target} lutas em ${params.regionName ?? params.region}`
    case 'catch_any':
      return target === 1 ? 'Capture 1 Pokémon' : `Capture ${target} Pokémon`
    case 'catch_type':
      return `Capture ${target} Pokémon do tipo ${typeName(params.type)}`
    case 'catch_new':
      return 'Capture uma espécie que você ainda não tem'
    case 'win_with_type':
      return `Vença ${target} lutas com um Pokémon ${typeName(params.type)} no time`
    case 'harvest_apricorn':
      return target === 1 ? 'Colha 1 Apricorn da árvore' : `Colha ${target} Apricorns da árvore`
    case 'make_balls':
      return `Produza ${target} Poké Balls na bancada`
    case 'harvest_berries':
      return `Colha ${target} berries na horta`
    case 'feed_pets':
      return target === 1 ? 'Alimente 1 Pokémon do jardim' : `Alimente ${target} Pokémon do jardim`
  }
}
