import { progressConfig, xpToNext } from '../config/progress.js'
import {
  CANDY_XP,
  FEED_MAX_PER_REQUEST,
  NICKNAME_MAX,
  RELEASE_BASE,
  RELEASE_GENERIC,
  RELEASE_LEVEL_DIV,
  RELEASE_MAX_PER_REQUEST,
  RELEASE_SHINY_MULT,
} from '../config/progression.js'
import { grantXp } from './xp.js'

export type ReleaseMon = {
  id: number
  location: 'garden' | 'daycare'
  level: number
  isShiny: boolean
  evolutionChainId: number
}

export type ReleaseYield = {
  id: number
  evolutionChainId: number
  chain: number
  generic: number
}

export function releaseCandies(level: number, isShiny: boolean): { chain: number; generic: number } {
  const chain = RELEASE_BASE + Math.floor(level / RELEASE_LEVEL_DIV)
  return {
    chain: isShiny ? chain * RELEASE_SHINY_MULT : chain,
    generic: RELEASE_GENERIC,
  }
}

export function xpUntilCap(level: number, xp: number, cap = progressConfig.levelCap): number {
  if (level >= cap) return 0
  let total = xpToNext(level) - xp
  for (let cursor = level + 1; cursor < cap; cursor += 1) total += xpToNext(cursor)
  return total
}

export function dosesToCap(level: number, xp: number, cap = progressConfig.levelCap): number {
  const missing = xpUntilCap(level, xp, cap)
  if (missing <= 0) return 0
  return Math.ceil(missing / CANDY_XP)
}

export function planFeed(
  level: number,
  xp: number,
  doses: number,
):
  | { ok: false; error: 'level_cap' | 'invalid_body' }
  | { ok: true; doses: number; xpGained: number; level: number; xp: number; levelsGained: number } {
  if (!Number.isInteger(doses) || doses < 1 || doses > FEED_MAX_PER_REQUEST) {
    return { ok: false, error: 'invalid_body' }
  }
  if (level >= progressConfig.levelCap || dosesToCap(level, xp) < 1) {
    return { ok: false, error: 'level_cap' }
  }
  const consumed = Math.min(doses, dosesToCap(level, xp))
  const granted = grantXp(level, xp, consumed * CANDY_XP)
  return {
    ok: true,
    doses: consumed,
    xpGained: consumed * CANDY_XP,
    level: granted.level,
    xp: granted.xp,
    levelsGained: granted.levelsGained,
  }
}

export function evolutionBlock(
  level: number,
  minLevel: number,
): { ok: true } | { ok: false; error: 'level_too_low'; min: number } {
  // Evolução por troca também sai por nível; a missão de NPC é só atalho (PLANNING.md, seção 5.15).
  if (level < minLevel) return { ok: false, error: 'level_too_low', min: minLevel }
  return { ok: true }
}

export function parseNickname(
  value: unknown,
): { ok: true; nickname: string | null } | { ok: false; error: 'invalid_nickname' } {
  if (value === null) return { ok: true, nickname: null }
  if (typeof value !== 'string') return { ok: false, error: 'invalid_nickname' }
  const nickname = value.trim()
  if (nickname.length === 0) return { ok: true, nickname: null }
  if (nickname.length > NICKNAME_MAX || /[\u0000-\u001F\u007F]/.test(nickname)) {
    return { ok: false, error: 'invalid_nickname' }
  }
  return { ok: true, nickname }
}

export function planRelease(
  ids: readonly number[],
  owned: readonly ReleaseMon[],
):
  | { ok: true; releases: ReleaseYield[] }
  | { ok: false; error: 'invalid_body' | 'pokemon_not_found' | 'in_daycare' | 'last_pokemon'; pokemonId?: number } {
  if (ids.length < 1 || ids.length > RELEASE_MAX_PER_REQUEST) return { ok: false, error: 'invalid_body' }
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'invalid_body' }

  const byId = new Map(owned.map((mon) => [mon.id, mon]))
  const releases: ReleaseYield[] = []
  for (const id of ids) {
    const mon = byId.get(id)
    if (!mon) return { ok: false, error: 'pokemon_not_found', pokemonId: id }
    if (mon.location === 'daycare') return { ok: false, error: 'in_daycare', pokemonId: id }
    const yield_ = releaseCandies(mon.level, mon.isShiny)
    releases.push({ id, evolutionChainId: mon.evolutionChainId, chain: yield_.chain, generic: yield_.generic })
  }
  if (owned.length - ids.length < 1) return { ok: false, error: 'last_pokemon' }
  return { ok: true, releases }
}
