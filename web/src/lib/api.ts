import type { PieceKey, StructurePiece } from '@garden/layout'
import type { PaintFloor } from '@habitat/config'
import type { HabitatKind } from '@habitat/area'
import type { BattleSetup } from '@sim'
import { busyFromLastPress } from './busy'
import { markOffline, markOnline } from './connection.svelte'

export type BattleRules = {
  k: number
  minChance: number
  maxChance: number
  teamWeights: number[]
  fleeBase: number
  fleeStep: number
  fleeMax: number
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
  battleStartedAt: number | null
  /** null = luta ainda não vencida; epoch ms da vitória (8.4, aguardando captura). */
  wonAt: number | null
  /** Chance base (catch_boost); a UI recalcula por bola. */
  catchChance: number | null
  throwCount: number
  agitation: number
  captureRate: number
  type1: string
  type2: string | null
  /** Luta contra líder: quem é e o time dele, em ordem; null = selvagem. */
  leader: EncounterLeader | null
}

export type EncounterLeader = {
  key: string
  name: string
  foes: { speciesId: number; displayName: string; level: number; ace: boolean }[]
}

export type BallInfo = {
  key: string
  displayName: string
  sprite: string
  itemKey: string
}

export type ThrowQuality = 'normal' | 'nice' | 'great' | 'excellent'

export type BallsConfig = {
  startingPokeBalls: number
  list: BallInfo[]
  catchMult: number
  catchMin: number
  throwQualityMult: Record<ThrowQuality, number>
  throwCurveMult: number
}

export type RegionInfo = {
  slug: string
  name: string
  gameRegion: 'kanto' | 'johto'
  /** Capítulo da jornada (1 a 8, 9 = Liga, 10 = fim de jogo); null onde ainda não há. */
  chapter: number | null
  minTrainerLevel: number
  wildLevelRange: [number, number]
  unlocked: boolean
}

/** Lugar da jornada (JORNADA.md, seção 11), como o GET /places manda. */
export type PlaceTool = 'oldRod' | 'goodRod' | 'superRod' | 'headbutt' | 'surf' | 'rockSmash' | 'fly'

export type PlaceView = {
  slug: string
  name: string
  kind: 'town' | 'area' | 'water'
  chapter: number
  blurb: string
  x: number
  y: number
  open: boolean
  /** Por que está fechado (ex.: "Abre no nível 3"); null = aberto. */
  reason: string | null
  visited: boolean
  /** Dá para voar direto (Voo liberado, cidade visitada). */
  flyable: boolean
  wildLevelRange: [number, number] | null
  speciesTotal: number
  speciesCaught: number
  /** Ferramenta que a ligação pede (null = só andar). */
  links: { to: string; requires: PlaceTool | null; open: boolean; reason: string | null; isNew: boolean }[]
}

/** Pokémon andando no campo de encontro (GET /field). */
export type FieldSpawn = {
  id: number
  slot: number
  speciesId: number
  level: number
  isShiny: boolean
  displayName: string
  type1: string
  type2: string | null
}

/** Mato, Surf (nadando no campo dos lugares só de água), pesca, árvore ou pedra. */
export type SpeciesWhere = 'walk' | 'surf' | 'fish' | 'tree' | 'rock'

/** Árvore ou pedra que soltou um item em vez de um Pokémon (POST /field/use). */
export type SpotDrop = { drop: { itemKey: string; quantity: number } }

/** Mancha do campo (água, árvore, pedra) e o que dá para fazer nela. */
export type FieldSpot = {
  kind: 'water' | 'tree' | 'rock'
  actions: { method: PlaceTool; label: string; open: boolean; reason: string | null }[]
}

export type FieldResponse = {
  regionSlug: string
  spawns: FieldSpawn[]
  spots: FieldSpot[]
  /** Campo vazio numa área com mato: dá para explorar de novo. */
  canExplore: boolean
  /** Lugar só de água sem Surf: por que ninguém nada no campo. */
  fieldBlock: string | null
}

