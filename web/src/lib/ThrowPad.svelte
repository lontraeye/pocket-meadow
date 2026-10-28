<script lang="ts">
  import {
    accumulateSpin,
    blendSpinRate,
    decaySpinRate,
    agitationOffset,
    beginFlight,
    beginGuaranteedFlight,
    flightHitsTarget,
    hitTest,
    isSimpleTap,
    isSpinning,
    qualityFromRing,
    ringColorFor,
    ringFracAt,
    sampleVelocity,
    shouldLaunch,
    spinTurns,
    stepFlight,
    THROW_PHYSICS,
    type FlightState,
    type PointerSample,
    type SpinState,
    type ThrowQuality,
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
    onBallHit,
    onBallMiss,
    onBerryHit,
    onBerryMiss,
    onSpinChange,
  }: {
    mode: AimMode
    spriteSrc: string
    label: string
    disabled?: boolean
    busy?: boolean
    agitation?: number
    catchChance?: number
    stageEl?: HTMLElement | null
    onBallHit: (quality: ThrowQuality, curve: boolean) => void
    onBallMiss: () => void
    onBerryHit: () => void
    onBerryMiss: () => void
    onSpinChange?: (spinning: boolean) => void
  } = $props()

  let btnEl = $state<HTMLButtonElement | null>(null)
  let holding = $state(false)
  let flying = $state(false)
  let spinning = $state(false)
  let holdX = $state(0)
  let holdY = $state(0)
  let holdAngle = $state(0)
  let flight = $state<FlightState | null>(null)
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

  function targetCircle(): { cx: number; cy: number; radius: number } | null {
    if (!stageEl) return null
    const r = stageEl.getBoundingClientRect()
    // O palco da captura tem a altura do sprite + 36 px (estrelas em cima e o
    // chão a 12 px da base, no Explore): o alvo é o meio do corpo, não o do palco.
    const body = Math.max(24, r.height - 36)
    const radius = Math.max(22, body * THROW_PHYSICS.targetRadiusFrac * 1.5)
    const off = agitationOffset(agitation, performance.now())
    return { cx: r.left + r.width / 2 + off.x, cy: r.bottom - 12 - body / 2 + off.y, radius }
  }

  function startRing() {
    if (mode !== 'ball') return
    ringOn = true
    const tick = () => {
      ringFrac = ringFracAt(performance.now())
      ringRaf = requestAnimationFrame(tick)
    }
    ringRaf = requestAnimationFrame(tick)
  }

  function stopRing() {
    ringOn = false
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
    aimAtThrow = null
  }

  /** Mira congelada no arremesso — hit alinhado ao pouso (agitação não “rouba” acerto). */
  let aimAtThrow: { cx: number; cy: number; radius: number } | null = null

  function runFlight(next: FlightState, guaranteeHit: boolean, aim: { cx: number; cy: number; radius: number } | null = null) {
    // O voo leva a rotação daqui em diante (spinAngle/spinSpeed do FlightState).
    stopSpin()
    flying = true
    holding = false
    flight = next
    aimAtThrow = aim
    lastRaf = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(40, now - lastRaf)
      lastRaf = now
      const cur = flight
      if (!cur) return
      const stepped = stepFlight(cur, dt)
      flight = stepped
      // Contato no meio do voo = acerto (como no GO), sem esperar o pouso.
      if (!guaranteeHit) {
        const live = targetCircle()
        if (
          (aimAtThrow && hitTest(stepped.x, stepped.y, aimAtThrow)) ||
          (live && hitTest(stepped.x, stepped.y, live))
        ) {
          finishFlight(stepped, guaranteeHit)
          return
        }
      }
      if (!stepped.done) {
        raf = requestAnimationFrame(loop)
        return
      }
      finishFlight(stepped, guaranteeHit)
    }
    raf = requestAnimationFrame(loop)
  }

  function clearFeedbackTimer() {
    if (feedbackTimer) {
      window.clearTimeout(feedbackTimer)
      feedbackTimer = 0
    }
  }

  function finishFlight(state: FlightState, guaranteeHit: boolean) {
    stopRing()
    const live = targetCircle()
    const aim = aimAtThrow
    const target = aim ?? live
    const hit =
      guaranteeHit ||
      (aim ? flightHitsTarget(state, aim) || hitTest(state.x, state.y, aim) : false) ||
      (live ? flightHitsTarget(state, live) || hitTest(state.x, state.y, live) : false)
    const curve = mode === 'ball' && state.curveDir !== 0
    flying = false
    flight = null
    aimAtThrow = null

    if (mode === 'berry') {
      if (hit) {
        play('hit')
        onBerryHit()
      } else {
        play('tap')
        showFloat('Errou!', false)
        onBerryMiss()
      }
      return
    }

    if (!hit) {
      play('tap')
      showFloat('Errou!', false)
      // Deixa o "Errou!" aparecer antes do debit (sem mudar de tela).
      clearFeedbackTimer()
      feedbackTimer = window.setTimeout(() => {
        feedbackTimer = 0
        onBallMiss()
      }, Math.min(500, THROW_PHYSICS.feedbackHoldMs))
      return
    }

    play('hit')
    let quality: ThrowQuality = 'normal'
    if (!guaranteeHit && target) {
      const dist = Math.hypot(state.x - target.cx, state.y - target.cy)
      quality = qualityFromRing(dist, target.radius, ringFracAt(performance.now()))
    }
    // Um texto só: dois seguidos fariam o segundo apagar o primeiro.
    const labels = [
      quality === 'nice' ? 'Nice!' : quality === 'great' ? 'Great!' : quality === 'excellent' ? 'Excellent!' : null,
      curve ? 'Curva!' : null,
    ].filter((text): text is string => text !== null)

    if (labels.length === 0) {
      onBallHit(quality, curve)
      return
    }

    // Congela a bola no alvo e só então vai à cena — senão a tela some no mesmo frame.
    impactHold = {
      x: state.x,
      y: state.y,
      scale: state.scale,
      spinAngle: state.spinAngle,
      curve,
    }
    showFloat(labels.join(' · '), true)
    clearFeedbackTimer()
    feedbackTimer = window.setTimeout(() => {
      feedbackTimer = 0
      impactHold = null
      onBallHit(quality, curve)
    }, THROW_PHYSICS.feedbackHoldMs)
  }

  function launchGuaranteed() {
    const btn = btnEl?.getBoundingClientRect()
    const target = targetCircle()
    // Sem animação (ou sem onde mirar): acerta direto, sem voo.
    if (!btn || !target || prefersReducedMotion()) {
      play('tap')
      if (mode === 'berry') onBerryHit()
      else onBallHit('normal', false)
      return
    }
    play('tap')
    startRing()
    const x0 = btn.left + btn.width / 2
    const y0 = btn.top + btn.height / 2
    runFlight(beginGuaranteedFlight({ x0, y0, targetX: target.cx, targetY: target.cy }), true, target)
  }

  function onPointerDown(e: PointerEvent) {
    if (blocked || e.button !== 0) return
    if (prefersReducedMotion()) {
      e.preventDefault()
      launchGuaranteed()
      return
    }
    e.preventDefault()
    const btn = btnEl?.getBoundingClientRect()
    if (!btn) return
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
    samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
    if (samples.length > 24) samples = samples.slice(-24)
    if (mode === 'ball') {
      spin = accumulateSpin(spin, e.clientX, e.clientY)
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
    const { vx, vy } = sampleVelocity(samples, e.timeStamp)

    if (isSimpleTap(drag, duration) || prefersReducedMotion()) {
      resetHold()
      launchGuaranteed()
      return
    }

    if (!shouldLaunch(vy)) {
      returnToHand()
      return
    }

    const curveDir: -1 | 0 | 1 =
      mode === 'ball' && spinning ? (spin.direction === 0 ? 1 : spin.direction) : 0
    play('tap')
    const target = targetCircle()
    const next = beginFlight({
      x0: e.clientX,
      y0: e.clientY,
      vx,
      vy,
      curveDir,
      spinning: mode === 'ball' && spinning,
      turns: spinTurns(spin),
      targetX: target?.cx ?? e.clientX,
      targetY: target?.cy ?? e.clientY - 300,
      targetRadius: target?.radius,
      spinAngle: holdAngle,
      spinRate,
    })
    holding = false
    pointerId = null
    runFlight(next, false, target)
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
      width="60"
      height="60"
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
    style:left="{holdX}px"
    style:top="{holdY}px"
    style:transform="translate(-50%, -50%) rotate({holdAngle}rad) scale({spinning ? 1.08 : 1})"
  />
  {#if spinning}{@render sparkles(holdX, holdY, 1)}{/if}
{/if}

<!-- Bola acelerada e pronta para a curva: estrelinhas piscando em volta (não giram com ela). -->
{#snippet sparkles(x: number, y: number, scale: number)}
  <div class="sparkles" style:left="{x}px" style:top="{y}px" style:--s={scale} aria-hidden="true">
    {#each [0, 1, 2, 3, 4] as n (n)}
      <span class="spark" style:--i={n}>
        <svg viewBox="0 0 12 12" width="10" height="10"><path fill="#ffe66d" d="M6 0l1.5 4.2H12L8.2 6.8 9.7 11 6 8.4 2.3 11l1.5-4.2L0 4.2h4.5z" /></svg>
      </span>
    {/each}
  </div>
{/snippet}

{#if flying && flight}
  <img
    class="fly-ball"
    src={spriteSrc}
    alt=""
    width="60"
    height="60"
    draggable="false"
    style:left="{flight.x}px"
    style:top="{flight.y}px"
    style:transform="translate(-50%, -50%) rotate({flight.spinAngle}rad) scale({flight.scale})"
    style:opacity={0.55 + 0.45 * (1 - flight.depth)}
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
    style:left="{impactHold.x}px"
    style:top="{impactHold.y}px"
    style:transform="translate(-50%, -50%) rotate({impactHold.spinAngle}rad) scale({impactHold.scale})"
  />
  {#if impactHold.curve}{@render sparkles(impactHold.x, impactHold.y, impactHold.scale)}{/if}
{/if}

{#if ringOn && stageEl}
  {@const target = targetCircle()}
  {#if target}
    <div
      class="aim-ring"
      style:left="{target.cx}px"
      style:top="{target.cy}px"
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
    /* Largura/altura fixas: berry ↔ bola ↔ “Lançando…” não mexem o dock. */
    width: 7.25rem;
    min-width: 7.25rem;
    max-width: 7.25rem;
    height: 5.75rem;
    min-height: 5.75rem;
    margin: 0;
    padding: 0.2rem 0.35rem 0.3rem;
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
    width: 60px;
    height: 60px;
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

  .hold-ball,
  .fly-ball {
    position: fixed;
    z-index: 40;
    pointer-events: none;
    image-rendering: pixelated;
    will-change: transform, opacity;
  }

  /* Estrelinhas da bola pronta para a curva: cinco em volta, piscando fora de
     tempo; no voo encolhem junto com a bola (--s). */
  .sparkles {
    position: fixed;
    z-index: 41;
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
    z-index: 35;
    box-sizing: border-box;
    border: 3px solid var(--ring, #e8c547);
    border-radius: 50%;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 55%, transparent);
    transform: translate(-50%, -50%);
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
