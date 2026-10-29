<script lang="ts">
  import {
    accumulateSpin,
    beginFlight,
    beginGuaranteedFlight,
    blendSpinRate,
    decaySpinRate,
    agitationOffset,
    isSimpleTap,
    isSpinning,
    qualityFromRing,
    releaseVelocity,
    ringColorFor,
    ringFracAt,
    shouldLaunch,
    spinTurns,
    stepFlight,
    throwUnit,
    throwSpeed,
    THROW_PHYSICS,
    type FlightState,
    type PointerSample,
    type SpinState,
    type TargetCircle,
    type ThrowOutcome,
    type ThrowQuality,
    type ThrowReading,
    type ThrowScene,
  } from './throwPhysics'
  import { prefersReducedMotion } from './highlights'
  import { play } from './sound'

  type AimMode = 'ball' | 'berry'

  let {
    mode,
    spriteSrc,
    label,
    disabled = false,
    busy = false,
    agitation = 0,
    /** Chance de captura (0..1) com bola+berry e qualidade normal — cor do anel. */
    catchChance = 0,
    /** Elemento do palco do selvagem (para mira e anel). */
    stageEl = null as HTMLElement | null,
    /** Treino (dev): mostra o resultado e não gasta nada nem chama o servidor. */
    practice = false,
    onBallHit,
    onBallMiss,
    onBerryHit,
    onBerryMiss,
    onSpinChange,
    onReading,
  }: {
    mode: AimMode
    spriteSrc: string
    label: string
    disabled?: boolean
    busy?: boolean
    agitation?: number
    catchChance?: number
    stageEl?: HTMLElement | null
    practice?: boolean
    onBallHit: (quality: ThrowQuality, curve: boolean) => void
    onBallMiss: () => void
    onBerryHit: () => void
    onBerryMiss: () => void
    onSpinChange?: (spinning: boolean) => void
    /** Leitura de cada arremesso (laboratório de dev). */
    onReading?: (reading: ThrowReading) => void
  } = $props()

  let btnEl = $state<HTMLButtonElement | null>(null)
  let holding = $state(false)
  let flying = $state(false)
  let spinning = $state(false)
  let holdX = $state(0)
  let holdY = $state(0)
  let holdAngle = $state(0)
  let flight = $state.raw<FlightState | null>(null)
  /** Bola congelada no alvo enquanto o texto Nice/Curva aparece. */
  let impactHold = $state<{
    x: number
    y: number
    scale: number
    spinAngle: number
    curve: boolean
  } | null>(null)
  let ringOn = $state(false)
  let ringFrac = $state(1)
  let ringTarget = $state.raw<TargetCircle | null>(null)
  let floatLabel = $state<{ text: string; good: boolean; id: number; x: number; y: number } | null>(null)
  let floatSeq = 0

  let samples: PointerSample[] = []
  let spin: SpinState = { lastAngle: null, accumulated: 0, direction: 0 }
  let pointerId: number | null = null
  let startT = 0
  let startX = 0
  let startY = 0
  let raf = 0
  let lastRaf = 0
  let ringRaf = 0
  let feedbackTimer = 0
  /** Velocidade de rotação da bola (rad/s, + = horário): tem inércia, ver spinLoop. */
  let spinRate = 0
  let spinRaf = 0
  let lastSpinT = 0
  let lastSpinAcc = 0
  /** Leitura do arremesso em voo (completa no resultado). */
  let pendingReading: ThrowReading | null = null

  const blocked = $derived(disabled || busy || flying || impactHold !== null)
  const ringColor = $derived(ringColorFor(catchChance))

  /** Berry não gira: ao trocar da bola, zera ângulo e inércia. */
  $effect(() => {
    if (mode !== 'berry') return
    stopSpin()
    if (spinning) onSpinChange?.(false)
    spinning = false
    spin = { lastAngle: null, accumulated: 0, direction: 0 }
  })

  /**
   * Gira a bola com inércia: o dedo dá velocidade (onPointerMove) e, parado,
   * ela desacelera devagar, até no botão se o arremesso foi desistido. A curva
   * só vale enquanto ela ainda gira de verdade.
   */
  function ensureSpinLoop() {
    if (spinRaf) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(40, now - last)
      last = now
      holdAngle += spinRate * (dt / 1000)
      spinRate = decaySpinRate(spinRate, dt)
      if (spinning && Math.abs(spinRate) < THROW_PHYSICS.spinCurveMinRad) {
        spinning = false
        spin = { ...spin, accumulated: 0, direction: 0 }
        onSpinChange?.(false)
      }
      if (spinRate === 0 && !holding) {
        spinRaf = 0
        return
      }
      spinRaf = requestAnimationFrame(tick)
    }
    spinRaf = requestAnimationFrame(tick)
  }

  function stopSpin() {
    spinRate = 0
    holdAngle = 0
    if (spinRaf) cancelAnimationFrame(spinRaf)
    spinRaf = 0
  }

  /** Texto do resultado em cima do alvo, no estilo do número de dano da luta. */
  function showFloat(text: string, good: boolean) {
    const id = (floatSeq += 1)
    const target = targetCircle()
    const x = target?.cx ?? window.innerWidth / 2
    const y = target ? target.cy - target.radius : window.innerHeight * 0.28
    floatLabel = { text, good, id, x, y }
    window.setTimeout(() => {
      if (floatLabel?.id === id) floatLabel = null
    }, 1100)
  }

  type StageBox = { midX: number; groundY: number; body: number }
  /**
   * Medida do palco guardada do toque até o fim do arremesso. Ler o
   * getBoundingClientRect a cada quadro força o navegador a refazer o layout
   * no meio da animação (engasgos no celular); o palco não se move nesse meio
   * tempo, e a agitação é calculada, não medida.
   */
  let boxCache: StageBox | null = null

  function measureStage() {
    boxCache = null
    boxCache = stageBox()
  }

  /** Medidas do palco: meio, chão (pés) e altura do corpo. */
  function stageBox(): StageBox | null {
    if (boxCache) return boxCache
    if (!stageEl) return null
    const r = stageEl.getBoundingClientRect()
    // O palco da captura tem a altura do sprite + 36 px (estrelas em cima e o
    // chão a 12 px da base, no Explore): o alvo é o meio do corpo, não o do palco.
    return { midX: r.left + r.width / 2, groundY: r.bottom - 12, body: Math.max(24, r.height - 36) }
  }

  function targetCircle(): TargetCircle | null {
    const box = stageBox()
    if (!box) return null
    const radius = Math.max(22, box.body * THROW_PHYSICS.hitRadiusFrac)
    const off = agitationOffset(agitation, performance.now())
    return { cx: box.midX + off.x, cy: box.groundY - box.body / 2 + off.y, radius }
  }

  function sceneFrom(x0: number, y0: number): ThrowScene | null {
    const box = stageBox()
    if (!box) return null
    return { x0, y0, vanishX: box.midX, groundY: box.groundY }
  }

  function startRing() {
    if (mode !== 'ball') return
    ringOn = true
    const tick = () => {
      ringFrac = ringFracAt(performance.now())
      ringTarget = targetCircle()
      ringRaf = requestAnimationFrame(tick)
    }
    ringRaf = requestAnimationFrame(tick)
  }

  function stopRing() {
    ringOn = false
    ringTarget = null
    if (ringRaf) cancelAnimationFrame(ringRaf)
    ringRaf = 0
  }

  function resetHold() {
    holding = false
    if (spinning) onSpinChange?.(false)
    spinning = false
    pointerId = null
    samples = []
    spin = { lastAngle: null, accumulated: 0, direction: 0 }
    stopRing()
  }

  function returnToHand() {
    resetHold()
    flight = null
    flying = false
    boxCache = null
  }

  function runFlight(next: FlightState) {
    // O voo leva a rotação daqui em diante (spinAngle/spinSpeed do FlightState).
    stopSpin()
    flying = true
    holding = false
    flight = next
    lastRaf = performance.now()
    const loop = (now: number) => {
      // Tempo real: com teto baixo, um quadro atrasado deixava a bola em câmera
      // lenta por um instante (engasgo). O stepFlight já divide em passos de 4 ms.
      const dt = Math.min(120, now - lastRaf)
      lastRaf = now
      const cur = flight
      if (!cur) return
      // Alvo vivo: o acerto é testado onde o Pokémon está quando a bola chega.
      const live = targetCircle()
      const stepped = live ? stepFlight(cur, dt, live) : { ...cur, done: true }
      flight = stepped
      if (!stepped.done) {
        raf = requestAnimationFrame(loop)
        return
      }
      finishFlight(stepped)
    }
    raf = requestAnimationFrame(loop)
  }

  function clearFeedbackTimer() {
    if (feedbackTimer) {
      window.clearTimeout(feedbackTimer)
      feedbackTimer = 0
    }
  }

  function report(outcome: ThrowOutcome | null, quality: ThrowQuality | null) {
    if (!pendingReading) return
    const reading: ThrowReading = {
      ...pendingReading,
      result: outcome === null ? 'over' : outcome.kind === 'hit' ? 'hit' : outcome.why,
      distRatio: outcome?.kind === 'hit' ? outcome.distRatio : null,
      quality,
    }
    pendingReading = null
    onReading?.(reading)
  }

  const MISS_TEXT = { short: 'Curto!', over: 'Passou!', wide: 'Errou!' } as const

  function finishFlight(state: FlightState) {
    stopRing()
    // O texto do resultado ainda usa a medida; a próxima leitura já mede de novo.
    queueMicrotask(() => {
      if (!holding && !flying) boxCache = null
    })
    const outcome = state.outcome
    const curve = mode === 'ball' && state.curveDir !== 0
    flying = false
    flight = null

    if (outcome?.kind !== 'hit') {
      report(outcome, null)
      play('tap')
      showFloat(outcome ? MISS_TEXT[outcome.why] : 'Errou!', false)
      if (practice) return
      if (mode === 'berry') {
        onBerryMiss()
        return
      }
      // Deixa o texto aparecer antes do debit (sem mudar de tela).
      clearFeedbackTimer()
      feedbackTimer = window.setTimeout(() => {
        feedbackTimer = 0
        onBallMiss()
      }, Math.min(500, THROW_PHYSICS.feedbackHoldMs))
      return
    }

    play('hit')
    if (mode === 'berry') {
      report(outcome, null)
      if (practice) showFloat('Acertou!', true)
      else onBerryHit()
      return
    }

    const quality: ThrowQuality = state.guaranteed
      ? 'normal'
      : qualityFromRing(outcome.distRatio, ringFracAt(performance.now()))
    report(outcome, quality)
    // Um texto só: dois seguidos fariam o segundo apagar o primeiro.
    const labels = [
      quality === 'nice' ? 'Nice!' : quality === 'great' ? 'Great!' : quality === 'excellent' ? 'Excellent!' : null,
      curve ? 'Curva!' : null,
    ].filter((text): text is string => text !== null)

    if (labels.length === 0 && !practice) {
      onBallHit(quality, curve)
      return
    }

    // Congela a bola no alvo e só então vai à cena — senão a tela some no mesmo frame.
    impactHold = { x: state.x, y: state.y, scale: state.scale, spinAngle: state.spinAngle, curve }
    showFloat(labels.length > 0 ? labels.join(' · ') : 'Acertou!', true)
    clearFeedbackTimer()
    feedbackTimer = window.setTimeout(() => {
      feedbackTimer = 0
      impactHold = null
      if (!practice) onBallHit(quality, curve)
    }, THROW_PHYSICS.feedbackHoldMs)
  }

  /** Teclado e movimento reduzido: força ideal no centro, sempre acerta. */
  function launchGuaranteed() {
    measureStage()
    const btn = btnEl?.getBoundingClientRect()
    const target = targetCircle()
    const scene = btn ? sceneFrom(btn.left + btn.width / 2, btn.top + btn.height / 2) : null
    play('tap')
    // Sem animação (ou sem onde mirar): acerta direto, sem voo.
    if (!scene || !target || prefersReducedMotion()) {
      if (practice) return
      if (mode === 'berry') onBerryHit()
      else onBallHit('normal', false)
      return
    }
    startRing()
    pendingReading = null
    runFlight(beginGuaranteedFlight({ scene, target }))
  }

  function onPointerDown(e: PointerEvent) {
    if (blocked || e.button !== 0) return
    e.preventDefault()
    if (prefersReducedMotion()) {
      launchGuaranteed()
      return
    }
    measureStage()
    pointerId = e.pointerId
    btnEl?.setPointerCapture(e.pointerId)
    startT = e.timeStamp
    startX = e.clientX
    startY = e.clientY
    holdX = e.clientX
    holdY = e.clientY
    samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }]
    spin = { lastAngle: null, accumulated: 0, direction: 0 }
    lastSpinT = e.timeStamp
    lastSpinAcc = 0
    holding = true
    spinning = false
    // A rotação que sobrou de antes continua (inércia); o laço segue com ela.
    if (mode === 'ball') {
      startRing()
      ensureSpinLoop()
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!holding || e.pointerId !== pointerId) return
    holdX = e.clientX
    holdY = e.clientY
    // No celular o navegador junta vários toques num evento só: os agrupados
    // dão a trajetória inteira, e a velocidade fica bem mais estável.
    const batch = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    for (const ev of batch.length > 0 ? batch : [e]) {
      samples.push({ t: ev.timeStamp, x: ev.clientX, y: ev.clientY })
      if (mode === 'ball') spin = accumulateSpin(spin, ev.clientX, ev.clientY)
    }
    if (samples.length > 64) samples = samples.slice(-64)
    if (mode === 'ball') {
      // Velocidade do giro do dedo desde o último movimento; a bola guarda a maior
      // e perde aos poucos (spinLoop), em vez de parar quando o dedo para.
      const dtS = (e.timeStamp - lastSpinT) / 1000
      if (dtS > 0.004) {
        spinRate = blendSpinRate(spinRate, (spin.accumulated - lastSpinAcc) / dtS)
        lastSpinT = e.timeStamp
        lastSpinAcc = spin.accumulated
      }
      const nextSpin = isSpinning(spin) && Math.abs(spinRate) >= THROW_PHYSICS.spinCurveMinRad
      if (nextSpin !== spinning) onSpinChange?.(nextSpin)
      spinning = nextSpin
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!holding || e.pointerId !== pointerId) return
    const drag = Math.hypot(e.clientX - startX, e.clientY - startY)
    const duration = e.timeStamp - startT
    samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
    const { vx, vy } = releaseVelocity(samples, e.timeStamp)
    const target = targetCircle()
    const scene = sceneFrom(e.clientX, e.clientY)
    const unit = scene && target ? throwUnit(scene, target) : 400
    const turns = spinTurns(spin)
    const curving = mode === 'ball' && spinning
    const reading: ThrowReading = {
      power: throwSpeed(vx, vy, unit) / THROW_PHYSICS.idealSpeed,
      angleDeg: vy < 0 ? (Math.atan2(vx, -vy) * 180) / Math.PI : 0,
      unitPx: Math.round(unit),
      curve: curving,
      turns,
      result: 'weak',
      distRatio: null,
      quality: null,
    }

    // Toque sem arrastar não lança: a bola fica na mão (teclado e movimento
    // reduzido continuam com o lançamento garantido).
    if (isSimpleTap(drag, duration)) {
      returnToHand()
      onReading?.({ ...reading, result: 'tap' })
      return
    }
    if (!scene || !target || !shouldLaunch(vy, unit)) {
      returnToHand()
      onReading?.(reading)
      return
    }

    const curveDir: -1 | 0 | 1 = curving ? (spin.direction === 0 ? 1 : spin.direction) : 0
    play('tap')
    const next = beginFlight({
      scene,
      target,
      vx,
      vy,
      curveDir,
      spinning: curving,
      turns,
      spinAngle: holdAngle,
      spinRate,
    })
    holding = false
    pointerId = null
    pendingReading = reading
    runFlight(next)
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerId !== pointerId) return
    returnToHand()
  }

  function onKeyDown(e: KeyboardEvent) {
    if (blocked) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    launchGuaranteed()
  }

  $effect(() => {
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (spinRaf) cancelAnimationFrame(spinRaf)
      clearFeedbackTimer()
      stopRing()
    }
  })
