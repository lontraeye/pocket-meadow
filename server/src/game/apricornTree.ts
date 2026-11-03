// Árvore de Apricorn (PLANNING.md, seção 5.23). Funções puras: o progresso é
// um número real de Apricorns (a parte inteira está pendurada) guardado no
// instante `since`, e anda conforme o clima de cada dia. Nada roda em loop.

import { apricornConfig, type TreeConfig } from '../config/apricorn.js'
import type { WeatherKey } from '../config/weather.js'
import { nextWeatherChangeAt, weatherDay } from './weather.js'

/** Clima de um dia (número do dia em Brasília). */
export type WeatherOf = (day: number) => WeatherKey

/** Quanto tempo leva um Apricorn com esse clima. */
export function treeUnitMs(weather: WeatherKey, config: TreeConfig = apricornConfig.tree): number {
  return weather === 'rain' ? config.intervalMs * config.rainMult : config.intervalMs
}

/** Leva o progresso de `since` até `now`, dia a dia, parando no limite. */
export function settleTree(
  progress: number,
  since: number,
  now: number,
  weatherOf: WeatherOf,
  config: TreeConfig = apricornConfig.tree,
): number {
  let p = Math.min(config.cap, progress)
  let t = since
  while (t < now && p < config.cap) {
    const end = Math.min(now, nextWeatherChangeAt(t))
    p += (end - t) / treeUnitMs(weatherOf(weatherDay(t)), config)
    t = end
  }
  return Math.min(config.cap, p)
}

/**
 * Quando cada próximo Apricorn fica pronto, a partir de `now`, até a árvore
 * encher. O futuro usa o clima de hoje (`weather`): o dos próximos dias não
 * vai ao front, e a tela recarrega quando o dia vira.
 */
export function treeReadyTimes(
  progress: number,
  now: number,
  weather: WeatherKey,
  config: TreeConfig = apricornConfig.tree,
): number[] {
  const unit = treeUnitMs(weather, config)
  const times: number[] = []
  for (let k = Math.floor(progress) + 1; k <= config.cap; k++) {
    times.push(Math.ceil(now + (k - progress) * unit))
  }
  return times
}

/** Colheita: tudo o que está pendurado sai; a fração do próximo fica. */
export function harvestTree(progress: number): { harvested: number; progress: number } {
  const harvested = Math.floor(progress)
  return { harvested, progress: progress - harvested }
}
