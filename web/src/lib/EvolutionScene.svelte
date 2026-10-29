<script lang="ts">
  import { onMount } from 'svelte'
  import { prefersReducedMotion } from './highlights'
  import { play, playCry, warmCries } from './sound'
  import { showdownSrc } from './sprites'

  /**
   * Cena de evolução, como nos jogos: "Hã?", "X está evoluindo!", o Pokémon
   * vira silhueta branca, flutua e pulsa, alterna com a evolução cada vez mais
   * rápido, clarão, e a forma nova aparece colorida.
   *
   * `run` faz o pedido ao servidor e corre junto com a animação; a forma nova
   * só aparece depois que ele respondeu. Se falhar, a cena para e nada muda.
   * Fica no document.body (como o Modal) para cobrir a tela toda.
   */
  let {
    fromSpeciesId,
    toSpeciesId,
    shiny,
    /** Apelido ou nome da espécie de antes. */
    name,
    toName,
    run,
    onDone,
  }: {
    fromSpeciesId: number
    toSpeciesId: number
    shiny: boolean
    name: string
    toName: string
    run: () => Promise<boolean>
    onDone: (evolved: boolean) => void
  } = $props()

  type Phase = 'intro' | 'evolving' | 'reveal' | 'failed'

  // Troca de silhueta como nos jogos: o tamanho segue |cos θ| (encolhe quase
  // até sumir e volta), e a forma à mostra troca exatamente no ponto mínimo,
  // então não se vê a troca. θ acelera de uma troca a cada SWAP_SLOW_MS até
  // uma a cada SWAP_FAST_MS ao longo de MORPH_MS.
  const SWAP_SLOW_MS = 1100
  const SWAP_FAST_MS = 70
  /** Menor tamanho na troca (fração do tamanho cheio). */
  const MORPH_MIN_SCALE = 0.12
  /** Tempo mínimo alternando antes do clarão (o servidor costuma responder bem antes). */
  const MORPH_MS = 4300
  const FLASH_MS = 520
  /** Escala dos GIFs (×2, pixel inteiro); só diminui se o maior não couber. */
  const SPRITE_SCALE = 2

  const reduced = prefersReducedMotion()

  let host = $state<HTMLDivElement | null>(null)
  let tapEl = $state<HTMLButtonElement | null>(null)
  let phase = $state<Phase>('intro')
  /** Silhueta da forma nova à mostra (na alternância). */
  let showNew = $state(false)
  /** Tamanho na troca de silhueta (1 = cheio). */
  let morphScale = $state(1)
  /** Tamanho natural de cada GIF: os dois na mesma escala, para a evolução sair maior se ela for maior. */
  let fromSize = $state<{ w: number; h: number } | null>(null)
  let toSize = $state<{ w: number; h: number } | null>(null)
  let viewW = $state(typeof window === 'undefined' ? 360 : window.innerWidth)
  const spriteScale = $derived.by(() => {
    const biggest = Math.max(fromSize?.w ?? 0, fromSize?.h ?? 0, toSize?.w ?? 0, toSize?.h ?? 0)
    if (biggest <= 0) return SPRITE_SCALE
    const room = Math.min(300, viewW * 0.75)
    return Math.min(SPRITE_SCALE, room / biggest)
  })
  let white = $state(false)
  let flash = $state(false)
  /** Pode tocar para seguir (o "▼" pisca). */
  let canTap = $state(false)
  let line = $state('Hã? O que está acontecendo?')

  let request: Promise<boolean> | null = null
  let timers: number[] = []
  let advance: (() => void) | null = null
  let gone = false

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => timers.push(window.setTimeout(resolve, ms)))
  }

  function waitTap(): Promise<void> {
    canTap = true
    return new Promise((resolve) => {
      advance = () => {
        advance = null
        canTap = false
        resolve()
      }
    })
  }

  function onTap() {
    if (!canTap) return
    play('tap')
    advance?.()
  }

  let morphRaf = 0

  /**
   * Alterna as silhuetas encolhendo e crescendo, acelerando, até o tempo
   * mínimo e a resposta do servidor. Termina no tamanho cheio: com a forma
   * nova se deu certo, com a antiga se falhou.
   */
  function morph(done: Promise<boolean>): Promise<boolean> {
    const answer: { ok: boolean | null } = { ok: null }
    void done.then((ok) => (answer.ok = ok))
    return new Promise((resolve) => {
      const slow = Math.PI / SWAP_SLOW_MS
      const fast = Math.PI / SWAP_FAST_MS
      let theta = 0
      let spent = 0
      let last = performance.now()
      /** θ onde parar (múltiplo de π: par = antiga cheia, ímpar = nova cheia). */
      let stopAt: number | null = null
      const frame = (now: number) => {
        if (gone) return
        const dt = Math.min(50, now - last)
        last = now
        spent += dt
        const ramp = Math.min(1, spent / MORPH_MS)
        theta += slow * (fast / slow) ** ramp * dt
        if (stopAt === null && answer.ok !== null && (spent >= MORPH_MS || answer.ok === false)) {
          // Próximo tamanho cheio da forma certa: nova (ímpar) ou antiga (par).
          let k = Math.ceil(theta / Math.PI)
          if (answer.ok ? k % 2 === 0 : k % 2 === 1) k += 1
          stopAt = k * Math.PI
        }
        if (stopAt !== null && theta >= stopAt) theta = stopAt
        morphScale = MORPH_MIN_SCALE + (1 - MORPH_MIN_SCALE) * Math.abs(Math.cos(theta))
        // Troca no ponto mínimo (cos = 0): metade ímpar dos meios-ciclos é a nova.
        showNew = Math.floor(theta / Math.PI + 0.5) % 2 === 1
        if (stopAt !== null && theta >= stopAt) {
          morphRaf = 0
          void done.then(resolve)
          return
        }
        morphRaf = requestAnimationFrame(frame)
      }
      morphRaf = requestAnimationFrame(frame)
    })
  }

  let fromImg = $state<HTMLImageElement | null>(null)
  let toImg = $state<HTMLImageElement | null>(null)

  function measure(event: Event | HTMLImageElement, which: 'from' | 'to') {
    const img = event instanceof HTMLImageElement ? event : (event.currentTarget as HTMLImageElement)
    if (!img.naturalWidth) return
    const size = { w: img.naturalWidth, h: img.naturalHeight }
    if (which === 'from') fromSize = size
    else toSize = size
  }

  async function play_() {
    playCry(fromSpeciesId)
    await waitTap()
    if (gone) return
    line = `${name} está evoluindo!`
    phase = 'evolving'
    request = run()
    let ok: boolean
    if (reduced) {
      ok = await request
    } else {
      await wait(450)
      white = true
      await wait(500)
      ok = await morph(request)
    }
    if (gone) return
    if (!ok) {
      showNew = false
      morphScale = 1
      white = false
      phase = 'failed'
      line = `Hã? ${name} parou de evoluir.`
      await waitTap()
      if (!gone) onDone(false)
      return
    }
    showNew = true
    morphScale = 1
    if (!reduced) {
      flash = true
      await wait(FLASH_MS / 2)
    }
    white = false
    phase = 'reveal'
    play('levelup')
    playCry(toSpeciesId)
    if (!reduced) {
      await wait(FLASH_MS / 2)
      flash = false
    }
    line = `Parabéns! Seu ${name} evoluiu para ${toName}!`
    await waitTap()
    if (!gone) onDone(true)
  }

  onMount(() => {
    const node = host
    if (node) document.body.appendChild(node)
    // Teclado: Enter/Espaço no botão de tela cheia seguem o texto.
    tapEl?.focus()
    // GIF que já veio do cache pode ter carregado antes do onload.
    if (fromImg?.complete) measure(fromImg, 'from')
    if (toImg?.complete) measure(toImg, 'to')
    const onResize = () => (viewW = window.innerWidth)
    window.addEventListener('resize', onResize)
    warmCries([fromSpeciesId, toSpeciesId])
    // A forma nova já baixada: na troca de silhueta ela aparece na hora.
    const next = new Image()
    next.src = showdownSrc(toSpeciesId, shiny)
    void play_()
    return () => {
      gone = true
      window.removeEventListener('resize', onResize)
      if (morphRaf) cancelAnimationFrame(morphRaf)
      for (const id of timers) window.clearTimeout(id)
      timers = []
      node?.remove()
    }
  })
