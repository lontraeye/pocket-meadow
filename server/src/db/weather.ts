import { eq } from 'drizzle-orm'
import { type WeatherKey, weatherConfig } from '../config/weather.js'
import { currentWeather, nextWeatherChangeAt } from '../game/weather.js'
import { getDb } from './client.js'
import { trainers } from './schema.js'

export type WeatherView = { key: WeatherKey; name: string; until: number }

/** Clima de hoje do jogador e quando ele muda (próxima meia-noite de Brasília). */
export function loadWeather(userId: number, now: number): WeatherView {
  const row = getDb()
    .select({ weatherSeed: trainers.weatherSeed })
    .from(trainers)
    .where(eq(trainers.userId, userId))
    .get()
  if (!row) throw new Error(`trainer missing for user ${userId}`)
  const key = currentWeather(userId, row.weatherSeed, now)
  return { key, name: weatherConfig.names[key], until: nextWeatherChangeAt(now) }
}
