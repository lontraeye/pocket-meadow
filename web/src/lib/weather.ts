import type { WeatherKey } from './api'

// Clima do jardim (PLANNING.md, seção 5.11). O servidor sorteia e decide o
// bônus; aqui só os ícones e os textos.

function grid(rows: string[]): { x: number; y: number }[] {
  return rows.flatMap((line, y) => [...line].flatMap((cell, x) => (cell === 'X' ? [{ x, y }] : [])))
}

/** Ícones 12×12 (X = pixel aceso), no traço dos outros ícones do HUD. */
export const WEATHER_ICONS: Record<WeatherKey, { x: number; y: number }[]> = {
  sunny: grid([
    '.....XX.....',
    '.X...XX...X.',
    '..X......X..',
    '....XXXX....',
    '...XXXXXX...',
    'XX.XXXXXX.XX',
    'XX.XXXXXX.XX',
    '...XXXXXX...',
    '....XXXX....',
    '..X......X..',
    '.X...XX...X.',
    '.....XX.....',
  ]),
  cloudy: grid([
    '............',
    '............',
    '....XXX.....',
    '...XXXXX....',
    '..XXXXXXXX..',
    '.XXXXXXXXXX.',
    'XXXXXXXXXXXX',
    'XXXXXXXXXXXX',
    '.XXXXXXXXXX.',
    '............',
    '............',
    '............',
  ]),
  rain: grid([
    '....XXX.....',
    '...XXXXX....',
    '.XXXXXXXXX..',
    'XXXXXXXXXXX.',
    'XXXXXXXXXXX.',
    '.XXXXXXXXX..',
    '............',
    '.X...X...X..',
    'X...X...X...',
    '............',
    '..X...X...X.',
    '.X...X...X..',
  ]),
  wind: grid([
    '............',
    '.......XX...',
    '.........X..',
    'XXXXXXXXX...',
    '............',
    'XXXXXXXXXXX.',
    '...........X',
    '..........X.',
    '............',
    'XXXXXX......',
    '......X.....',
    '.....X......',
  ]),
}

/** "Com chuva", "com sol"...: para frases como "cresce mais rápido com chuva". */
export const WEATHER_WITH: Record<WeatherKey, string> = {
  sunny: 'com sol',
  cloudy: 'com tempo nublado',
  rain: 'com chuva',
  wind: 'com vento',
}
