import { SvelteSet } from 'svelte/reactivity'
import manifest from './pmd-manifest.json' with { type: 'json' }

export type PmdAnimName = 'Walk' | 'Idle' | 'Sleep' | 'Attack' | 'Hurt' | 'Charge' | 'Shoot' | 'Faint'

const gardenAnims = ['Walk', 'Idle', 'Sleep'] as const
const battleAnims = ['Attack', 'Hurt', 'Charge', 'Shoot', 'Faint'] as const

export type PmdAnim = {
  w: number
  h: number
  dirs: number
  durations: number[]
  // Ponto do chão no quadro: [x, y] fixo, ou [x, y] por quadro, direção a direção.
  ground: number[]
  // Só no Sleep: [x, y] do alto da cabeça no 1º quadro (onde nasce o Zzz).
  head?: number[]
}

type GardenAnimName = (typeof gardenAnims)[number]
type BattleAnimName = (typeof battleAnims)[number]
type PmdVariant = Record<GardenAnimName, PmdAnim> & Partial<Record<BattleAnimName, PmdAnim>>

type PmdEntry = {
  shadow: 0 | 1 | 2
  normal: PmdVariant
  shiny: PmdVariant | null
}

const species = manifest.species as Record<string, PmdEntry>

export type GardenLook =
  | { kind: 'pmd'; shadow: 0 | 1 | 2; shinySheet: boolean; sparkle: boolean; anims: PmdVariant }
  | { kind: 'showdown'; src: string }

export function showdownSrc(speciesId: number, isShiny: boolean): string {
  return `/sprites/showdown/${isShiny ? 'shiny/' : ''}${speciesId}.gif`
}

export function gardenSprite(speciesId: number, isShiny: boolean): GardenLook {
  const entry = species[String(speciesId)]
  if (!entry) return { kind: 'showdown', src: showdownSrc(speciesId, isShiny) }
  if (isShiny && entry.shiny) {
    return { kind: 'pmd', shadow: entry.shadow, shinySheet: true, sparkle: false, anims: entry.shiny }
  }
  return { kind: 'pmd', shadow: entry.shadow, shinySheet: false, sparkle: isShiny, anims: entry.normal }
}

export function pmdSheetUrl(speciesId: number, shinySheet: boolean, anim: PmdAnimName): string {
  return `/sprites/pmd/${speciesId}${shinySheet ? '/shiny' : ''}/${anim}.png`
}

// Mantém as folhas decodificadas na memória. Sem isso, a primeira troca para
// uma animação (ex.: o primeiro Sleep) mostra o sprite vazio até o PNG chegar.
const preloaded = new Map<string, { image: HTMLImageElement; ready: Promise<void> }>()
// Folhas já decodificadas. Reativo: o PmdSprite mostra a Poké Ball até a dele entrar.
const decoded = new SvelteSet<string>()

function decodeSheet(url: string): Promise<void> {
  const known = preloaded.get(url)
  if (known) return known.ready
  const image = new Image()
  image.src = url
  const ready = image.decode().then(
    () => {
      decoded.add(url)
    },
    () => {
      // Falhou (rede caiu?): esquece, para a próxima chamada tentar de novo.
      preloaded.delete(url)
    },
  )
  // Guarda a imagem: sem referência, o navegador pode descartar a decodificação.
  preloaded.set(url, { image, ready })
  return ready
}

/** Baixa e decodifica as três folhas do jardim. Resolve mesmo se alguma falhar. */
export function loadPmd(speciesId: number, shinySheet: boolean): Promise<void> {
  return Promise.all(gardenAnims.map((anim) => decodeSheet(pmdSheetUrl(speciesId, shinySheet, anim)))).then(
    () => undefined,
  )
}

/** Folhas de batalha que existirem no manifesto (Attack, Hurt, Charge, Shoot, Faint). */
export function loadPmdBattle(speciesId: number, shinySheet: boolean): Promise<void> {
  const entry = species[String(speciesId)]
  const variant = shinySheet ? entry?.shiny : entry?.normal
  if (!variant) return Promise.resolve()
  const sheets = battleAnims
    .filter((anim) => variant[anim])
    .map((anim) => decodeSheet(pmdSheetUrl(speciesId, shinySheet, anim)))
  return Promise.all(sheets).then(() => undefined)
}

export function preloadPmd(speciesId: number, shinySheet: boolean): void {
  void loadPmd(speciesId, shinySheet)
}

export function pmdSheetReady(url: string): boolean {
  return decoded.has(url)
}

export function pmdAnim(speciesId: number, shinySheet: boolean, anim: PmdAnimName): PmdAnim | null {
  const entry = species[String(speciesId)]
  if (!entry) return null
  const variant = shinySheet ? entry.shiny : entry.normal
  return variant?.[anim] ?? null
}

export function pmdHasAnim(speciesId: number, shinySheet: boolean, anim: PmdAnimName): boolean {
  return pmdAnim(speciesId, shinySheet, anim) !== null
}

