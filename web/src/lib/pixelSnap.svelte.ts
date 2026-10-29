// Ícones em pixel (SVG com crispEdges) só ficam com todos os pixels do mesmo
// tamanho quando cada pixel do desenho cai num número inteiro de pixels da
// tela. Com a escala do Windows (125%, 150%) ou zoom do navegador, 24px de CSS
// viram 30 ou 36 pixels de tela, e um desenho 12×12 sai com pixels de 2 e de 3.
// Aqui o tamanho é escolhido em pixels de tela e convertido de volta para CSS.

const ratio = $state({ current: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1 })

if (typeof window !== 'undefined') {
  // Zoom do navegador muda o devicePixelRatio e dispara resize.
  window.addEventListener('resize', () => {
    const next = window.devicePixelRatio || 1
    if (next !== ratio.current) ratio.current = next
  })
}

/**
 * Tamanho em CSS mais próximo de `cssSize` em que um desenho de `grid`×`grid`
 * pixels fica com escala inteira na tela. Nunca abaixo de 1 pixel de tela por
 * pixel do desenho. Reativo: muda com o zoom.
 */
export function snapIconSize(cssSize: number, grid = 12): number {
  const dpr = ratio.current
  const perPixel = Math.max(1, Math.round((cssSize * dpr) / grid))
  return (perPixel * grid) / dpr
}

/**
 * Escala de sprite em pixel (PMD) com número inteiro de pixels da tela por
 * pixel do desenho. Ex.: escala 2 em 125% vira 2,4 (3 pixels de tela).
 */
export function snapPixelScale(scale: number): number {
  const dpr = ratio.current
  return Math.max(1, Math.round(scale * dpr)) / dpr
}

/** Posição em CSS alinhada a um pixel da tela (sem cair entre dois). */
export function snapToDevice(px: number): number {
  const dpr = ratio.current
  return Math.round(px * dpr) / dpr
}
