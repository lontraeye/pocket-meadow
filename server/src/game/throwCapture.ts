import { battleConfig } from '../config/battle.js'
import { catchChance, rollChance } from './battle.js'
import { mulberry32 } from './mulberry32.js'
import type { Rng } from './rng.js'
import { throwRngSeed } from './sim/seeds.js'

/**
 * Avança a sequência de lançamentos até o índice atual (0 = primeiro).
 * Cada tentativa anterior falhou: 1 rolagem de captura + 1 de fuga.
 */
export function throwRngAt(encounterSeed: number, throwIndex: number): Rng {
  const rng = mulberry32(throwRngSeed(encounterSeed))
  for (let i = 0; i < throwIndex; i += 1) {
    rng() // captura falhou
    rng() // fuga falhou (senão o encontro já teria fechado)
  }
  return rng
}

export type ThrowRoll = {
  caught: boolean
  fled: boolean
  catchChance: number
}

/** Uma tentativa de captura +, se falhar, rolagem de fuga. Determinístico. */
export function rollThrow(input: {
  encounterSeed: number
  throwIndex: number
  captureRate: number
  berryBonus?: number
  fleeChance?: number
}): ThrowRoll {
  const catchOdds = catchChance(input.captureRate, input.berryBonus ?? 1)
  const fleeOdds = input.fleeChance ?? battleConfig.throwFleeChance
  const rng = throwRngAt(input.encounterSeed, input.throwIndex)
  const caught = rollChance(catchOdds, rng)
  if (caught) return { caught: true, fled: false, catchChance: catchOdds }
  const fled = rollChance(fleeOdds, rng)
  return { caught: false, fled, catchChance: catchOdds }
}
