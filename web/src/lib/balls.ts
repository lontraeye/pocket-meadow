/** Espelha server/src/config/balls.ts + catchChance (só para mostrar odds). */

export function ballMultiplier(input: {
  key: string
  throwIndex: number
  wildLevel: number
  types: readonly string[]
}): number {
  const { key, throwIndex, wildLevel, types } = input
  switch (key) {
    case 'poke':
    case 'premier':
    case 'luxury':
    case 'master':
      return 1
    case 'great':
      return 1.5
    case 'ultra':
      return 2
    case 'quick':
      return throwIndex === 0 ? 4 : 1
    case 'timer':
      return Math.min(4, 1 + 0.3 * throwIndex)
    case 'net':
      return types.some((t) => t === 'bug' || t === 'water') ? 3 : 1
    case 'nest':
      return Math.min(4, Math.max(1, (41 - wildLevel) / 10))
    default:
      return 1
  }
}

export function previewCatchChance(input: {
  captureRate: number
  catchMult: number
  catchMin: number
  ballKey: string
  throwIndex: number
  wildLevel: number
  types: readonly string[]
  berryBonus?: number
}): number {
  if (input.ballKey === 'master') return 1
  const ballMult = ballMultiplier({
    key: input.ballKey,
    throwIndex: input.throwIndex,
    wildLevel: input.wildLevel,
    types: input.types,
  })
  const raw = (input.captureRate / 255) * input.catchMult * ballMult * (input.berryBonus ?? 1)
  return Math.min(1, Math.max(input.catchMin, raw))
}

export function ballIconSrc(sprite: string): string {
  return `/sprites/items/${sprite}-ball.png`
}