/**
 * Escolhe a folha PMD (ou o fallback em CSS) para um evento da batalha.
 * `anim` é a preferida; a UI confirma com `pmdHasAnim` e, se faltar, usa `cssFallback`.
 *
 * Golpe carregado: devolve Charge como primária. A UI toca Charge e em seguida
 * Attack ou Shoot (mesmo critério do golpe rápido: especial com Shoot → Shoot,
 * senão Attack), com `lunge` se a folha seguinte também faltar.
 */
export function battleAnimChoice(input: {
  kind: 'fast' | 'charged' | 'hurt' | 'faint'
  damageClass?: 'physical' | 'special'
  hasShoot?: boolean
}): { anim: PmdAnimName | null; cssFallback: 'lunge' | 'hurt' | 'faint' | null } {
  if (input.kind === 'hurt') return { anim: 'Hurt', cssFallback: 'hurt' }
  if (input.kind === 'faint') return { anim: 'Faint', cssFallback: 'faint' }
  if (input.kind === 'charged') return { anim: 'Charge', cssFallback: 'lunge' }
  const anim = input.damageClass === 'special' && input.hasShoot ? 'Shoot' : 'Attack'
  return { anim, cssFallback: 'lunge' }
}

const showdownSize = 64

export function groundAt(sheet: PmdAnim, dir: number, frame: number): { x: number; y: number } {
  const ground = sheet.ground
  if (ground.length === 2) return { x: ground[0] ?? 0, y: ground[1] ?? 0 }
  const row = sheet.dirs <= 1 ? 0 : Math.min(dir, sheet.dirs - 1)
  const at = (row * sheet.durations.length + frame) * 2
  return { x: ground[at] ?? 0, y: ground[at + 1] ?? 0 }
}

// Quanto o sprite passa do ponto do chão para cada lado, em px de tela na
// escala 1 do jardim (PMD é desenhado em 2×). Considera todas as animações,
// direções e quadros, para a margem do jardim não mudar quando a animação troca.
/** Corpo visível de um sprite, em px na escala 1, a partir do ponto do chão (y negativo = para cima). */
export type SpriteBody = { centerX: number; centerY: number; top: number }

const bodyCache = new Map<string, Promise<SpriteBody | null>>()

/**
 * Mede o corpo de verdade no 1º quadro do Idle naquela direção (pixels não
 * transparentes), para os efeitos da luta caírem no meio do Pokémon e não
 * numa altura fixa: o quadro da folha tem folga em volta e cada espécie tem
 * um tamanho.
 */
export function pmdBody(speciesId: number, shinySheet: boolean, dir: number): Promise<SpriteBody | null> {
  const sheet = pmdAnim(speciesId, shinySheet, 'Idle')
  if (!sheet) return Promise.resolve(null)
  const row = sheet.dirs <= 1 ? 0 : Math.min(dir, sheet.dirs - 1)
  const key = `${speciesId}:${shinySheet ? 1 : 0}:${row}`
  const known = bodyCache.get(key)
  if (known) return known
  const measured = new Promise<SpriteBody | null>((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = sheet.w
        canvas.height = sheet.h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(image, 0, row * sheet.h, sheet.w, sheet.h, 0, 0, sheet.w, sheet.h)
        const { data } = ctx.getImageData(0, 0, sheet.w, sheet.h)
        let minX = sheet.w
        let minY = sheet.h
        let maxX = -1
        let maxY = -1
        for (let y = 0; y < sheet.h; y += 1) {
          for (let x = 0; x < sheet.w; x += 1) {
            if ((data[(y * sheet.w + x) * 4 + 3] ?? 0) < 16) continue
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
        if (maxX < 0) return resolve(null)
        const ground = groundAt(sheet, row, 0)
        resolve({
          centerX: (minX + maxX + 1) / 2 - ground.x,
          centerY: (minY + maxY + 1) / 2 - ground.y,
          top: minY - ground.y,
        })
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = pmdSheetUrl(speciesId, shinySheet, 'Idle')
  })
  bodyCache.set(key, measured)
  return measured
}

export function gardenExtent(look: GardenLook): { left: number; right: number; up: number; down: number } {
  if (look.kind === 'showdown') {
    return { left: showdownSize / 2, right: showdownSize / 2, up: showdownSize, down: 0 }
  }
  const out = { left: 0, right: 0, up: 0, down: 0 }
  for (const name of gardenAnims) {
    const sheet = look.anims[name]
    for (let dir = 0; dir < sheet.dirs; dir += 1) {
      for (let frame = 0; frame < sheet.durations.length; frame += 1) {
        const ground = groundAt(sheet, dir, frame)
        out.left = Math.max(out.left, ground.x * 2)
        out.right = Math.max(out.right, (sheet.w - ground.x) * 2)
        out.up = Math.max(out.up, ground.y * 2)
        out.down = Math.max(out.down, (sheet.h - ground.y) * 2)
      }
    }
  }
  return out
}

export function frameIndex(durations: number[], time: number): number {
  const spans = durations.map((duration) => (duration * 1000) / 60)
  const total = spans.reduce((sum, duration) => sum + duration, 0)
  if (total <= 0) return 0
  let cursor = time % total
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index] ?? 0
    if (cursor < span) return index
    cursor -= span
  }
  return 0
}
