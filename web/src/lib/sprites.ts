import { SvelteSet } from 'svelte/reactivity'
import manifest from './pmd-manifest.json' with { type: 'json' }

export type PmdAnimName = 'Walk' | 'Idle' | 'Sleep'

export type PmdAnim = {
  w: number
  h: number
  dirs: number
  durations: number[]
  // Ponto do chão no quadro: [x, y] fixo, ou [x, y] por quadro, direção a direção.
  ground: number[]
}

type PmdVariant = Record<PmdAnimName, PmdAnim>

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

/** Baixa e decodifica as três folhas. Resolve mesmo se alguma falhar. */
export function loadPmd(speciesId: number, shinySheet: boolean): Promise<void> {
  const sheets = (['Walk', 'Idle', 'Sleep'] as const).map((anim) => {
    const url = pmdSheetUrl(speciesId, shinySheet, anim)
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
  })
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
export function gardenExtent(look: GardenLook): { left: number; right: number; up: number; down: number } {
  if (look.kind === 'showdown') {
    return { left: showdownSize / 2, right: showdownSize / 2, up: showdownSize, down: 0 }
  }
  const out = { left: 0, right: 0, up: 0, down: 0 }
  for (const sheet of Object.values(look.anims)) {
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