export type PlacesResponse = {
  current: string
  trainerLevel: number
  canFly: boolean
  /** Voo ganho, mas sem Pokémon que voe no time: o motivo. */
  flyReason: string | null
  /** Objetivo: o marco do capítulo aberto mais alto (null quando já foi conquistado). */
  goal: {
    chapter: number
    title: string
    caught: number
    total: number
    milestone: {
      key: string
      name: string
      typeLabel: string
      town: string
      townName: string
      ready: boolean
      here: boolean
      grants: string[]
      /** O líder do marco e o time dele; null = marco sem luta. */
      leader: { name: string; foes: { speciesId: number; level: number; ace: boolean }[] } | null
    } | null
  }
  places: PlaceView[]
  /** Espécies do lugar atual; as não vistas vêm sem id (o "?"). */
  here: {
    species: {
      speciesId: number | null
      displayName: string | null
      status: 'caught' | 'seen' | 'unknown'
      /** Onde aparece aqui, na ordem mato → surf → pesca → árvore → pedra. */
      where: SpeciesWhere[]
    }[]
  }
}

export type ItemCredit = { itemKey: string; quantity: number }

export type BattleStart = {
  encounterId: number
  seed: number
  /** O servidor manda o setup serializado; o formato é o mesmo do BattleSetup. */
  setup: BattleSetup
  timeLimitMs: number
}

export type BattleOutcome = {
  encounterId: number
  winChance: number | null
  won: boolean
  catchChance: number | null
  caught: boolean
  /** 'defeated' = venceu um treinador (sem captura nem fuga). */
  status: 'lost' | 'caught' | 'escaped' | 'pending' | 'defeated'
  log?: unknown[]
  fighters: {
    pokemonId: number
    xpGained: number
    level: number
    xp: number
    levelsGained: number
    /** Carregado sorteado ao subir de nível, se o slot estava vazio (seção 5.18). */
    learnedMove?: MoveView | null
    /** Golpe oferecido ao subir de nível: aprender ou manter na ficha. */
    offeredMove?: MoveView | null
  }[]
  trainerXpGained: number
  trainer: { level: number; xp: number; levelsGained: number }
  seedDrop: { itemKey: string; berryKey: string } | null
  levelRewards: ItemCredit[]
  /** Contra quem foi a luta; ausente em resposta antiga = selvagem (ver battleFlow.ts). */
  opponent?:
    | { kind: 'wild' }
    | { kind: 'leader'; name: string; cleared: { key: string; name: string; opens: number; grants: string[] } | null }
}

/** Resposta de POST /encounters/:id/throw. */
export type ThrowOutcome = {
  caught: boolean
  fled: boolean
  catchChance: number
  /** Chacoalhadas antes do desfecho. 3 = passou todas. */
  shakes: 1 | 2 | 3
  throwNumber: number
  agitation: number
  status: 'caught' | 'escaped' | 'pending'
  pokemonId?: number
  candyBonus?: number
  trainerXpGained?: number
  trainer?: { level: number; xp: number; levelsGained: number }
  levelRewards?: ItemCredit[]
  /** A área da captura: espécies dela já suas, se esta foi nova e se fechou a área. */
  area?: AreaProgress | null
}

export type AreaProgress = { name: string; caught: number; total: number; isNew: boolean; complete: boolean }

export type MoveView = {
  name: string
  displayName: string
  type: string
  power: number
  damageClass: 'physical' | 'special'
  /** Texto curto do efeito (8.6); null se não tem. */
  effectText?: string | null
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
  /** 'pc' = guardado no PC: fora do jardim, parado. */
  location: 'garden' | 'daycare' | 'pc'
  /** Posição no time (0 a teamMax − 1); null = fora do time. */
  teamSlot: number | null
  caughtAt: number
  caughtRegion: string | null
  caughtBall: string
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
  /** Golpe oferecido ao subir de nível, esperando aprender ou manter (5.18). */
  moveOffer: (MoveView & { slot: 'fast' | 'charged' }) | null
  /** Quantos golpes o doce pode sortear em cada slot (0 = já tem o mais forte). */
  rerollOptions: { fast: number; charged: number }
  learnset: LearnEntryView[]
  availableMoves: { fast: MoveView[]; charged: MoveView[] }
  /** Cuidado como pet (5.21): de 0 a 100; `petReadyAt` = quando o carinho volta (null = já). */
  pet: PetView
  /** Fração do HP de luta (0..1); 0 = desmaiado (não luta). */
  hpRatio: number
  /** HP máximo de luta (o atual = hpRatio × maxHp). */
  maxHp: number
  /** Habitat onde mora (5.22); null = sem casa. */
  habitatId: number | null
}

