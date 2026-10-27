<script lang="ts">
  import { onMount } from 'svelte'
  import { api, type GameState } from './lib/api'
  import AuthForm from './lib/AuthForm.svelte'
  import Bag from './lib/Bag.svelte'
  import Collection from './lib/Collection.svelte'
  import Daycare from './lib/Daycare.svelte'
  import Explore from './lib/Explore.svelte'
  import Garden from './lib/Garden.svelte'
  import { baseTasks, gameTasks, warmUp } from './lib/preload'
  import { readyStatus, shouldShowReadyBanner } from './lib/ready'
  import { formatClockTime, formatCountdown } from './lib/time'
  import { serverClock } from './lib/serverClock.svelte'
  import { bindAudioUnlock, isMuted, play, toggleMute } from './lib/sound'

  let phase = $state<'loading' | 'auth' | 'play'>('loading')
  let muted = $state(isMuted())
  // Abertura: sprites, molduras e fontes antes da primeira tela (lib/preload.ts).
  let progress = $state({ done: 0, total: 0 })
  let offline = $state(false)
  let screen = $state<'meadow' | 'explore' | 'collection' | 'daycare' | 'bag'>('meadow')
  let game = $state<GameState | null>(null)
  let energyDetail = $state(false)
  let dismissedReady = $state<string[]>([])
  let focusPlot = $state<number | null>(null)
  /** Evita recarregar em loop quando o +1 vence: uma vez por `energyNextAt`. */
  let reloadedForNextAt = $state<number | null>(null)

  const clock = serverClock(() => game?.now ?? 0)

  const ready = $derived(
    game ? readyStatus({ plots: game.plots, daycare: game.daycare }, clock.now()) : null,
  )
  const showReadyBanner = $derived(
    screen === 'meadow' && ready !== null && shouldShowReadyBanner(ready, dismissedReady),
  )

  $effect(() => {
    if (!game || phase !== 'play') return
    const nextAt = game.trainer.energyNextAt
    if (nextAt === null) return
    if (clock.now() < nextAt) return
    if (reloadedForNextAt === nextAt) return
    reloadedForNextAt = nextAt
    void loadState()
  })

  async function loadState() {
    let response: Response
    try {
      response = await api('/api/state')
    } catch {
      // Sem rede na abertura: oferece tentar de novo em vez de travar no carregando.
      if (phase === 'loading') offline = true
      return
    }
    if (response.status === 401) {
      game = null
      screen = 'meadow'
      if (phase !== 'auth') await warmUp(baseTasks(), onProgress)
      phase = 'auth'
      return
    }
    if (!response.ok) {
      if (!game) phase = 'auth'
      return
    }
    const next = (await response.json()) as GameState
    // Entrando no jogo (abertura ou logo após o login): só mostra o jardim com a
    // arte pronta. As atualizações durante o jogo não passam por aqui.
    if (phase !== 'play') {
      phase = 'loading'
      await warmUp([...baseTasks(), ...gameTasks(next)], onProgress)
    }
    game = next
    phase = 'play'
  }

  function onProgress(done: number, total: number) {
    progress = { done, total }
  }

  function retry() {
    offline = false
    progress = { done: 0, total: 0 }
    void loadState()
  }

  async function logout() {
    await api('/api/auth/logout', {})
    game = null
    phase = 'auth'
    screen = 'meadow'
  }

  function energyCaption(): string {
    if (!game) return ''
    const { energyNextAt, energyFullAt } = game.trainer
    if (energyNextAt === null || energyFullAt === null) return 'Cheia'
    const now = clock.now()
    if (!energyDetail) {
      return `+1 em ${formatCountdown(energyNextAt - now)}`
    }
    const untilFull = energyFullAt - now
    if (untilFull >= 60 * 60 * 1000) return `cheia em ${formatCountdown(untilFull)}`
    return `cheia às ${formatClockTime(energyFullAt)}`
  }

  function onReadyBanner() {
    if (!ready) return
    if (ready.berryCount > 0) {
      focusPlot = ready.readyPlots[0] ?? null
      screen = 'meadow'
      return
    }
    if (ready.daycareFullCount > 0) screen = 'daycare'
  }

  function dismissReady() {
    if (ready) dismissedReady = ready.ids
  }

  onMount(() => {
    bindAudioUnlock()
    muted = isMuted()
    void loadState()
  })

  function onMute() {
    muted = toggleMute()
  }
