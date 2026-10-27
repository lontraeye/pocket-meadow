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
  gameRegion: 'kanto' | 'johto'
  minTrainerLevel: number
  wildLevelRange: [number, number]
  unlocked: boolean
}

export type ItemCredit = { itemKey: string; quantity: number }

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
    moveOffers?: LearnEntryView[]
  }[]
  trainerXpGained: number
  trainer: { level: number; xp: number; levelsGained: number }
  seedDrop: { itemKey: string; berryKey: string } | null
  levelRewards: ItemCredit[]
}

export type MoveView = {
  name: string
  displayName: string
  type: string
  power: number
  damageClass: 'physical' | 'special'
}

export type LearnEntryView = {
  move: string
  level: number
  displayName?: string
  power?: number
  type?: string
  damageClass?: 'physical' | 'special'
}

export type OwnedPokemon = {
  id: number
  speciesId: number
  name: string
  displayName: string
  evolutionChainId: number
  type1: string
  type2: string | null
  level: number
  xp: number
  xpToNext: number | null
  isShiny: boolean
  nickname: string | null
  isFavorite: boolean
  location: 'garden' | 'daycare'
  caughtAt: number
  power: number
  evolutions: { toSpeciesId: number; displayName: string; minLevel: number; viaTrade: boolean }[]
  ivRating: { total: number; percent: number; stars: number }
  nature: { key: string; displayName: string; up: string | null; down: string | null }
  ability: { slot: '1' | '2' | 'hidden'; key: string; displayName: string; combat: boolean }
  stats: {
    hp: number
    attack: number
    defense: number
    spAttack: number
    spDefense: number
    speed: number
  }
  fastMove: MoveView
  chargedMove: MoveView | null
  nextChargedMove: { move: string; level: number; displayName: string } | null
  learnset: LearnEntryView[]
  availableMoves: { fast: MoveView[]; charged: MoveView[] }
}

export type ProgressionRules = {
  levelCap: number
  candyXp: number
  genericPerCandy: number
  releaseBase: number
  releaseLevelDiv: number
  releaseShinyMult: number
  releaseGeneric: number
  feedMax: number
  releaseMax: number
  xpBase: number
  xpExponent: number
}

export type DaycareSlot = {
  slotIndex: number
  pokemonId: number
  enteredAt: number
  lastSettledAt: number
  xpGained: number
  fullAt: number
}

export type DaycareState = {
  slotsUnlocked: number
  nextSlotLevel: number | null
  slots: DaycareSlot[]
}

export type BerryInfo = {
  key: string
  name: string
  growMs: number
  effectDescription: string
  effectKey: string | null
}

export type PlotState = {
  plotIndex: number
  berryKey: string
  plantedAt: number
  readyAt: number
}

export type InventoryRow = { itemKey: string; quantity: number }

export type ActiveEffect = {
  id: number
  effectKey: string
  multiplier: number
  charges: number | null
  expiresAt: number | null
  createdAt: number
}

export type GameState = {
  now: number
  devTools: boolean
  gardenMaxVisible: number
  plotSlotsUnlocked: number
  nextPlotSlotLevel: number | null
  berries: BerryInfo[]
  uprootSeedReturnChance: number
  battle: BattleRules
  progression: ProgressionRules
  trainer: {
    level: number
    xp: number
    energy: number
    energyMax: number
    energyNextAt: number | null
    energyFullAt: number | null
    genericCandies: number
  }
  pokemon: OwnedPokemon[]
  candies: { evolutionChainId: number; amount: number }[]
  daycare: DaycareState
  plots: PlotState[]
  inventory: InventoryRow[]
  effects: ActiveEffect[]
  encounter: PendingEncounter | null
}

export type ApiError = { error: string; min?: number; max?: number; pokemonId?: number; readyAt?: number }

export async function api(path: string, body?: unknown, method?: 'POST' | 'PATCH' | 'DELETE'): Promise<Response> {
  const verb = method ?? (body === undefined ? 'GET' : 'POST')
  const hasBody = body !== undefined
  return fetch(path, {
    method: verb,
    credentials: 'include',
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  })
}

export function berryIconSrc(berryKey: string): string {
  return `/sprites/items/${berryKey}-berry.png`
}

export function itemLabel(itemKey: string, berries: BerryInfo[]): string {
  if (itemKey.startsWith('seed:')) {
    const berry = berries.find((row) => row.key === itemKey.slice(5))
    return berry ? `Semente ${berry.name}` : itemKey
  }
  if (itemKey.startsWith('berry:')) {
    const berry = berries.find((row) => row.key === itemKey.slice(6))
    return berry ? `Berry ${berry.name}` : itemKey
  }
  return itemKey
}

export function effectLabel(effectKey: string): string {
  switch (effectKey) {
    case 'catch_boost':
      return 'Captura ×'
    case 'rare_boost':
      return 'Raros ×'
    case 'daycare_boost':
      return 'Daycare ×'
    case 'shiny_boost':
      return 'Shiny ×'
    default:
      return effectKey
  }
}

export function errorText(error: ApiError): string {
  switch (error.error) {
    case 'invalid_username':
      return `O nome precisa ter de ${error.min} a ${error.max} caracteres: letras, números ou _.`
    case 'invalid_starter':
      return 'Escolha Bulbasaur, Charmander ou Squirtle.'
    case 'username_taken':
      return 'Esse nome já está em uso.'
    case 'signup_expired':
      return 'O cadastro expirou. Entre com o Google de novo.'
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
    case 'pokemon_not_found':
      return 'Esse Pokémon não está mais com você.'
    case 'in_daycare':
      return 'Ele está no daycare.'
    case 'last_in_garden':
      return 'Deixe pelo menos um Pokémon no jardim.'
    case 'slot_locked':
      return 'Esse slot ainda está bloqueado.'
    case 'slot_taken':
      return 'Esse slot já está ocupado.'
    case 'last_pokemon':
      return 'Você precisa ficar com pelo menos um Pokémon.'
    case 'level_cap':
      return 'Já está no nível máximo.'
    case 'not_enough_candies':
      return 'Doces insuficientes.'
    case 'level_too_low':
      return `Evolui no nível ${error.min ?? ''}`.trim()
    case 'evolution_not_found':
      return 'Essa evolução não existe.'
    case 'invalid_nickname':
      return 'O apelido precisa ter de 1 a 12 caracteres, sem quebra de linha.'
    case 'plot_locked':
      return 'Esse canteiro ainda está bloqueado.'
    case 'plot_empty':
      return 'Não há nada plantado aqui.'
    case 'already_ready':
      return 'Já está pronta: é só colher.'
    case 'plot_taken':
      return 'Esse canteiro já tem uma berry.'
    case 'no_seed':
      return 'Você não tem essa semente.'
    case 'unknown_berry':
      return 'Essa berry não existe.'
    case 'not_ready':
      return 'A berry ainda não está pronta.'
    case 'no_item':
      return 'Você não tem esse item.'
    case 'unknown_item':
      return 'Esse item não existe.'
    case 'energy_full':
      return 'Energia já está cheia.'
    case 'move_not_found':
      return 'Esse golpe não existe.'
    case 'move_wrong_slot':
      return 'Esse golpe não cabe nesse slot.'
    case 'move_not_learned':
      return 'Esse Pokémon ainda não pode usar esse golpe.'
    case 'traits_missing':
      return 'Os traços desse Pokémon ainda não foram preenchidos.'
    default:
      return 'Algo deu errado.'
  }
}