/** Quadro de missões diárias (5.20). */
export type MissionReward = {
  trainerXp: number
  genericCandies: number
  items: { itemKey: string; quantity: number }[]
  randomSeed?: boolean
}

export type MissionView = {
  id: number
  slot: number
  kind: string
  text: string
  progress: number
  target: number
  done: boolean
  claimed: boolean
  reward: MissionReward
  region: string | null
}

export type MissionsView = {
  day: string
  renewsAt: number
  list: MissionView[]
  chest: { ready: boolean; claimed: boolean; reward: MissionReward }
  rerollsLeft: number
  claimable: number
}

export type PetView = {
  pokemonId: number
  hunger: number
  affection: number
  happiness: number
  petReadyAt: number | null
}

/** Árvore de Apricorn (5.23); `readyAts` = quando cada próximo fica pronto, até encher. */
export type TreeView = {
  /** A peça (cada árvore tem o seu estado). */
  id: number
  key: 'apricorn_tree' | 'apricorn_tree_blue' | 'apricorn_tree_yellow'
  color: 'red' | 'blue' | 'yellow'
  itemKey: string
  /** No jardim (false = guardada no inventário de construção, parada). */
  placed: boolean
  ready: number
  cap: number
  readyAts: number[]
  unitMs: number
  raining: boolean
}

export type BenchJob = {
  id: number
  recipeKey: string
  /** Bolas por Apricorn da receita deste lote. */
  perUnit: number
  output: string
  quantity: number
  unitMs: number
  startedAt: number
  collected: number
}

export type BenchRecipe = {
  key: string
  input: string
  output: string
  perUnit: number
  unitMs: number
  minBenchLevel: number
  unlocked: boolean
}

/** Bancada de bolas (5.23): as bolas do lote ficam prontas uma a uma (`startedAt + k × unitMs`). */
export type BenchView = {
  /** A peça (cada bancada tem o seu operador, lote e nível). */
  id: number
  /** No jardim (false = guardada no inventário de construção). */
  placed: boolean
  level: number
  maxLevel: number
  batchSize: number
  speedBonus: number
  operatorTypes: string[]
  operatorId: number | null
  recipes: BenchRecipe[]
  job: BenchJob | null
  /** Upgrade em andamento: a bancada fica parada até `endsAt`. */
  upgrade: { toLevel: number; endsAt: number; startedAt: number } | null
  next: {
    level: number
    batchSize: number
    speed: number
    /** O marco que falta para subir (null = já pode). */
    unlockAt: UnlockAt | null
    ms: number
    cost: { itemKey: string; quantity: number; have: number }[]
    newRecipes: string[]
  } | null
}

/** Máquina de cura do jardim: cargas que voltam com o tempo. */
export type HealMachineView = {
  /** A peça (cada máquina tem as suas cargas). */
  id: number
  charges: number
  max: number
  nextChargeAt: number | null
  unitMs: number
  /** No jardim (false = guardada, parada). */
  placed: boolean
}

/** Construção do jardim (PROGRESSAO.md 4.3): peças colocadas (casas da grade jogável) e guardadas. */
export type GardenLayout = {
  cols: number
  rows: number
  /** `flipped`: girada (só bancada e máquina de cura); `structureId`: a estrutura (null nos canteiros). */
  pieces: {
    id: number
    piece: PieceKey
    structureId: number | null
    slot: number
    col: number
    row: number
    flipped: boolean
  }[]
  /** Estruturas guardadas: a peça e o tipo. */
  stored: { id: number; piece: StructurePiece }[]
  plotLimit: number
  plotsPlaced: number
  /** O próximo marco que sobe o limite de canteiros (null = já no máximo). */
  nextPlots: (UnlockAt & { plots: number }) | null
  /** Peças que ainda não abriram e o marco que abre cada uma. */
  locked: { piece: StructurePiece; unlockAt: UnlockAt }[]
  /** Receitas de construção: custo, tempo, quantas tem (com a obra) e o teto. */
  recipes: {
    piece: StructurePiece
    cost: { itemKey: string; quantity: number; have: number }[]
    ms: number
    count: number
    cap: number
    /** O marco que libera a receita (null = liberada). */
    unlockAt: UnlockAt | null
    /** O próximo marco que sobe o teto. */
    nextCap: (UnlockAt & { cap: number }) | null
  }[]
  /** A obra em andamento (uma por vez), ou null. */
  building: { id: number; piece: StructurePiece; startedAt: number; readyAt: number } | null
  /** Chão pintado (habitats, 5.22): uma casa por linha, sem as casas de canteiro. */
  floor: { col: number; row: number; floor: string }[]
  /** Paleta do chão, na ordem, com o marco que abre os fechados (null = aberto). */
  floors: { floor: PaintFloor; unlockAt: UnlockAt | null }[]
  /** Habitats: área e tipo escolhidos (a conta de pontos sai do motor). */
  habitats: { id: number; kind: HabitatKind; tiles: { col: number; row: number }[] }[]
  /** Tipos de habitat, com o marco que abre os fechados. */
  habitatKinds: { kind: HabitatKind; unlockAt: UnlockAt | null }[]
}