</script>

<div
  bind:this={host}
  class="evo"
  class:reduced
  role="dialog"
  aria-modal="true"
  aria-label="Evolução"
>
  <!-- A tela toda é o "toque para seguir", como a caixa de texto dos jogos. -->
  <button bind:this={tapEl} type="button" class="tap" aria-label={canTap ? 'Continuar' : line} onclick={onTap}></button>

  <div class="stage" aria-hidden="true">
    {#if phase === 'evolving' && !reduced}
      <div class="rays"></div>
      <div class="sparks">
        {#each Array(12) as _, i (i)}
          <span style:--i={i}></span>
        {/each}
      </div>
    {/if}
    <div class="float" class:moving={phase === 'evolving' && !reduced}>
      <div class="pulse" style:transform="scale({morphScale})">
        <img
          class="mon"
          class:white
          class:hidden={showNew || !fromSize}
          src={showdownSrc(fromSpeciesId, shiny)}
          alt=""
          draggable="false"
          style:width={fromSize ? `${fromSize.w * spriteScale}px` : undefined}
          style:height={fromSize ? `${fromSize.h * spriteScale}px` : undefined}
          bind:this={fromImg}
          onload={(event) => measure(event, 'from')}
        />
        <img
          class="mon"
          class:white
          class:hidden={!showNew || !toSize}
          src={showdownSrc(toSpeciesId, shiny)}
          alt=""
          draggable="false"
          style:width={toSize ? `${toSize.w * spriteScale}px` : undefined}
          style:height={toSize ? `${toSize.h * spriteScale}px` : undefined}
          bind:this={toImg}
          onload={(event) => measure(event, 'to')}
        />
      </div>
    </div>
  </div>

  <div class="box panel" aria-live="polite">
    <p>{line}</p>
    {#if canTap}<span class="more" aria-hidden="true">▼</span>{/if}
  </div>

  {#if flash}<div class="flash" aria-hidden="true"></div>{/if}
</div>

<style>
  .evo {
    position: fixed;
    z-index: 90;
    inset: 0;
    display: grid;
    grid-template-rows: 1fr auto;
    background: radial-gradient(circle at 50% 42%, #2b3a55 0%, #121826 55%, #07090f 100%);
    color: var(--ink);
    outline: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .tap {
    position: absolute;
    z-index: 3;
    inset: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    touch-action: manipulation;
  }

  .stage {
    position: relative;
    display: grid;
    place-items: center;
    overflow: hidden;
  }

  /* Raios girando bem devagar atrás do Pokémon. */
  .rays {
    position: absolute;
    width: 140vmax;
    height: 140vmax;
    background: repeating-conic-gradient(from 0deg, #ffffff10 0deg 8deg, transparent 8deg 22deg);
    mask: radial-gradient(circle, #000 0%, transparent 60%);
    animation: spin 14s linear infinite;
  }

  /* Brilhos subindo em volta. */
  .sparks {
    position: absolute;
    width: 220px;
    height: 220px;
  }

  .sparks span {
    position: absolute;
    left: calc(8% + (var(--i) * 7.5%));
    bottom: 0;
    width: 4px;
    height: 4px;
    background: #fff;
    box-shadow: 0 0 6px 2px #bfe3ff;
    opacity: 0;
    animation: rise 1.6s linear infinite;
    animation-delay: calc(var(--i) * -0.27s);
  }

  .float.moving {
    animation: float 1.7s ease-in-out infinite;
  }

  /* Os dois GIFs no mesmo lugar, centrados: a troca acontece no tamanho
     mínimo, então o centro é o ponto que fica parado. */
  .pulse {
    position: relative;
    display: grid;
    place-items: center;
    min-width: 96px;
    min-height: 96px;
    will-change: transform;
  }

  .mon {
    grid-area: 1 / 1;
    image-rendering: pixelated;
    transition: filter 0.45s linear;
  }

  /* Silhueta branca com brilho, como nos jogos. */
  .mon.white {
    filter: brightness(0) invert(1) drop-shadow(0 0 10px #bfe3ff);
  }

  .mon.hidden {
    visibility: hidden;
  }

  .box {
    position: relative;
    z-index: 2;
    display: grid;
    min-height: 5.5rem;
    margin: 0 0.75rem calc(0.75rem + env(safe-area-inset-bottom));
    padding: 0.85rem 2rem 0.85rem 1rem;
    box-sizing: border-box;
    width: min(calc(100% - 1.5rem), 30rem);
    justify-self: center;
    align-content: center;
  }

  .box p {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1.35;
  }

  .more {
    position: absolute;
    right: 0.8rem;
    bottom: 0.55rem;
    font-size: 0.8rem;
    animation: blink 0.9s steps(2, jump-none) infinite;
  }

  .flash {
    position: fixed;
    z-index: 4;
    inset: 0;
    background: #fff;
    pointer-events: none;
    animation: flash 0.52s ease-out both;
  }

  @keyframes float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-14px);
    }
  }

  @keyframes rise {
    0% {
      transform: translateY(0);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    100% {
      transform: translateY(-200px);
      opacity: 0;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes blink {
    to {
      opacity: 0;
    }
  }

  @keyframes flash {
    0% {
      opacity: 0;
    }
    45% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  .reduced .mon {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .more {
      animation: none;
    }
  }
</style>
