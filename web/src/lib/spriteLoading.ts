// Poké Ball no lugar do sprite enquanto o <img> carrega (estilo em app.css).
// Uso: <img use:spriteLoading={src} {src} ... />. O parâmetro faz a action
// religar o aviso quando o src muda (ex.: evoluiu na ficha).
export function spriteLoading(img: HTMLImageElement, _src?: string) {
  const done = () => img.classList.remove('sprite-loading')
  const watch = () => {
    if (img.complete && img.naturalWidth > 0) return done()
    img.classList.add('sprite-loading')
  }
  img.addEventListener('load', done)
  img.addEventListener('error', done)
  watch()
  return {
    update() {
      // Depois do Svelte trocar o src: antes disso o complete ainda é do antigo.
      queueMicrotask(watch)
    },
    destroy() {
      img.removeEventListener('load', done)
      img.removeEventListener('error', done)
    },
  }
}
