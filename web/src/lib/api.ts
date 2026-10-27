export type BattleRules = {
  k: number
  minChance: number
  maxChance: number
  teamWeights: number[]
}

export type PendingEncounter = {
  id: number
  regionSlug: string
  regionName: string
  speciesId: number
  name: string
  displayName: string
  level: number
  isShiny: boolean
  expiresAt: number
  wildPower: number
}

export type RegionInfo = {
  slug: string
  name: string
  minTrainerLevel: number
  wildLevelRange: [number, number]
  unlocked: boolean
}

export type BattleOutcome = {
  encounterId: number
  winChance: number
  won: boolean
  catchChance: number | null
  caught: boolean
  status: 'lost' | 'caught' | 'escaped'
  fighters: {
    pokemonId: number
    xpGained: number
    level: number
    xp: number
    levelsGained: number
  }[]
  trainerXpGained: number
  trainer: { level: number; xp: number; levelsGained: number }
}

export type GameState = {
  now: number
  gardenMaxVisible: number
  plotSlots: number
  battle: BattleRules
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
    power: number
  }[]
  candies: { evolutionChainId: number; amount: number }[]
  plots: { plotIndex: number; berryKey: string; readyAt: number }[]
  encounter: PendingEncounter | null
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
    case 'no_energy':
      return 'Sem energia no momento.'
    case 'region_locked':
      return 'Essa região ainda está bloqueada.'
    case 'region_not_found':
      return 'Essa região não existe.'
    case 'encounter_pending':
      return 'Termine o encontro atual antes.'
    case 'encounter_not_found':
      return 'Esse encontro não está mais valendo.'
    case 'invalid_team':
      return 'Escolha de 1 a 3 Pokémon seus, no jardim, sem repetir.'
    default:
      return 'Algo deu errado.'
  }
}
