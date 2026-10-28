<script lang="ts">
  import {
    accumulateSpin,
    agitationOffset,
    beginFlight,
    beginGuaranteedFlight,
    hitTest,
    isSimpleTap,
    isSpinning,
    qualityFromRing,
    ringFracAt,
    sampleVelocity,
    shouldLaunch,
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
  let ringOn = $state(false)
  let ringFrac = $state(1)
  let floatLabel = $state<{ text: string; good: boolean; id: number } | null>(null)
  let floatSeq = 0

  let samples: PointerSample[] = []
  let spin: SpinState = { lastAngle: null, accumulated: 0, direction: 0 }
  let pointerId: number | null = null
  let startT = 0
  let startX = 0
  let startY = 0
  let centerX = 0
  let centerY = 0
  let raf = 0
  let lastRaf = 0
  let ringRaf = 0

  const blocked = $derived(disabled || busy || flying)

  function showFloat(text: string, good: boolean) {
    const id = (floatSeq += 1)
    floatLabel = { text, good, id }
    window.setTimeout(() => {
      if (floatLabel?.id === id) floatLabel = null
    }, 1100)
  }

  function targetCircle(): { cx: number; cy: number; radius: number } | null {
    if (!stageEl) return null
    const r = stageEl.getBoundingClientRect()
    const radius = Math.min(r.width, r.height) * THROW_PHYSICS.targetRadiusFrac
    const off = agitationOffset(agitation, performance.now())
    return { cx: r.left + r.width / 2 + off.x, cy: r.top + r.height * 0.42 + off.y, radius }
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
  }

  function runFlight(next: FlightState, guaranteeHit: boolean) {
    flying = true
    holding = false
    flight = next
    lastRaf = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(40, now - lastRaf)
      lastRaf = now
      const cur = flight
      if (!cur) return
      const stepped = stepFlight(cur, dt)
      flight = stepped
      if (!stepped.done) {
        raf = requestAnimationFrame(loop)
        return
      }
      finishFlight(stepped, guaranteeHit)
    }
    raf = requestAnimationFrame(loop)
  }

  function finishFlight(state: FlightState, guaranteeHit: boolean) {
    stopRing()
    const target = targetCircle()
    const hit = guaranteeHit || (target ? hitTest(state.x, state.y, target) : false)
    const curve = mode === 'ball' && state.curveDir !== 0
    flying = false
    flight = null

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
      onBallMiss()
      return
    }

    play('hit')
    let quality: ThrowQuality = 'normal'
    if (!guaranteeHit && target) {
      const dist = Math.hypot(state.x - target.cx, state.y - target.cy)
      quality = qualityFromRing(dist, target.radius, ringFracAt(performance.now()))
    }
    if (quality !== 'normal') {
      const label =
        quality === 'nice' ? 'Nice!' : quality === 'great' ? 'Great!' : 'Excellent!'
      showFloat(label, true)
    }
    if (curve) showFloat('Curva!', true)
    onBallHit(quality, curve)
  }

  function launchGuaranteed() {
    const btn = btnEl?.getBoundingClientRect()
    const target = targetCircle()
    if (!btn || !target) {
      onBallHit('normal', false)
      return
    }
    play('tap')
    startRing()
    const x0 = btn.left + btn.width / 2
    const y0 = btn.top + btn.height / 2
    runFlight(beginGuaranteedFlight({ x0, y0, targetX: target.cx, targetY: target.cy }), true)
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
    centerX = btn.left + btn.width / 2
    centerY = btn.top + btn.height / 2
    holdX = e.clientX
    holdY = e.clientY
    holdAngle = 0
    samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }]
    spin = { lastAngle: null, accumulated: 0, direction: 0 }
    holding = true
    spinning = false
    if (mode === 'ball') startRing()
  }

  function onPointerMove(e: PointerEvent) {
    if (!holding || e.pointerId !== pointerId) return
    holdX = e.clientX
    holdY = e.clientY
    samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
    if (samples.length > 24) samples = samples.slice(-24)
    if (mode === 'ball') {
      spin = accumulateSpin(spin, centerX, centerY, e.clientX, e.clientY)
      const nextSpin = isSpinning(spin)
      if (nextSpin !== spinning) onSpinChange?.(nextSpin)
      spinning = nextSpin
      holdAngle = spin.accumulated
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
    const next = beginFlight({
      x0: e.clientX,
      y0: e.clientY,
      vx,
      vy,
      curveDir,
      spinning: mode === 'ball' && spinning,
    })
    holding = false
    pointerId = null
    runFlight(next, false)
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
  aria-busy={busy || flying}
  aria-label={label}
  disabled={blocked}
  style:touch-action="none"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  onkeydown={onKeyDown}
>
  {#if !holding && !flying}
    <img src={spriteSrc} alt="" width="60" height="60" draggable="false" />
  {:else}
    <span class="ghost" aria-hidden="true"></span>
  {/if}
  <small>
    {#if busy || flying}Lançando…{:else}{label}{/if}
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
{/if}

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
      aria-hidden="true"
    ></div>
  {/if}
{/if}

{#if floatLabel}
  {#key floatLabel.id}
    <p class="aim-float" class:bad={!floatLabel.good}>{floatLabel.text}</p>
  {/key}
{/if}

<style>
  .throw-btn {
    display: grid;
    justify-items: center;
    gap: 0;
    min-width: 108px;
    min-height: 92px;
    margin: 0;
    padding: 0.2rem 0.5rem 0.35rem;
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
    font-size: 0.72rem;
    line-height: 1.1;
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

  .aim-ring {
    position: fixed;
    z-index: 35;
    box-sizing: border-box;
    border: 3px solid color-mix(in srgb, #e8c547 85%, white);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    opacity: 0.9;
  }

  .aim-float {
    position: fixed;
    left: 50%;
    top: 28%;
    z-index: 45;
    margin: 0;
    transform: translate(-50%, 0);
    color: var(--grass-side);
    font-weight: 800;
    font-size: 1.35rem;
    text-shadow: 0 1px 0 #0006;
    pointer-events: none;
    animation: aim-float 1s ease-out both;
  }

  .aim-float.bad {
    color: var(--danger);
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
