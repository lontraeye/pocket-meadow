export type GameState = {
  now: number
  gardenMaxVisible: number
  plotSlots: number
  trainer: {
    level: number
    xp: number
    energy: number
    energyMax: number
    energyNextAt: number | null
    genericCandies: number
  }
  pokemon: {
    id: number
    speciesId: number
    name: string
    displayName: string
    evolutionChainId: number
    level: number
    xp: number
    xpToNext: number | null
    isShiny: boolean
    nickname: string | null
    isFavorite: boolean
    location: 'garden' | 'daycare'
  }[]
  candies: { evolutionChainId: number; amount: number }[]
  plots: { plotIndex: number; berryKey: string; readyAt: number }[]
}

export type ApiError = { error: string; min?: number; max?: number }

export async function api(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function errorText(error: ApiError): string {
  switch (error.error) {
    case 'invalid_username':
      return `O usuário precisa ter de ${error.min} a ${error.max} caracteres: letras, números ou _.`
    case 'invalid_password':
      return `A senha precisa ter de ${error.min} a ${error.max} caracteres.`
    case 'invalid_starter':
      return 'Escolha Bulbasaur, Charmander ou Squirtle.'
    case 'username_taken':
      return 'Esse usuário já existe.'
    case 'invalid_credentials':
      return 'Usuário ou senha não confere.'
    case 'invalid_body':
      return 'Não entendi o pedido.'
    case 'not_signed_in':
      return 'Entre de novo.'
    default:
      return 'Algo deu errado.'
  }
}
