/** Registro do service worker e aviso de versão nova (só em produção). */
import { isLiveFight, subscribeLiveFight } from './liveFight'

export type UpdateHandle = {
  available: boolean
  apply: () => void
}

type Options = {
  onChange: (handle: UpdateHandle) => void
}

export function registerServiceWorker(options: Options): () => void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    options.onChange({ available: false, apply: () => undefined })
    return () => undefined
  }

  let waiting: ServiceWorker | null = null
  let pendingApply = false
  let pollTimer = 0

  const publish = () => {
    options.onChange({
      available: waiting !== null || pendingApply,
      apply: () => {
        if (isLiveFight()) {
          pendingApply = true
          publish()
          return
        }
        flushApply()
      },
    })
  }

  const flushApply = () => {
    pendingApply = false
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' })
    else window.location.reload()
  }

  const onControllerChange = () => {
    window.location.reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

  const unsubFight = subscribeLiveFight(() => {
    if (pendingApply && !isLiveFight()) flushApply()
  })

  void navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      if (registration.waiting) {
        waiting = registration.waiting
        publish()
      }

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        if (!worker) return
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = worker
            publish()
          }
        })
      })

      pollTimer = window.setInterval(() => {
        void registration.update()
      }, 60 * 60 * 1000)

      publish()
    })
    .catch(() => {
      options.onChange({ available: false, apply: () => undefined })
    })

  return () => {
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    unsubFight()
    if (pollTimer) window.clearInterval(pollTimer)
  }
}
