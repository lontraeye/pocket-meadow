/** Espelho dos JSON da PokéAPI quando pokeapi.co está fora. */
export const apiData = {
  repoUrl: 'https://github.com/PokeAPI/api-data.git',
  commit: '447bd5c378bf87da964bfe4dd7487a7bf1d97cbd', // 2026-10-27
  rawBase:
    'https://raw.githubusercontent.com/PokeAPI/api-data/447bd5c378bf87da964bfe4dd7487a7bf1d97cbd/data/api/v2',
  cacheDir: '.cache/api-data',
  requestDelayMs: 40,
  maxRetries: 3,
} as const
