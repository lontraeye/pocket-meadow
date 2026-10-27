import type { BattleInput, BattleSetup } from '@sim'

const AUTO_KEY = 'pm-battle-auto'

export type SavedBattle = {
  startedAtWall: number
  seed: number
  setup: BattleSetup
  inputs: BattleInput[]
  auto: boolean
  timeLimitMs: number
}

function battleKey(encounterId: number): string {
  return `pm-battle-${encounterId}`
}

export function loadBattleAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === '1'
  } catch {
    return false
  }
}

export function saveBattleAuto(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function loadSavedBattle(encounterId: number): SavedBattle | null {
  try {
    const raw = localStorage.getItem(battleKey(encounterId))
    if (!raw) return null
    const data = JSON.parse(raw) as SavedBattle
    if (!data || !Array.isArray(data.inputs) || typeof data.seed !== 'number' || !data.setup) return null
    return data
  } catch {
    return null
  }
}

export function saveBattleProgress(encounterId: number, data: SavedBattle): void {
  try {
    localStorage.setItem(battleKey(encounterId), JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

export function clearSavedBattle(encounterId: number): void {
  try {
    localStorage.removeItem(battleKey(encounterId))
  } catch {
    /* ignore */
  }
}
