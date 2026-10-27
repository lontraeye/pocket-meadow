import { natureInfo } from '../config/natures.js'
import { isCombatAbility } from '../config/traits.js'
import { abilitiesFor, learnsetFor, movesByName } from '../seed/traitsData.js'
import { calcStats, ivRating, type StatBlock } from './stats.js'
import { moveEffectText } from './moveEffectText.js'
import {
  isFastMove,
  nextChargedLearn,
  resolveAbilityKey,
  type AbilitySlot,
  type MoveInfo,
} from './traits.js'

export type SpeciesBases = StatBlock & { type1: string; type2: string | null }

export function buildTraitView(input: {
  speciesId: number
  level: number
  bases: SpeciesBases
  ivs: StatBlock
  evs: StatBlock
  nature: string
  abilitySlot: AbilitySlot
  fastMove: string
  chargedMove: string | null
}) {
  const abilities = abilitiesFor(input.speciesId)
  const abilityKey = resolveAbilityKey(abilities, input.abilitySlot)
  const moves = movesByName()
  const nature = natureInfo(input.nature)
  const learnset = learnsetFor(input.speciesId)
  const nextCharged = input.chargedMove
    ? null
    : nextChargedLearn(learnset, input.level, moves)
  return {
    ivs: input.ivs,
    evs: input.evs,
    ivRating: ivRating(input.ivs),
    nature: {
      key: input.nature,
      displayName: nature?.displayName ?? input.nature,
      up: nature?.up ?? null,
      down: nature?.down ?? null,
    },
    ability: {
      slot: input.abilitySlot,
      key: abilityKey,
      displayName: titleCase(abilityKey),
      combat: isCombatAbility(abilityKey),
    },
    stats: calcStats({
      base: input.bases,
      ivs: input.ivs,
      evs: input.evs,
      level: input.level,
      nature: input.nature,
    }),
    fastMove: moveView(moves.get(input.fastMove), input.fastMove),
    chargedMove: input.chargedMove ? moveView(moves.get(input.chargedMove), input.chargedMove) : null,
    nextChargedMove: nextCharged
      ? {
          move: nextCharged.move,
          level: nextCharged.level,
          displayName: moves.get(nextCharged.move)?.displayName ?? nextCharged.move,
        }
      : null,
    learnset: learnset.map((entry) => ({
      move: entry.move,
      level: entry.level,
      ...(moves.get(entry.move)
        ? {
            displayName: moves.get(entry.move)!.displayName,
            power: moves.get(entry.move)!.power,
            type: moves.get(entry.move)!.type,
            damageClass: moves.get(entry.move)!.damageClass,
          }
        : {}),
    })),
  }
}

export function availableMovesFor(
  speciesId: number,
  level: number,
): { fast: MoveInfo[]; charged: MoveInfo[] } {
  const moves = movesByName()
  const learnset = learnsetFor(speciesId)
  const fast: MoveInfo[] = []
  const charged: MoveInfo[] = []
  const seen = new Set<string>()
  for (const entry of learnset) {
    if (entry.level > level || seen.has(entry.move)) continue
    const info = moves.get(entry.move)
    if (!info) continue
    seen.add(entry.move)
    if (isFastMove(info.power)) fast.push(info)
    else charged.push(info)
  }
  return { fast, charged }
}

function moveView(info: MoveInfo | undefined, fallback: string) {
  const power = info?.power ?? 0
  const slot = isFastMove(power) ? 'fast' : 'charged'
  const effect = info ? moveEffectText(info, slot) : null
  return {
    name: info?.name ?? fallback,
    displayName: info?.displayName ?? fallback,
    type: info?.type ?? 'normal',
    power,
    damageClass: info?.damageClass ?? 'physical',
    effectText: effect,
  }
}

function titleCase(key: string): string {
  return key
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function requireTraitFields(row: {
  ivHp: number | null
  ivAttack: number | null
  ivDefense: number | null
  ivSpAttack: number | null
  ivSpDefense: number | null
  ivSpeed: number | null
  evHp: number
  evAttack: number
  evDefense: number
  evSpAttack: number
  evSpDefense: number
  evSpeed: number
  nature: string | null
  abilitySlot: AbilitySlot | null
  fastMove: string | null
  chargedMove: string | null
}): {
  ivs: StatBlock
  evs: StatBlock
  nature: string
  abilitySlot: AbilitySlot
  fastMove: string
  chargedMove: string | null
} {
  if (
    row.ivHp === null ||
    row.ivAttack === null ||
    row.ivDefense === null ||
    row.ivSpAttack === null ||
    row.ivSpDefense === null ||
    row.ivSpeed === null ||
    !row.nature ||
    !row.abilitySlot ||
    !row.fastMove
  ) {
    throw new Error('pokemon traits missing; run migrations / backfill')
  }
  return {
    ivs: {
      hp: row.ivHp,
      attack: row.ivAttack,
      defense: row.ivDefense,
      spAttack: row.ivSpAttack,
      spDefense: row.ivSpDefense,
      speed: row.ivSpeed,
    },
    evs: {
      hp: row.evHp,
      attack: row.evAttack,
      defense: row.evDefense,
      spAttack: row.evSpAttack,
      spDefense: row.evSpDefense,
      speed: row.evSpeed,
    },
    nature: row.nature,
    abilitySlot: row.abilitySlot,
    fastMove: row.fastMove,
    chargedMove: row.chargedMove,
  }
}
