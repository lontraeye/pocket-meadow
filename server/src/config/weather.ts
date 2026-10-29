// Clima do jardim (PLANNING.md, seção 5.11). Um clima por dia, por jogador.

export type WeatherKey = 'sunny' | 'cloudy' | 'rain' | 'wind'

export const weatherConfig = {
  /**
   * O dia vira à meia-noite de Brasília. UTC−3 fixo: o Brasil não tem horário
   * de verão desde 2019. Se voltar, trocar por um cálculo com fuso.
   */
  utcOffsetMinutes: -180,
  /** Plantar no clima favorito da berry: tempo de crescimento × isto. */
  favoriteGrowFactor: 0.75,
  /** Peso de cada clima no sorteio do dia. */
  weights: [
    { key: 'sunny', weight: 35 },
    { key: 'cloudy', weight: 25 },
    { key: 'rain', weight: 25 },
    { key: 'wind', weight: 15 },
  ],
  names: {
    sunny: 'Ensolarado',
    cloudy: 'Nublado',
    rain: 'Chuva',
    wind: 'Ventania',
  },
} as const satisfies {
  utcOffsetMinutes: number
  favoriteGrowFactor: number
  weights: readonly { key: WeatherKey; weight: number }[]
  names: Record<WeatherKey, string>
}

export const weatherKeys: readonly WeatherKey[] = weatherConfig.weights.map((entry) => entry.key)

export function isWeatherKey(value: unknown): value is WeatherKey {
  return typeof value === 'string' && (weatherKeys as readonly string[]).includes(value)
}
