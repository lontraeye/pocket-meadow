// Clima do dia (PLANNING.md, seção 5.11). Funções puras: o clima sai da
// `weather_seed` do treinador (sorteada com crypto na criação da conta) e do
// número do dia em Brasília. Nada é gravado por dia, dá para reproduzir, e
// sem a seed (que nunca vai ao front) não dá para prever os próximos dias.

import { type WeatherKey, weatherConfig } from '../config/weather.js'
import { mulberry32 } from './mulberry32.js'

const DAY_MS = 24 * 60 * 60 * 1000
const offsetMs = () => weatherConfig.utcOffsetMinutes * 60 * 1000

/** Número do dia em Brasília (muda à meia-noite de lá). */
export function weatherDay(now: number): number {
  return Math.floor((now + offsetMs()) / DAY_MS)
}

/** Instante (ms) da próxima meia-noite de Brasília, quando o clima muda. */
export function nextWeatherChangeAt(now: number): number {
  return (weatherDay(now) + 1) * DAY_MS - offsetMs()
}

export function weatherForDay(seed: number, day: number): WeatherKey {
  // Mistura a seed com o dia (constante de Knuth) para dias vizinhos não
  // darem sequências parecidas; a primeira saída do mulberry32 é descartada.
  const rng = mulberry32((seed ^ Math.imul(day, 0x9e3779b1)) >>> 0)
  rng()
  const total = weatherConfig.weights.reduce((sum, entry) => sum + entry.weight, 0)
  let roll = rng() * total
  for (const entry of weatherConfig.weights) {
    roll -= entry.weight
    if (roll < 0) return entry.key
  }
  return weatherConfig.weights[weatherConfig.weights.length - 1]!.key
}

// Teste (DEV_TOOLS): troca o clima de um jogador até reiniciar o servidor.
const devOverrides = new Map<number, WeatherKey>()

export function setDevWeather(userId: number, key: WeatherKey | null): void {
  if (key === null) devOverrides.delete(userId)
  else devOverrides.set(userId, key)
}

export function currentWeather(userId: number, seed: number, now: number): WeatherKey {
  return devOverrides.get(userId) ?? weatherForDay(seed, weatherDay(now))
}

/** Tempo de crescimento com o bônus do clima favorito (arredondado em ms). */
export function growMsFor(growMs: number, favorite: WeatherKey, weather: WeatherKey): number {
  return favorite === weather ? Math.round(growMs * weatherConfig.favoriteGrowFactor) : growMs
}