/** Pokémon selvagem visitando um habitat (5.22). */
export type GardenVisitor = {
  id: number
  habitatId: number
  speciesId: number
  displayName: string
  level: number
  isShiny: boolean
  leavesAt: number
}

/** O marco (líder vencido) que abre algo no jardim. */
export type UnlockAt = { milestone: string; name: string }

/** Presente que um pet deixou no chão; `generic_candy` = doce genérico. */
export type GardenGift = {
  id: number
  pokemonId: number | null
  itemKey: string
  quantity: number
  createdAt: number
}

export type ProgressionRules = {
  levelCap: number
  candyXp: number
  genericPerCandy: number
  /** Doces da linha para sortear de novo cada golpe (5.18). */
  moveRerollCost: { fast: number; charged: number }
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
  /** Prévia do fim do prazo, com o time e o cuidador de agora. */
  projected: { level: number; xpGained: number }
}

export type DaycareRules = {
  levelsPerHour: number
  catchUpPerLevel: number
  catchUpMax: number
  maxHours: number
  xpBase: number
  xpExponent: number
  levelCap: number
}

export type DaycareContext = { teamAverage: number | null; caretakerMult: number }

export type DaycareState = {
  slotsUnlocked: number
  /** O marco que abre a próxima vaga (null = todas abertas). */
  nextSlotAt: UnlockAt | null
  slots: DaycareSlot[]
  /** Cuidador (5.21): acelera o daycare conforme a espécie. */
  caretaker: { pokemonId: number; speciesId: number; tier: string; tierName: string; mult: number } | null
  caretakerTiers: { key: string; name: string; mult: number; species: { id: number; name: string }[] }[]
  rules: DaycareRules
  context: DaycareContext
}

export type CaptureBerryInfo = {
  catchMult: number | null
  calm: number | 'all' | null
  candyOnCatch: number | null
  description: string
}

export type WeatherKey = 'sunny' | 'cloudy' | 'rain' | 'wind'

export type BerryInfo = {
  key: string
  name: string
  growMs: number
  /** Plantada neste clima, cresce mais rápido (GameState.weatherGrowFactor). */
  favoriteWeather: WeatherKey
  effectDescription: string
  effectKey: string | null
  /** false = só captura (ex.: Pinap). */
  bagUsable: boolean
  capture: CaptureBerryInfo | null
}

