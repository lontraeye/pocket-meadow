// Toque "pixel perfect" no jardim: o quadro de um sprite PMD tem muita folga
// transparente, e o da frente roubava o toque de quem estava atrás. Aqui dá
// para saber se um ponto da tela cai num pixel visível de um `.sprite` do
// PmdSprite, lendo o alfa da folha (mesma origem, então o canvas pode ler).
//
// A máscara de cada folha (só o alfa, 1 byte por pixel) é montada sob demanda:
// warmSpriteMasks() no pointerdown, para estar pronta no click. Folha ainda sem
// máscara responde null, e quem chama segue com o comportamento antigo.

type Mask = { w: number; h: number; alpha: Uint8Array }

const masks = new Map<string, Mask | 'loading' | 'failed'>()

/** Folga em px de tela em volta do pixel tocado: dedo no celular não é preciso. */
const TOUCH_SLOP_PX = 3

function sheetUrl(el: HTMLElement): string | null {
  return el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] ?? null
}

function loadMask(url: string): void {
  if (masks.has(url)) return
  masks.set(url, 'loading')
  const image = new Image()
  image.src = url
  image
    .decode()
    .then(() => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('sem canvas')
      context.drawImage(image, 0, 0)
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
      const alpha = new Uint8Array(canvas.width * canvas.height)
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = rgba[i * 4 + 3] ?? 0
      masks.set(url, { w: canvas.width, h: canvas.height, alpha })
    })
    .catch(() => masks.set(url, 'failed'))
}

/** Sprites PMD sob o ponto, do mais à frente para o mais atrás. */
export function spritesAt(x: number, y: number): HTMLElement[] {
  return document
    .elementsFromPoint(x, y)
    .filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('sprite') && el.closest('.mon') !== null)
}

/** Começa a montar as máscaras das folhas sob o ponto (chamar no pointerdown). */
export function warmSpriteMasks(x: number, y: number): void {
  for (const el of spritesAt(x, y)) {
    const url = sheetUrl(el)
    if (url) loadMask(url)
  }
}

/**
 * true/false: o ponto (px de tela) cai ou não num pixel visível do sprite,
 * com a folga de TOUCH_SLOP_PX. null: máscara ainda não pronta.
 */
export function spriteOpaqueAt(el: HTMLElement, x: number, y: number): boolean | null {
  const url = sheetUrl(el)
  const mask = url ? masks.get(url) : undefined
  if (!mask || typeof mask === 'string') {
    if (url) loadMask(url)
    return null
  }
  if (getComputedStyle(el).visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  if (rect.width === 0) return false
  // background-size diz a escala da folha na tela; background-position, o quadro.
  const [sizeW = 0] = el.style.backgroundSize.split(' ').map(parseFloat)
  const [posX = 0, posY = 0] = el.style.backgroundPosition.split(' ').map(parseFloat)
  if (!sizeW) return null
  const k = mask.w / sizeW
  let localX = x - rect.left
  const localY = y - rect.top
  // Espelhado (sleepFlip), a caixa é a mesma mas o desenho está invertido.
  if (el.classList.contains('flip')) localX = rect.width - localX
  const slop = Math.ceil(TOUCH_SLOP_PX * k)
  const cx = Math.floor((localX - posX) * k)
  const cy = Math.floor((localY - posY) * k)
  // Não passa da borda do quadro: o vizinho na folha é outro quadro.
  const frameLeft = Math.floor(-posX * k)
  const frameTop = Math.floor(-posY * k)
  const frameRight = frameLeft + Math.round(rect.width * k) - 1
  const frameBottom = frameTop + Math.round(rect.height * k) - 1
  for (let sy = Math.max(frameTop, cy - slop); sy <= Math.min(frameBottom, cy + slop); sy += 1) {
    for (let sx = Math.max(frameLeft, cx - slop); sx <= Math.min(frameRight, cx + slop); sx += 1) {
      if ((mask.alpha[sy * mask.w + sx] ?? 0) > 0) return true
    }
  }
  return false
}
