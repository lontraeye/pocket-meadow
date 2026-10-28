/** Sinaliza luta ao vivo para o aviso de atualização do PWA. */
let live = false
const listeners = new Set<() => void>()

export function setLiveFight(on: boolean): void {
  if (live === on) return
  live = on
  for (const listener of listeners) listener()
}

export function isLiveFight(): boolean {
  return live
}

export function subscribeLiveFight(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