export type PlotState = {
  plotIndex: number
  berryKey: string
  plantedAt: number
  readyAt: number
  /** Colheitas feitas: 0 = ainda no primeiro crescimento (semente, muda, crescida). */
  harvests: number
  /** O arbusto secou: não frutifica mais, só se limpa (rende 0 a 2 sementes). */
  deadAt: number | null
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
  /** Clima de hoje (5.11): muda à meia-noite de Brasília (`until`). */
  weather: { key: WeatherKey; name: string; until: number }
  /** Plantar no clima favorito: tempo de crescimento × isto. */
  weatherGrowFactor: number
  berries: BerryInfo[]
  balls: BallsConfig
  uprootSeedReturnChance: number
  /** O primeiro crescimento leva este tanto de vezes o tempo da berry. */
  firstGrowthMult: number
  battle: BattleRules
  progression: ProgressionRules
  trainer: {
    level: number
    xp: number
    /** Curva do treinador (não é a dos Pokémon). */
    xpToNext: number
    /** false = energia desligada (config do servidor): encontro não gasta e a tela some com ela. */
    energyEnabled: boolean
    /** Tamanho máximo do time (todos vão para a luta). */
    teamMax: number
    energy: number
    energyMax: number
    energyNextAt: number | null
    energyFullAt: number | null
    genericCandies: number
    /** Preferência: luta com o jogador automático (8.5). */
    battleAuto: boolean
  }
  pokemon: OwnedPokemon[]
  candies: { evolutionChainId: number; amount: number }[]
  garden: {
    gifts: GardenGift[]
    needThreshold: number
    fullAt: number
    /** Abaixo disso o Pokémon não luta (fica fora do time da luta). */
    fightMinHunger: number
    /** Quanto uma berry enche a fome. */
    berryFill: number
    /** Visitantes dos habitats (5.22): um por habitat pronto; tocar abre o encontro. */
    visitors: GardenVisitor[]
    /** Descanso: do HP 0 ao cheio no jardim, em ms. */
    restFullMs: number
    /** Cada estrutura é uma peça (PROGRESSAO.md 4.3, passo 2): listas, com o id de cada uma. */
    trees: TreeView[]
    benches: BenchView[]
    /** Máquinas de cura do jardim (PROGRESSAO.md, item 4). */
    healMachines: HealMachineView[]
    layout: GardenLayout
  }
  missions: MissionsView
  daycare: DaycareState
  plots: PlotState[]
  inventory: InventoryRow[]
  effects: ActiveEffect[]
  encounter: PendingEncounter | null
  /** Blocos do álbum completos e ainda não resgatados (badge do HUD). */
  pokedex: { claimable: number }
}

export type ApiError = { error: string; min?: number; max?: number; pokemonId?: number; readyAt?: number }

/** Sem resposta nesse tempo, a requisição é cancelada e conta como sem conexão. */
export const REQUEST_TIMEOUT_MS = 15_000

/**
 * Toda chamada ao servidor passa por aqui. Falha de rede ou tempo estourado
 * lança (quem chama já trata com "Sem conexão com o servidor.") e acende o
 * aviso de sem conexão; 502–504 são o Caddy sem a API, e contam igual.
 */
