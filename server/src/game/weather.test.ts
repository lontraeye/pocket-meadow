import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { weatherConfig, weatherKeys } from '../config/weather.js'
import { currentWeather, growMsFor, nextWeatherChangeAt, setDevWeather, weatherDay, weatherForDay } from './weather.js'

describe('clima do dia', () => {
  test('o dia vira à meia-noite de Brasília (03:00 UTC)', () => {
    const beforeMidnight = Date.UTC(2026, 9, 30, 2, 59, 59) // 29/10 23:59:59 em Brasília
    const atMidnight = Date.UTC(2026, 9, 30, 3, 0, 0) // 30/10 00:00 em Brasília
    assert.equal(weatherDay(atMidnight), weatherDay(beforeMidnight) + 1)
    assert.equal(nextWeatherChangeAt(beforeMidnight), atMidnight)
    assert.equal(nextWeatherChangeAt(atMidnight), atMidnight + 24 * 60 * 60 * 1000)
  })

  test('mesmo jogador e mesmo dia dão o mesmo clima; o dia seguinte é outro sorteio', () => {
    const seed = 123456789
    const day = weatherDay(Date.UTC(2026, 9, 29, 15))
    assert.equal(weatherForDay(seed, day), weatherForDay(seed, day))
    const week = Array.from({ length: 60 }, (_, i) => weatherForDay(seed, day + i))
    assert.ok(new Set(week).size > 1, 'dois meses com um clima só')
  })

  test('jogadores diferentes têm climas diferentes no mesmo dia', () => {
    const day = weatherDay(Date.UTC(2026, 9, 29, 15))
    const climas = new Set(Array.from({ length: 50 }, (_, seed) => weatherForDay(seed * 7919 + 1, day)))
    assert.ok(climas.size > 1)
  })

  test('a frequência segue os pesos do config', () => {
    const counts = new Map<string, number>()
    const days = 20000
    for (let day = 0; day < days; day += 1) {
      const key = weatherForDay(987654321, day)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const total = weatherConfig.weights.reduce((sum, entry) => sum + entry.weight, 0)
    for (const entry of weatherConfig.weights) {
      const share = (counts.get(entry.key) ?? 0) / days
      assert.ok(Math.abs(share - entry.weight / total) < 0.02, `${entry.key}: ${share}`)
    }
    assert.equal(counts.size, weatherKeys.length)
  })

  test('o clima forçado em dev vale até ser limpo', () => {
    const now = Date.UTC(2026, 9, 29, 15)
    const natural = currentWeather(42, 1, now)
    const other = weatherKeys.find((key) => key !== natural)!
    setDevWeather(42, other)
    assert.equal(currentWeather(42, 1, now), other)
    setDevWeather(42, null)
    assert.equal(currentWeather(42, 1, now), natural)
  })

  test('clima favorito corta o tempo de crescimento; outro clima não', () => {
    assert.equal(growMsFor(60_000, 'rain', 'rain'), Math.round(60_000 * weatherConfig.favoriteGrowFactor))
    assert.equal(growMsFor(60_000, 'rain', 'sunny'), 60_000)
  })
})