</script>

{#if phase === 'loading'}
  <!-- Só CSS: as molduras em PNG são justamente parte do que está carregando. -->
  <main class="status boot">
    <p class="boot-logo">Pocket<span>Meadow</span></p>
    {#if offline}
      <p class="boot-caption">Sem conexão com o servidor.</p>
      <button type="button" class="boot-retry" onclick={retry}>Tentar de novo</button>
    {:else}
      <div
        class="boot-bar"
        role="progressbar"
        aria-label="Carregando"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
      >
        <span style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"></span>
      </div>
      <p class="boot-caption">
        {progress.total ? `Carregando ${progress.done}/${progress.total}` : 'Abrindo o jardim…'}
      </p>
    {/if}
  </main>
{:else if phase === 'auth' || game === null}
  <AuthForm onSignedIn={loadState} />
{:else}
  <main class="meadow fit">
    <header class="panel hud">
      <div class="level" aria-label="Nível de treinador">
        <small>Nv</small>{game.trainer.level}
      </div>
      <button
        type="button"
        class="energy"
        aria-label="Energia"
        onclick={() => (energyDetail = !energyDetail)}
      >
        <span class="label">Energia {game.trainer.energy}/{game.trainer.energyMax}</span>
        <div class="pips" aria-hidden="true">
          {#each Array.from({ length: game.trainer.energyMax }, (_, i) => i) as i (i)}
            <span class="pip" class:full={i < game.trainer.energy}></span>
          {/each}
        </div>
        <span class="timer">{energyCaption()}</span>
      </button>
      <button
        type="button"
        class="btn mute-btn"
        aria-pressed={muted}
        aria-label={muted ? 'Ativar som' : 'Silenciar'}
        onclick={onMute}
      >
        {muted ? 'Mudo' : 'Som'}
      </button>
      <button type="button" class="btn bag-btn" aria-label="Mochila" onclick={() => (screen = 'bag')}>
        Mochila
      </button>
      <button type="button" class="btn" onclick={logout}>Sair</button>
    </header>
    {#if screen === 'explore'}
      <Explore {game} onClose={() => (screen = 'meadow')} onState={loadState} />
    {:else if screen === 'collection'}
      <Collection {game} onClose={() => (screen = 'meadow')} onState={loadState} />
    {:else if screen === 'daycare'}
      <Daycare {game} onClose={() => (screen = 'meadow')} onState={loadState} />
    {:else if screen === 'bag'}
      <Bag {game} onClose={() => (screen = 'meadow')} onState={loadState} />
    {:else}
      {#if showReadyBanner && ready?.summary}
        <div class="ready-banner" role="status">
          <button type="button" class="ready-go" onclick={onReadyBanner}>{ready.summary}</button>
          <button type="button" class="ready-dismiss" aria-label="Dispensar" onclick={dismissReady}>✕</button>
        </div>
      {/if}
      <Garden
        {game}
        onState={loadState}
        openPlotIndex={focusPlot}
        onPlotOpened={() => (focusPlot = null)}
      />
      <div class="docks">
        <button type="button" class="btn" onclick={() => (screen = 'collection')}>Coleção</button>
        <button type="button" class="btn badge-host" onclick={() => (screen = 'daycare')}>
          Daycare
          {#if ready && ready.daycareFullCount > 0}
            <span class="badge" aria-label={`${ready.daycareFullCount} prontos`}>{ready.daycareFullCount}</span>
          {/if}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          onclick={() => {
            play('tap')
            screen = 'explore'
          }}
        >
          {game.encounter ? 'Ver encontro' : 'Explorar'}
        </button>
      </div>
    {/if}
  </main>
{/if}

<style>
  .status,
  .meadow {
    box-sizing: border-box;
    width: 100%;
    margin: 0 auto;
    padding: 0.5rem;
  }

  .status {
    display: grid;
    place-items: center;
    min-height: var(--screen-h);
    font-size: 1.2rem;
  }

  .boot {
    place-content: center;
    gap: 1rem;
  }

  .boot-logo {
    display: grid;
    justify-items: center;
    margin: 0;
    font-size: 2.6rem;
    font-weight: 700;
    color: #fff;
    text-shadow:
      0 3px 0 var(--grass-side),
      3px 0 0 var(--grass-side),
      -3px 0 0 var(--grass-side),
      0 -3px 0 var(--grass-side),
      0 6px 0 var(--ink);
  }

  .boot-logo span {
    color: var(--accent);
    font-size: 1.15em;
    margin-top: -0.15em;
  }

  .boot-bar {
    box-sizing: border-box;
    width: min(16rem, 80vw);
    height: 20px;
    padding: 3px;
    background: var(--ink);
  }

  .boot-bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    box-shadow: inset 0 -3px 0 #c79a00;
    transition: width 0.15s steps(4, end);
  }

  .boot-caption {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .boot-retry {
    min-height: 48px;
    padding: 0 1.25rem;
    border: 3px solid var(--ink);
    background: var(--accent);
    box-shadow: inset 0 -4px 0 #c79a00;
    font-weight: 700;
    cursor: pointer;
    touch-action: manipulation;
  }

  .meadow {
    max-width: 64rem;
    min-height: var(--screen-h);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .hud {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.25rem;
  }

  .level {
    display: grid;
    place-items: center;
    min-width: 44px;
    height: 44px;
    background: var(--ink);
    color: var(--accent);
    font-size: 1.3rem;
    font-weight: 700;
    line-height: 1;
    box-shadow: inset 0 calc(var(--px) * -2) 0 #00000055;
    flex: none;
  }

  .level small {
    font-size: 0.55rem;
    color: #fff;
  }

  .energy {
    display: grid;
    gap: 0.15rem;
    flex: 1;
    min-width: 0;
    min-height: 44px;
    margin: 0;
    padding: 0.15rem 0.25rem;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    color: inherit;
    font: inherit;
  }

  .label {
    font-size: 15px;
    font-weight: 600;
  }

  .pips {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 14px);
    gap: 3px;
  }

  .pip {
    height: 14px;
    background: #00000022;
    box-shadow: inset 0 0 0 var(--px) #00000033;
  }

  .pip.full {
    background: var(--accent);
    box-shadow:
      inset 0 calc(var(--px) * -2) 0 #c79a00,
      inset 0 var(--px) 0 #fff3a0;
  }

  .timer {
    font-size: 13px;
    font-weight: 700;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bag-btn,
  .mute-btn {
    min-width: 44px;
    min-height: 44px;
    flex: none;
  }

  .mute-btn {
    padding-left: 0.45rem;
    padding-right: 0.45rem;
  }

  .mute-btn[aria-pressed='true'] {
    color: var(--ink-soft);
  }

  /* Celular: nível e energia numa linha; Som, Mochila e Sair embaixo. */
  @media (max-width: 420px) {
    .hud {
      flex-wrap: wrap;
      row-gap: 0.25rem;
    }

    .energy {
      flex-basis: calc(100% - 44px - 0.5rem);
    }

    .hud .btn {
      flex: 1;
    }
  }

  .ready-banner {
    display: flex;
    align-items: stretch;
    gap: 0.25rem;
    flex: none;
    min-width: 0;
  }

  .ready-go {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    margin: 0;
    padding: 0.35rem 0.65rem;
    border: 0;
    background: #00000014;
    box-shadow: inset 0 0 0 var(--px) #00000022;
    font: inherit;
    font-weight: 700;
    font-size: 15px;
    text-align: left;
    color: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }

  .ready-dismiss {
    flex: none;
    min-width: 44px;
    min-height: 44px;
    margin: 0;
    padding: 0;
    border: 0;
    background: #00000010;
    font: inherit;
    font-weight: 700;
    color: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }

  .docks {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.35rem;
    flex: none;
  }

  .docks .btn {
    position: relative;
    min-width: 0;
    min-height: 44px;
    padding-left: 0.35rem;
    padding-right: 0.35rem;
    font-size: 16px;
  }

  .badge {
    position: absolute;
    top: -0.2rem;
    right: -0.15rem;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.25rem;
    border-radius: 0;
    background: var(--danger);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1.25rem;
    text-align: center;
    box-shadow: inset 0 calc(var(--px) * -1) 0 #00000044;
  }

  /* Telas cheias: o meio rola e os botões ficam embaixo. */
  .meadow.fit {
    height: var(--screen-h);
    max-height: var(--screen-h);
    overflow: hidden;
  }
</style>
