/** Pokébolas (PLANNING.md, seção 5.6 / Fase 9). */

export type BallKey =
  | 'poke'
  | 'great'
  | 'ultra'
  | 'master'
  | 'quick'
  | 'timer'
  | 'net'
  | 'nest'
  | 'premier'
  | 'luxury'

export type BallDef = {
  key: BallKey
  displayName: string
  /** Prefixo do arquivo em sprites/items: `${sprite}-ball.png`. */
  sprite: string
}

export const balls = {
  poke: { key: 'poke', displayName: 'Poké Ball', sprite: 'poke' },
  great: { key: 'great', displayName: 'Great Ball', sprite: 'great' },
  ultra: { key: 'ultra', displayName: 'Ultra Ball', sprite: 'ultra' },
  master: { key: 'master', displayName: 'Master Ball', sprite: 'master' },
  quick: { key: 'quick', displayName: 'Quick Ball', sprite: 'quick' },
  timer: { key: 'timer', displayName: 'Timer Ball', sprite: 'timer' },
  net: { key: 'net', displayName: 'Net Ball', sprite: 'net' },
  nest: { key: 'nest', displayName: 'Nest Ball', sprite: 'nest' },
  premier: { key: 'premier', displayName: 'Premier Ball', sprite: 'premier' },
  luxury: { key: 'luxury', displayName: 'Luxury Ball', sprite: 'luxury' },
} as const satisfies Record<BallKey, BallDef>

export const ballList: BallDef[] = Object.values(balls)

export const ballsConfig = {
  /** Estoque inicial e backfill da migração. */
  startingPokeBalls: 30,
  /** Quantidade por tipo no painel de teste (Master: 3). */
  devGrantEach: 10,
  devGrantMaster: 3,
} as const

export function ballItemKey(key: string): string {
  return `ball:${key}`
}

export function ballKeyFromItem(itemKey: string): BallKey | null {
  if (!itemKey.startsWith('ball:')) return null
  const key = itemKey.slice('ball:'.length)
  return key in balls ? (key as BallKey) : null
}

export function getBall(key: string): BallDef | null {
  return key in balls ? balls[key as BallKey] : null
}

export function isMasterBall(key: string): boolean {
  return key === 'master'
}

/**
 * Multiplicador da bola na fórmula de captura.
 * Master Ball não usa isto (chance 1); a função devolve 1 por consistência.
 */
export function ballMultiplier(input: {
  key: string
  /** Índice do lançamento atual (0 = primeiro). */
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
    case 'timer': {
      const mult = 1 + 0.3 * throwIndex
      return Math.min(4, mult)
    }
    case 'net': {
      const bugOrWater = types.some((t) => t === 'bug' || t === 'water')
      return bugOrWater ? 3 : 1
    }
    case 'nest': {
      const mult = (41 - wildLevel) / 10
      return Math.min(4, Math.max(1, mult))
    }
    default:
      return 1
  }
}