export async function api(
  path: string,
  body?: unknown,
  method?: 'POST' | 'PATCH' | 'DELETE' | 'PUT',
): Promise<Response> {
  const verb = method ?? (body === undefined ? 'GET' : 'POST')
  const hasBody = body !== undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const done = busyFromLastPress()
  let response: Response
  try {
    response = await fetch(path, {
      method: verb,
      credentials: 'include',
      headers: hasBody ? { 'content-type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (error) {
    markOffline()
    throw error
  } finally {
    clearTimeout(timer)
    done()
  }
  if (response.status >= 502 && response.status <= 504) markOffline()
  else markOnline()
  return response
}

export function berryIconSrc(berryKey: string): string {
  return `/sprites/items/${berryKey}-berry.png`
}

export function ballIconSrc(spriteOrKey: string): string {
  return `/sprites/items/${spriteOrKey}-ball.png`
}

/** Ícone de um presente do jardim (5.21). */
export function giftIconSrc(itemKey: string): string {
  if (itemKey === 'generic_candy') return '/sprites/items/rare-candy.png'
  if (itemKey.startsWith('seed:')) return berryIconSrc(itemKey.slice(5))
  if (itemKey.startsWith('ball:')) return ballIconSrc(itemKey.slice(5))
  if (itemKey.startsWith('berry:')) return berryIconSrc(itemKey.slice(6))
  if (itemKey === 'mat:apricorn') return '/sprites/items/red-apricorn.png'
  if (itemKey === 'mat:apricorn-blue') return '/sprites/items/blue-apricorn.png'
  if (itemKey === 'mat:apricorn-yellow') return '/sprites/items/yellow-apricorn.png'
  if (itemKey === 'mat:wood') return '/sprites/items/wood.png'
  if (itemKey === 'mat:stone') return '/sprites/items/hard-stone.png'
  return '/sprites/items/poke-ball.png'
}

export function giftLabel(itemKey: string, quantity: number, berries: BerryInfo[], balls?: BallInfo[]): string {
  const name = itemKey === 'generic_candy' ? (quantity > 1 ? 'doces genéricos' : 'doce genérico') : itemLabel(itemKey, berries, balls)
  return `${quantity} ${name}`
}

export function itemLabel(itemKey: string, berries: BerryInfo[], balls?: BallInfo[]): string {
  if (itemKey.startsWith('seed:')) {
    const berry = berries.find((row) => row.key === itemKey.slice(5))
    return berry ? `Semente ${berry.name}` : itemKey
  }
  if (itemKey.startsWith('berry:')) {
    const berry = berries.find((row) => row.key === itemKey.slice(6))
    return berry ? `Berry ${berry.name}` : itemKey
  }
  if (itemKey.startsWith('ball:')) {
    const ball = balls?.find((row) => row.key === itemKey.slice(5))
    return ball?.displayName ?? itemKey
  }
  if (itemKey === 'mat:apricorn') return 'Apricorn'
  if (itemKey === 'mat:apricorn-blue') return 'Apricorn azul'
  if (itemKey === 'mat:apricorn-yellow') return 'Apricorn amarelo'
  if (itemKey === 'mat:wood') return 'Madeira'
  if (itemKey === 'mat:stone') return 'Pedra'
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
      return 'Escolha Chikorita, Cyndaquil ou Totodile.'
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
    case 'not_here':
      return 'Você não está mais nesse lugar. Abra a exploração de novo.'
    case 'place_locked':
      return 'Esse caminho ainda está fechado.'
    case 'place_not_linked':
      return 'Esse lugar fica longe daqui: vá pelos vizinhos.'
    case 'place_not_found':
      return 'Esse lugar não existe.'
    case 'no_field_here':
      return 'Aqui não tem mato para procurar.'
    case 'spawn_not_found':
      return 'Esse Pokémon já saiu do campo.'
    case 'no_better_move':
      return 'Ele já tem o golpe mais forte desse tipo.'
    case 'no_move_offer':
      return 'Essa oferta de golpe já passou.'
    case 'no_move_to_reroll':
      return 'Ainda não tem golpe carregado para sortear.'
    case 'field_not_empty':
      return 'Ainda tem Pokémon no campo.'
    case 'spot_not_found':
      return 'Não dá para fazer isso aqui.'
    case 'tool_locked':
      return 'Você ainda não tem a ferramenta para isso.'
    case 'milestone_not_here':
      return 'O marco é na cidade dele. Vá até lá.'
    case 'milestone_level':
      return 'Ainda falta nível de treinador para esse marco.'
    case 'leader_required':
      return 'Esse marco só vem vencendo o líder.'
    case 'milestone_cleared':
      return 'Esse marco já é seu.'
    case 'milestone_locked':
    case 'milestone_not_found':
      return 'Esse marco ainda não está aberto.'
    case 'region_not_found':
      return 'Essa região não existe.'
    case 'species_not_found':
      return 'Espécie não encontrada (use o nome em inglês ou o número).'
    case 'encounter_pending':
      return 'Termine o encontro atual antes.'
    case 'encounter_not_found':
      return 'Esse encontro não está mais valendo.'
    case 'battle_already_started':
      return 'A luta desse encontro já começou.'
    case 'battle_already_won':
      return 'Essa luta já acabou. É hora de capturar.'
    case 'battle_not_started':
      return 'A luta ainda não começou.'
    case 'battle_not_won':
      return 'Vença a luta antes de lançar a bola.'
    case 'finish_too_early':
      return 'Espere a luta terminar.'
    case 'invalid_team':
      return 'O time mudou. Abra o encontro de novo.'
    case 'team_full':
      return 'O time está cheio: toque numa vaga para trocar.'
    case 'invalid_slot':
      return 'Essa vaga do time não existe.'
    case 'last_in_team':
      return 'O time precisa de pelo menos um Pokémon.'
    case 'in_pc':
      return 'Ele está no PC. Traga para o jardim antes.'
    case 'pet_cooldown':
      return 'Ele acabou de ganhar carinho. Volte daqui a pouco.'
    case 'team_hungry':
      return 'Todo o time está com fome. Alimente antes de lutar.'
    case 'team_fainted':
      return 'Todo o time está desmaiado. Cure no jardim antes de lutar.'
    case 'no_charge':
      return 'A máquina de cura está sem cargas. Espere recarregar.'
    case 'team_healthy':
      return 'A equipe já está com o HP cheio.'
    case 'not_hungry':
      return 'Ele está de barriga cheia.'
    case 'no_berry':
      return 'Você não tem essa berry.'
    case 'gift_not_found':
      return 'Esse presente já foi pego.'
    case 'mission_not_found':
      return 'Essa missão não vale mais. As missões viram à meia-noite.'
    case 'mission_not_done':
      return 'Essa missão ainda não foi cumprida.'
    case 'already_claimed':
      return 'Isso já foi resgatado.'
    case 'chest_locked':
      return 'Resgate as 3 missões para abrir o baú.'
    case 'no_rerolls':
      return 'Você já trocou uma missão hoje.'
    case 'no_other_mission':
      return 'Não há outra missão para trocar agora.'
    case 'pokemon_not_found':
      return 'Esse Pokémon não está mais com você.'
    case 'in_daycare':
      return 'Ele está no daycare.'
    case 'last_in_garden':
      return 'Deixe pelo menos um Pokémon no jardim.'
    case 'slot_locked':
      return 'Essa vaga abre com um marco da jornada.'
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
      return 'Esse canteiro não está no jardim.'
    case 'not_placed':
      return 'Essa peça está guardada. Coloque no jardim pelo Construir.'
    case 'out_of_bounds':
      return 'Não cabe aí: passa da borda do jardim.'
    case 'occupied':
      return 'Essa casa já está ocupada.'
    case 'plot_limit':
      return 'Já tem o máximo de canteiros no jardim.'
    case 'plot_not_empty':
      return 'Colha ou limpe o canteiro antes de guardar.'
    case 'piece_locked':
      return 'Essa peça ainda não abriu.'
    case 'already_placed':
      return 'Essa peça já está no jardim.'
    case 'piece_not_found':
      return 'Essa peça não está mais no jardim.'
    case 'operating':
      return 'Esse Pokémon está trabalhando (bancada ou daycare). Tire-o de lá primeiro.'
    case 'not_caretaker':
      return 'Esse Pokémon não cuida do daycare.'
    case 'bench_locked':
      return 'A bancada ainda está fechada.'
    case 'in_team':
      return 'Quem está no time não pode operar a bancada.'
    case 'wrong_type':
      return 'Esse Pokémon não é de um tipo que opera a bancada.'
    case 'bench_upgrading':
      return 'A bancada está sendo melhorada. Espere terminar.'
    case 'invalid_recipe':
      return 'Essa receita não existe.'
    case 'recipe_locked':
      return 'Essa bola pede a bancada num nível maior.'
    case 'max_level':
      return 'A bancada já está no nível máximo.'
    case 'milestone_needed':
      return 'Essa melhoria abre com um marco da jornada.'
    case 'missing_items':
      return 'Faltam itens.'
    case 'build_recipe_locked':
      return 'Essa receita abre com um marco da jornada.'
    case 'piece_cap':
      return 'Já tem o máximo dessa peça. O teto sobe com os marcos.'
    case 'build_busy':
      return 'Já tem uma obra em andamento. Espere ficar pronta.'
    case 'bench_busy':
      return 'A bancada está trabalhando. Espere o lote acabar ou cancele.'
    case 'no_operator':
      return 'A bancada precisa de um operador.'
    case 'invalid_quantity':
      return 'Essa quantidade não cabe no lote.'
    case 'no_apricorn':
      return 'Faltam Apricorns.'
    case 'no_job':
      return 'A bancada não está trabalhando.'
    case 'tree_locked':
      return 'A árvore de Apricorn ainda está fechada.'
    case 'nothing_ready':
      return 'Ainda não há nada pronto.'
    case 'bush_dead':
      return 'O arbusto secou. Limpe o canteiro para plantar de novo.'
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
    case 'no_ball':
      return 'Você não tem essa pokébola.'
    case 'unknown_ball':
      return 'Essa pokébola não existe.'
    case 'berry_not_usable':
      return 'Essa berry não serve na captura.'
    case 'invalid_throw_quality':
      return 'Qualidade de arremesso inválida.'
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
    case 'block_not_found':
      return 'Esse bloco do álbum não existe.'
    case 'block_incomplete':
      return 'Ainda falta alguém nesse bloco.'
    case 'block_claimed':
      return 'Você já resgatou esse bloco.'
    default:
      return 'Algo deu errado.'
  }
}
