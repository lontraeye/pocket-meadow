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

/**
 * Faixas da mesma rolagem da captura, no estilo do Pokémon GO.
 * A captura continua `rolagem < chance`. Se falhou, o valor da rolagem
 * (não um segundo sorteio) escolhe a chacoalhada:
 * perto de 1 quebra na 1ª, no meio na 2ª, abaixo de `second` aguenta a 3ª.
 * Chance alta só falha no topo, então só escapa na primeira.
 */
export const catchShakeBands = {
  first: 2 / 3,
  second: 1 / 3,
} as const

/** Chacoalhadas antes do desfecho. 3 = passou todas (captura, ou escapou na última). */
export function catchShakeCount(catchChance: number, roll: number): 1 | 2 | 3 {
  if (!(catchChance < 1) || roll < catchChance) return 3
  if (roll >= catchShakeBands.first) return 1
  if (roll >= catchShakeBands.second) return 2
  return 3
}

export type ThrowRoll = {
  caught: boolean
  fled: boolean
  catchChance: number
  /** 1, 2 ou 3. Captura é sempre 3. */
  shakes: 1 | 2 | 3
}

/** Uma tentativa de captura +, se falhar, rolagem de fuga. Determinístico. */
export function rollThrow(input: {
  encounterSeed: number
  throwIndex: number
  captureRate: number
  berryBonus?: number
  ballMult?: number
  /** Qualidade × curva (9.4). */
  throwMult?: number
  /** Master Ball: chance 1, mas ainda consome a rolagem de captura. */
  guaranteed?: boolean
  fleeChance?: number
}): ThrowRoll {
  const catchOdds = catchChance(
    input.captureRate,
    input.berryBonus ?? 1,
    input.ballMult ?? 1,
    input.guaranteed === true,
    input.throwMult ?? 1,
  )
  const fleeOdds = input.fleeChance ?? battleConfig.throwFleeChance
  const rng = throwRngAt(input.encounterSeed, input.throwIndex)
  const roll = rng()
  const caught = roll < catchOdds
  const shakes = catchShakeCount(catchOdds, roll)
  if (caught) return { caught: true, fled: false, catchChance: catchOdds, shakes }
  const fled = rollChance(fleeOdds, rng)
  return { caught: false, fled, catchChance: catchOdds, shakes }
}
