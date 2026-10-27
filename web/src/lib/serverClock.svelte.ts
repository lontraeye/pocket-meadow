// Relógio do servidor no cliente: o `now` do /state mais o tempo que passou
// desde que ele chegou. Não usa o relógio do celular, que pode estar errado.
// Chamar na inicialização do componente (usa $effect).
export function serverClock(getServerNow: () => number): { now: () => number } {
  let tick = $state(Date.now())
  let receivedAt = $state(Date.now())

  $effect.pre(() => {
    void getServerNow()
    receivedAt = Date.now()
  })

  $effect(() => {
    const timer = window.setInterval(() => {
      tick = Date.now()
    }, 1000)
    return () => window.clearInterval(timer)
  })

  return { now: () => getServerNow() + Math.max(0, tick - receivedAt) }
}
