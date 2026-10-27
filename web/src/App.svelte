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
  import { bindAudioUnlock, getVolume, isMuted, play, setVolume, toggleMute, warmCries } from './lib/sound'

  let phase = $state<'loading' | 'auth' | 'play'>('loading')
  let muted = $state(isMuted())
  let volumeLevel = $state(getVolume())
  let volumeOpen = $state(false)
  // Ícone com X quando não sai som, seja pelo mudo ou pela barra no zero.
  const silent = $derived(muted || volumeLevel === 0)
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

  // Gritos do jardim prontos antes de tocar num Pokémon (só baixa os novos).
  $effect(() => {
    if (!game) return
    warmCries([...new Set(game.pokemon.filter((mon) => mon.location === 'garden').map((mon) => mon.speciesId))])
  })

  function onMute() {
    muted = toggleMute()
  }

  function onVolume(event: Event) {
    volumeLevel = Number((event.currentTarget as HTMLInputElement).value) / 100
    setVolume(volumeLevel)
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
        aria-expanded={volumeOpen}
        aria-controls="volume-panel"
        aria-label="Som"
        title="Som"
        onclick={() => (volumeOpen = !volumeOpen)}
      >
        <!-- Alto-falante em pixels (grade 12×12): ondas com som, X no mudo. -->
        <svg class="speaker" viewBox="0 0 12 12" width="22" height="22" aria-hidden="true">
          <rect x="1" y="4" width="2" height="4" />
          <rect x="3" y="3" width="1" height="6" />
          <rect x="4" y="2" width="1" height="8" />
          <rect x="5" y="1" width="1" height="10" />
          {#if silent}
            <rect x="7" y="4" width="1" height="1" /><rect x="8" y="5" width="1" height="1" />
            <rect x="9" y="6" width="1" height="1" /><rect x="10" y="7" width="1" height="1" />
            <rect x="10" y="4" width="1" height="1" /><rect x="9" y="5" width="1" height="1" />
            <rect x="8" y="6" width="1" height="1" /><rect x="7" y="7" width="1" height="1" />
          {:else}
            <rect x="7" y="4" width="1" height="4" />
            <rect x="9" y="2" width="1" height="1" /><rect x="10" y="3" width="1" height="6" />
            <rect x="9" y="9" width="1" height="1" />
          {/if}
        </svg>
      </button>
      <button type="button" class="btn bag-btn" aria-label="Mochila" onclick={() => (screen = 'bag')}>
        Mochila
      </button>
      <button type="button" class="btn" onclick={logout}>Sair</button>
      {#if volumeOpen}
        <!-- Toque fora fecha o painel. -->
        <button type="button" class="volume-dismiss" aria-label="Fechar volume" onclick={() => (volumeOpen = false)}></button>
        <div class="panel volume-panel" id="volume-panel">
          <label class="volume-row">
            <span>Volume</span>
            <input
              type="range"
              class="volume-range"
              min="0"
              max="100"
              step="5"
              value={Math.round(volumeLevel * 100)}
              disabled={muted}
              oninput={onVolume}
            />
            <strong>{muted ? '—' : `${Math.round(volumeLevel * 100)}%`}</strong>
          </label>
          <button type="button" class="btn" aria-pressed={muted} onclick={onMute}>
            {muted ? 'Ligar som' : 'Silenciar'}
          </button>
        </div>
      {/if}
    </header>
    <!-- Mundo: área fixa. HUD flutuante (banner) não entra no fluxo e não empurra. -->
    <div class="world">
      {#if screen === 'explore'}
        <Explore {game} onClose={() => (screen = 'meadow')} onState={loadState} />
      {:else if screen === 'collection'}
        <Collection {game} onClose={() => (screen = 'meadow')} onState={loadState} />
      {:else if screen === 'daycare'}
        <Daycare {game} onClose={() => (screen = 'meadow')} onState={loadState} />
      {:else if screen === 'bag'}
        <Bag {game} onClose={() => (screen = 'meadow')} onState={loadState} />
      {:else}
        <Garden
          {game}
          onState={loadState}
          openPlotIndex={focusPlot}
          onPlotOpened={() => (focusPlot = null)}
        />
        {#if showReadyBanner && ready?.summary}
          <div class="ready-banner panel" role="status">
            <button type="button" class="ready-go" onclick={onReadyBanner}>{ready.summary}</button>
            <button type="button" class="ready-dismiss" aria-label="Dispensar" onclick={dismissReady}>✕</button>
          </div>
        {/if}
      {/if}
    </div>
    {#if screen === 'meadow'}
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
    /* Referência do painel de volume, que abre logo abaixo. */
    position: relative;
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

  /* Altura vem do .btn (48px), igual para Som, Mochila e Sair. */
  .bag-btn,
  .mute-btn {
    min-width: 44px;
    flex: none;
  }

  .mute-btn {
    padding-left: 0.45rem;
    padding-right: 0.45rem;
  }

  .mute-btn[aria-pressed='true'] {
    color: var(--ink-soft);
  }

  /* 22px: com as bordas de 12px o botão fica nos mesmos 48px dos vizinhos. */
  .speaker {
    display: block;
    flex: none;
    width: 22px;
    height: 22px;
    fill: currentColor;
    shape-rendering: crispEdges;
  }

  .volume-dismiss {
    position: fixed;
    z-index: 30;
    inset: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: default;
  }

  .volume-panel {
    position: absolute;
    z-index: 31;
    top: calc(100% + 0.25rem);
    left: 0;
    display: grid;
    gap: 0.5rem;
    width: min(100%, 20rem);
    box-sizing: border-box;
  }

  .volume-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 3.2rem;
    align-items: center;
    gap: 0.6rem;
    font-weight: 600;
  }

  .volume-row strong {
    text-align: right;
  }

  /* Barra em pixel: trilho afundado e pegador quadrado amarelo. */
  .volume-range {
    width: 100%;
    height: 44px;
    margin: 0;
    background: none;
    appearance: none;
    cursor: pointer;
    touch-action: manipulation;
  }

  .volume-range:disabled {
    filter: grayscale(1) opacity(0.5);
    cursor: default;
  }

  .volume-range::-webkit-slider-runnable-track {
    height: 10px;
    background: #00000022;
    box-shadow: inset 0 0 0 2px var(--ink);
  }

  .volume-range::-moz-range-track {
    height: 10px;
    background: #00000022;
    box-shadow: inset 0 0 0 2px var(--ink);
  }

  .volume-range::-moz-range-progress {
    height: 10px;
    background: var(--grass-side);
    box-shadow: inset 0 0 0 2px var(--ink);
  }

  .volume-range::-webkit-slider-thumb {
    width: 18px;
    height: 26px;
    margin-top: -8px;
    border: 3px solid var(--ink);
    border-radius: 0;
    background: var(--accent);
    box-shadow: inset 0 -3px 0 #c79a00;
    appearance: none;
  }

  .volume-range::-moz-range-thumb {
    box-sizing: border-box;
    width: 18px;
    height: 26px;
    border: 3px solid var(--ink);
    border-radius: 0;
    background: var(--accent);
    box-shadow: inset 0 -3px 0 #c79a00;
  }

  /* Celular: nível e energia numa linha; som, Mochila e Sair embaixo. */
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

    /* O ícone não precisa da largura de um botão com texto. */
    .hud .mute-btn {
      flex: none;
      width: 56px;
    }
  }

  .world {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .ready-banner {
    position: absolute;
    z-index: 8;
    top: 0.35rem;
    left: 0.35rem;
    right: 0.35rem;
    display: flex;
    align-items: stretch;
    gap: 0.25rem;
    min-width: 0;
    pointer-events: auto;
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

  /* Altura travada: o mundo preenche o meio; scroll só dentro de painéis. */
  .meadow.fit {
    display: flex;
    flex-direction: column;
    height: var(--screen-h);
    max-height: var(--screen-h);
    overflow: hidden;
  }
</style>
