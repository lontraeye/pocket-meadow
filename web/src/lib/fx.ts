import manifest from './fxManifest.json' with { type: 'json' }

/** Constantes dos efeitos da luta (só front). */
export const FX_FRAME_MS = manifest.frameMs
export const FX_FRAME_SIZE = manifest.frameSize
export const FX_COLUMNS = manifest.columns
export const FX_MAX_ON_SCREEN = 6
export const FX_STATUS_PULSE_MS = 1000
export const FX_LOOP_HIT_FRAMES = 16
export const FX_SCALE_FAST = 1
// 1×: em 2× (192 px) o efeito não cabia na arena e era empurrado para longe
// do alvo. O carregado se destaca pelo Focus Charge, a faixa e a tremida.
export const FX_SCALE_CHARGED = 1
export const FX_SCALE_STATUS = 1
export const FX_FLYING_RATE = 2

export type FxId = keyof typeof manifest.effects

export type FxMeta = {
  frames: number
  loop: boolean
  pivot: readonly number[]
  contact: number | null
  peak: number | null
}

const effects = manifest.effects as Record<string, FxMeta>

const TYPE_FX: Record<string, FxId> = {
  normal: 'crescent-slash',
  fire: 'warm-explosion',
  water: 'splash-crown',
  electric: 'electric-impact',
  grass: 'leaf-gust',
  ice: 'frost-nova',
  fighting: 'solar-shrapnel',
  poison: 'acid-splash',
  ground: 'earth-rupture',
  flying: 'crescent-slash',
  psychic: 'resonant-break',
  bug: 'leaf-gust',
  rock: 'mercury-molt',
  ghost: 'void-implosion',
  dragon: 'spectral-bloom',
  dark: 'smoke-puff',
  steel: 'ferrospine',
  fairy: 'prism-loom',
}

const ALL_TYPES = [
  'normal',
  'fire',
  'water',
  'electric',
  'grass',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy',
] as const

/** Folhas usadas na luta (tipos + status + utilitários). */
export const BATTLE_FX_IDS: readonly FxId[] = [
  ...new Set<FxId>([
    ...Object.values(TYPE_FX),
    'focus-charge',
    'radiant-heal',
    'venom-ward',
    'choir-moths',
    'ember-jet',
    'electric-impact',
    'frost-nova',
  ]),
]

export function fxUrl(id: string): string {
  return `/fx/${id}.png`
}

export function fxMeta(id: string): FxMeta | null {
  return effects[id] ?? null
}

/**
 * Efeito visual do golpe por tipo (um lugar só, como `gardenSprite`).
 * `damageClass` e `kind` ficam na assinatura para o mapa poder evoluir;
 * hoje o id depende só do tipo (escala/ritmo ficam na UI).
 */
export function fxForMove(
  type: string,
  _damageClass: 'physical' | 'special',
  _kind: 'fast' | 'charged',
): FxId {
  return TYPE_FX[type] ?? 'crescent-slash'
}

/** prism-loom / ferrospine: no acerto só os primeiros quadros. */
export function fxHitFrameCap(id: FxId): number | null {
  if (id === 'prism-loom' || id === 'ferrospine') return FX_LOOP_HIT_FRAMES
  return null
}

export function fxContactMs(id: string): number {
  const meta = fxMeta(id)
  if (!meta || meta.contact === null) return 0
  return meta.contact * FX_FRAME_MS
}

const preloaded = new Map<string, { image: HTMLImageElement; ready: Promise<void> }>()
const decoded = new Set<string>()

function decodeFx(url: string): Promise<void> {
  const known = preloaded.get(url)
  if (known) return known.ready
  // onload em vez de image.decode(): o decode às vezes rejeita (Firefox,
  // aba em segundo plano) e aí a folha nunca contava como pronta.
  const image = new Image()
  const ready = new Promise<void>((resolve) => {
    image.onload = () => {
      decoded.add(url)
      resolve()
    }
    image.onerror = () => {
      preloaded.delete(url)
      resolve()
    }
  })
  image.src = url
  preloaded.set(url, { image, ready })
  return ready
}

export function fxSheetReady(id: string): boolean {
  return decoded.has(fxUrl(id))
}

/** Espera a folha ficar pronta (baixa se ainda não foi pedida). */
export function fxSheetLoad(id: string): Promise<void> {
  return decodeFx(fxUrl(id))
}

/** Baixa as folhas da luta. Só chamar ao abrir a luta — nunca no jardim. */
export function loadBattleFx(): Promise<void> {
  assertFxCoverage()
  return Promise.all(BATTLE_FX_IDS.map((id) => decodeFx(fxUrl(id)))).then(
    () => undefined,
    () => undefined,
  )
}

/** Garante os 18 tipos e que todo id existe no manifesto. */
export function assertFxCoverage(): void {
  for (const type of ALL_TYPES) {
    const id = fxForMove(type, 'physical', 'fast')
    if (!effects[id]) {
      throw new Error(`fx: tipo ${type} aponta para ${id}, ausente no fxManifest`)
    }
  }
  for (const id of BATTLE_FX_IDS) {
    if (!effects[id]) {
      throw new Error(`fx: id de batalha ${id} ausente no fxManifest`)
    }
  }
}

assertFxCoverage()
