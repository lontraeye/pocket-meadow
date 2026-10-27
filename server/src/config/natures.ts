export type StatKey = 'attack' | 'defense' | 'spAttack' | 'spDefense' | 'speed'

export type NatureInfo = {
  key: string
  displayName: string
  up: StatKey | null
  down: StatKey | null
}

/** As 25 natures. Neutras: Hardy, Docile, Serious, Bashful, Quirky. */
export const natures: NatureInfo[] = [
  { key: 'hardy', displayName: 'Hardy', up: null, down: null },
  { key: 'lonely', displayName: 'Lonely', up: 'attack', down: 'defense' },
  { key: 'brave', displayName: 'Brave', up: 'attack', down: 'speed' },
  { key: 'adamant', displayName: 'Adamant', up: 'attack', down: 'spAttack' },
  { key: 'naughty', displayName: 'Naughty', up: 'attack', down: 'spDefense' },
  { key: 'bold', displayName: 'Bold', up: 'defense', down: 'attack' },
  { key: 'docile', displayName: 'Docile', up: null, down: null },
  { key: 'relaxed', displayName: 'Relaxed', up: 'defense', down: 'speed' },
  { key: 'impish', displayName: 'Impish', up: 'defense', down: 'spAttack' },
  { key: 'lax', displayName: 'Lax', up: 'defense', down: 'spDefense' },
  { key: 'timid', displayName: 'Timid', up: 'speed', down: 'attack' },
  { key: 'hasty', displayName: 'Hasty', up: 'speed', down: 'defense' },
  { key: 'serious', displayName: 'Serious', up: null, down: null },
  { key: 'jolly', displayName: 'Jolly', up: 'speed', down: 'spAttack' },
  { key: 'naive', displayName: 'Naive', up: 'speed', down: 'spDefense' },
  { key: 'modest', displayName: 'Modest', up: 'spAttack', down: 'attack' },
  { key: 'mild', displayName: 'Mild', up: 'spAttack', down: 'defense' },
  { key: 'quiet', displayName: 'Quiet', up: 'spAttack', down: 'speed' },
  { key: 'bashful', displayName: 'Bashful', up: null, down: null },
  { key: 'rash', displayName: 'Rash', up: 'spAttack', down: 'spDefense' },
  { key: 'calm', displayName: 'Calm', up: 'spDefense', down: 'attack' },
  { key: 'gentle', displayName: 'Gentle', up: 'spDefense', down: 'defense' },
  { key: 'sassy', displayName: 'Sassy', up: 'spDefense', down: 'speed' },
  { key: 'careful', displayName: 'Careful', up: 'spDefense', down: 'spAttack' },
  { key: 'quirky', displayName: 'Quirky', up: null, down: null },
]

const byKey = new Map(natures.map((nature) => [nature.key, nature]))

export function natureInfo(key: string): NatureInfo | undefined {
  return byKey.get(key)
}

export function natureMultiplier(key: string, stat: StatKey): number {
  const nature = byKey.get(key)
  if (!nature) return 1
  if (nature.up === stat) return 1.1
  if (nature.down === stat) return 0.9
  return 1
}
