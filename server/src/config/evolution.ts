export const evolutionDefaults = {
  minLevelByStage: {
    2: 16,
    3: 36,
  },
  candyCostByStage: {
    2: 25,
    3: 100,
  },
} as const

export function minLevelForStage(stage: number): number {
  const level = evolutionDefaults.minLevelByStage[stage as 2 | 3]
  if (level === undefined) {
    throw new Error(`no default min level for evolution stage ${stage}`)
  }
  return level
}

export function candyCostForStage(stage: number): number {
  const cost = evolutionDefaults.candyCostByStage[stage as 2 | 3]
  if (cost === undefined) {
    throw new Error(`no candy cost for evolution stage ${stage}`)
  }
  return cost
}