</script>

<button
  type="button"
  class="throw-btn"
  class:holding
  class:spinning
  class:flying
  bind:this={btnEl}
  aria-busy={busy || flying || impactHold !== null}
  aria-label={label}
  disabled={blocked}
  style:touch-action="none"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  onkeydown={onKeyDown}
>
  {#if !holding && !flying && !impactHold}
    <!-- Desistiu do arremesso com a bola girando: ela termina de girar aqui. -->
    <img
      src={spriteSrc}
      alt=""
      width="56"
      height="56"
      draggable="false"
      style:transform={holdAngle !== 0 ? `rotate(${holdAngle}rad)` : undefined}
    />
  {:else}
    <span class="ghost" aria-hidden="true"></span>
  {/if}
  <small>
    {#if busy || flying || impactHold}Lançando…{:else}{label}{/if}
  </small>
</button>

{#if holding}
  <img
    class="hold-ball"
    src={spriteSrc}
    alt=""
    width="60"
    height="60"
    draggable="false"
    style:transform="translate({holdX}px, {holdY}px) translate(-50%, -50%) rotate({holdAngle}rad) scale({spinning ? 1.08 : 1})"
  />
  {#if spinning}{@render sparkles(holdX, holdY, 1)}{/if}
{/if}

<!-- Bola acelerada e pronta para a curva: estrelinhas piscando em volta (não giram com ela). -->
{#snippet sparkles(x: number, y: number, scale: number)}
  <div class="sparkles" style:transform="translate({x}px, {y}px)" style:--s={scale} aria-hidden="true">
    {#each [0, 1, 2, 3, 4] as n (n)}
      <span class="spark" style:--i={n}>
        <svg viewBox="0 0 12 12" width="10" height="10"><path fill="#ffe66d" d="M6 0l1.5 4.2H12L8.2 6.8 9.7 11 6 8.4 2.3 11l1.5-4.2L0 4.2h4.5z" /></svg>
      </span>
    {/each}
  </div>
{/snippet}

{#if flying && flight}
  <!-- Sombra no chão, embaixo da bola: é ela que mostra a altura e onde vai cair. -->
  <span
    class="fly-shadow"
    style:transform="translate({flight.shadowX}px, {flight.shadowY}px) translate(-50%, -50%) scale({flight.scale})"
    style:opacity={Math.max(0.12, 0.45 - (flight.shadowY - flight.y) / 400)}
    aria-hidden="true"
  ></span>
  <!-- Depois de passar do Pokémon, some aos poucos (está atrás dele). -->
  <img
    class="fly-ball"
    src={spriteSrc}
    alt=""
    width="60"
    height="60"
    draggable="false"
    style:transform="translate({flight.x}px, {flight.y}px) translate(-50%, -50%) rotate({flight.spinAngle}rad) scale({flight.scale})"
    style:opacity={flight.depth <= 1
      ? 1
      : Math.max(0, 1 - (flight.depth - 1) / Math.max(0.1, THROW_PHYSICS.maxDepth - 1))}
  />
  {#if flight.curveDir !== 0}{@render sparkles(flight.x, flight.y, flight.scale)}{/if}
{:else if impactHold}
  <img
    class="fly-ball"
    src={spriteSrc}
    alt=""
    width="60"
    height="60"
    draggable="false"
    style:transform="translate({impactHold.x}px, {impactHold.y}px) translate(-50%, -50%) rotate({impactHold.spinAngle}rad) scale({impactHold.scale})"
  />
  {#if impactHold.curve}{@render sparkles(impactHold.x, impactHold.y, impactHold.scale)}{/if}
{/if}

{#if ringOn && ringTarget}
  {@const target = ringTarget}
  {#if target}
    <div
      class="aim-ring"
      style:transform="translate({target.cx}px, {target.cy}px) translate(-50%, -50%)"
      style:width="{target.radius * 2 * ringFrac}px"
      style:height="{target.radius * 2 * ringFrac}px"
      style:--ring={ringColor}
      aria-hidden="true"
    ></div>
  {/if}
{/if}

{#if floatLabel}
  {#key floatLabel.id}
    <p class="aim-float" class:bad={!floatLabel.good} style:left="{floatLabel.x}px" style:top="{floatLabel.y}px">
      {floatLabel.text}
    </p>
  {/key}
{/if}

<style>
  .throw-btn {
    box-sizing: border-box;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 0.1rem;
    /* Quadrado maior que Mochila/Bolas — destaque do lançar. */
    width: 6.25rem;
    min-width: 6.25rem;
    max-width: 6.25rem;
    height: 6.25rem;
    min-height: 6.25rem;
    max-height: 6.25rem;
    margin: 0;
    padding: 0.25rem 0.2rem;
    border: 2px solid var(--panel-edge);
    background: var(--panel-face);
    box-shadow:
      inset 0 -3px 0 var(--panel-shade),
      0 0 12px color-mix(in srgb, #e8c547 35%, transparent);
    color: var(--ink);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .throw-btn:disabled {
    filter: grayscale(1) opacity(0.6);
    cursor: not-allowed;
    box-shadow: inset 0 -3px 0 var(--panel-shade);
  }

  .throw-btn[aria-busy='true']:disabled {
    filter: none;
    cursor: progress;
  }

  .throw-btn img,
  .ghost {
    width: 56px;
    height: 56px;
    image-rendering: pixelated;
  }

  .throw-btn:not(:disabled) img {
    filter: drop-shadow(0 0 2px #ffe66d66);
  }

  @media (prefers-reduced-motion: no-preference) {
    .throw-btn:not(:disabled) img {
      animation: ball-glow 2.4s steps(8, jump-none) infinite alternate;
    }
  }

  @keyframes ball-glow {
    from {
      filter: drop-shadow(0 0 1px #ffe66d44);
    }
    to {
      filter: drop-shadow(0 0 5px #ffe66daa);
    }
  }

  .ghost {
    display: block;
    opacity: 0.25;
    background: radial-gradient(circle, var(--panel-edge) 40%, transparent 70%);
    border-radius: 50%;
  }

  .throw-btn small {
    overflow: hidden;
    max-width: 100%;
    font-size: 0.72rem;
    line-height: 1.15;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .throw-btn.spinning:not(:disabled) {
    box-shadow:
      inset 0 2px 0 var(--inlay-shade),
      0 0 16px color-mix(in srgb, #e8c547 70%, transparent);
  }

  /* Bola, sombra, estrelinhas e anel andam por transform a partir do canto
     (left/top fixos): mudar left/top a cada quadro refaz o layout e engasga. */
  .fly-shadow {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 39;
    will-change: transform, opacity;
    width: 40px;
    height: 12px;
    border-radius: 50%;
    background: #000;
    pointer-events: none;
  }

  .hold-ball,
  .fly-ball {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 40;
    pointer-events: none;
    image-rendering: pixelated;
    will-change: transform, opacity;
  }

  /* Estrelinhas da bola pronta para a curva: cinco em volta, piscando fora de
     tempo; no voo encolhem junto com a bola (--s). */
  .sparkles {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 41;
    will-change: transform;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .spark {
    position: absolute;
    left: -5px;
    top: -5px;
    display: block;
    width: 10px;
    height: 10px;
    transform: rotate(calc(var(--i) * 72deg)) translateY(calc(-38px * var(--s))) rotate(calc(var(--i) * -72deg));
    filter: drop-shadow(0 0 2px #ffe66daa);
  }

  .spark svg {
    display: block;
  }

  @media (prefers-reduced-motion: no-preference) {
    .spark svg {
      animation: spark-twinkle 0.6s steps(3, jump-none) infinite alternate;
      animation-delay: calc(var(--i) * -0.23s);
    }
  }

  @keyframes spark-twinkle {
    from {
      opacity: 0.25;
      transform: scale(0.5);
    }
    to {
      opacity: 1;
      transform: scale(1.15);
    }
  }

  .aim-ring {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 35;
    box-sizing: border-box;
    border: 3px solid var(--ring, #e8c547);
    border-radius: 50%;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 55%, transparent);
    pointer-events: none;
    opacity: 0.92;
  }

  .aim-float {
    position: fixed;
    z-index: 45;
    margin: 0;
    transform: translate(-50%, 0);
    color: #6ecf5a;
    font-weight: 700;
    font-size: 1.2rem;
    white-space: nowrap;
    text-shadow:
      0 var(--px) 0 var(--ink),
      0 calc(var(--px) * -1) 0 var(--ink),
      var(--px) 0 0 var(--ink),
      calc(var(--px) * -1) 0 0 var(--ink);
    pointer-events: none;
    animation: aim-float 1s ease-out both;
  }

  .aim-float.bad {
    color: #e05a4a;
  }

  @keyframes aim-float {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
    20% {
      opacity: 1;
    }
    to {
      opacity: 0;
      transform: translate(-50%, -28px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .aim-float {
      animation: none;
    }
  }
</style>
