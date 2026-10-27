import type { BattleInput, BattleSetup } from '@sim'

const AUTO_KEY = 'pm-battle-auto'

export type SavedBattle = {
  startedAtWall: number
  seed: number
  setup: BattleSetup
  inputs: BattleInput[]
  /** Espelho local do Auto no momento do save (a preferência vale no servidor). */
  auto: boolean
  timeLimitMs: number
}

function battleKey(encounterId: number): string {
  return `pm-battle-${encounterId}`
}

/**
 * Lê a chave antiga `pm-battle-auto` uma vez e apaga. Se estava ligada, o
 * chamador pode gravar no servidor quando a preferência ainda estiver off.
 */
export function takeLegacyBattleAuto(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_KEY)
    if (raw === null) return false
    const on = raw === '1'
    localStorage.removeItem(AUTO_KEY)
    return on
  } catch {
    return false
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
