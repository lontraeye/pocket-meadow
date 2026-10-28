// "Carregando" no botão que disparou a ação (6.5), sem precisar marcar cada
// botão à mão: a api() chama busyFromLastPress() quando começa, e o botão
// tocado logo antes fica com aria-busy (cor normal e cursor de espera no
// app.css, enquanto os outros acinzentam). A marca sai quando o botão volta a
// ficar ativo, ou na hora se ele nem chegou a ser desativado.
// Botão que já controla o próprio aria-busy (ex.: Exploração) fica de fora.

/** Clique mais antigo que isso não é de quem fez a requisição (ex.: recarga por timer). */
const PRESS_WINDOW_MS = 600

let lastPress: { button: HTMLButtonElement; at: number } | null = null

if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (event) => {
      const button = (event.target as Element | null)?.closest?.('button.btn')
      if (button instanceof HTMLButtonElement) lastPress = { button, at: performance.now() }
    },
    true,
  )
}

/** Marca o botão tocado agora há pouco. Devolve o que chamar quando a requisição terminar. */
export function busyFromLastPress(): () => void {
  const press = lastPress
  if (!press || performance.now() - press.at > PRESS_WINDOW_MS) return () => undefined
  const { button } = press
  if (button.hasAttribute('aria-busy')) return () => undefined
  lastPress = null
  button.setAttribute('aria-busy', 'true')
  return () => {
    // O componente ainda pode estar recarregando o estado com o botão desativado:
    // espera ele voltar (ou sair da tela) antes de tirar a marca.
    queueMicrotask(() => {
      if (!button.isConnected || !button.disabled) {
        button.removeAttribute('aria-busy')
        return
      }
      const observer = new MutationObserver(() => {
        if (button.isConnected && button.disabled) return
        observer.disconnect()
        button.removeAttribute('aria-busy')
      })
      observer.observe(button, { attributes: true, attributeFilter: ['disabled'] })
    })
  }
}
