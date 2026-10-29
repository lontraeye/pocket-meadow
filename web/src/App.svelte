<script lang="ts">
  import { snapIconSize } from './lib/pixelSnap.svelte'
  import { onMount } from 'svelte'
  import { api, type GameState } from './lib/api'
  import { takeLegacyBattleAuto } from './lib/battlePersist'
  import AuthForm from './lib/AuthForm.svelte'
  import Bag from './lib/Bag.svelte'
  import Collection from './lib/Collection.svelte'
  import Daycare from './lib/Daycare.svelte'
  import Explore from './lib/Explore.svelte'
  import PcBox from './lib/PcBox.svelte'
  import Garden from './lib/Garden.svelte'
  import Modal from './lib/Modal.svelte'
  import Pokedex from './lib/Pokedex.svelte'
  import WeatherIcon from './lib/WeatherIcon.svelte'
  import { WEATHER_WITH } from './lib/weather'
  import type { WeatherKey } from './lib/api'
  import { baseTasks, gameTasks, warmUp } from './lib/preload'
  import { readyStatus, shouldShowReadyBanner } from './lib/ready'
  import { formatClockTime, formatCountdown } from './lib/time'
  import { serverClock } from './lib/serverClock.svelte'
  import { bindAudioUnlock, getVolume, isMuted, play, setVolume, toggleMute, warmCries } from './lib/sound'
  import { registerServiceWorker } from './lib/pwa'
  import { connection } from './lib/connection.svelte'

  /** Sem conexão no jogo: de quanto em quanto tempo tenta o /state de novo. */
  const RECONNECT_MS = 5_000

  let phase = $state<'loading' | 'auth' | 'play'>('loading')
  let updateAvailable = $state(false)
  let applyUpdate = $state<() => void>(() => undefined)
  let muted = $state(isMuted())
  let volumeLevel = $state(getVolume())
  let configOpen = $state(false)
  let weatherOpen = $state(false)
  let reloadedForWeather = 0
  // Ícone com X quando não sai som, seja pelo mudo ou pela barra no zero.
  const silent = $derived(muted || volumeLevel === 0)
  // Abertura: sprites, molduras e fontes antes da primeira tela (lib/preload.ts).
  let progress = $state({ done: 0, total: 0 })
  let offline = $state(false)
  let screen = $state<'meadow' | 'explore' | 'collection' | 'daycare' | 'bag' | 'pc'>('meadow')
  /** De onde o PC foi aberto (Voltar volta para lá). */
  let pcReturn = $state<'collection' | 'explore'>('collection')

  function openPc(from: 'collection' | 'explore') {
    pcReturn = from
    screen = 'pc'
  }
  let game = $state<GameState | null>(null)
  let energyDetail = $state(false)
  let dismissedReady = $state<string[]>([])
  let focusPlot = $state<number | null>(null)
  /** Evita recarregar em loop quando o +1 vence: uma vez por `energyNextAt`. */
  let reloadedForNextAt = $state<number | null>(null)
  /** Pokédex no HUD; fica montada após a 1ª abertura para lembrar filtros/rolagem. */
  let pokedexOpen = $state(false)
  let pokedexMounted = $state(false)
  let pokedexHistoryPushed = $state(false)

  const claimable = $derived(game?.pokedex.claimable ?? 0)

  /** Progresso visual até o próximo Nv (só a barra do HUD). */
  const trainerXpPct = $derived.by(() => {
    if (!game) return 0
    const { xp, xpToNext: need } = game.trainer
    if (need <= 0) return 0
    return Math.min(100, Math.max(0, (xp / need) * 100))
  })

  // Ícones 12×12 do HUD (X = pixel aceso), no traço do alto-falante.
  // Tamanho alinhado aos pixels da tela (escala do Windows, zoom): ver pixelSnap.
  const hudIcon = $derived(snapIconSize(24))
  const DEX_ICON = [
    '.XXXXXXXXXX.',
    'X..........X',
    'X.XX.X.X...X',
    'X.XX.......X',
    'X..........X',
    'XXXXXXXXXXXX',
    'X..........X',
    'X.XXXXXXXX.X',
    'X.XXXXXXXX.X',
    'X.XXXXXXXX.X',
    'X..........X',
    '.XXXXXXXXXX.',
  ].flatMap((line, y) => [...line].flatMap((cell, x) => (cell === 'X' ? [{ x, y }] : [])))

  // Mochila: alça, topo arredondado e bolso com aba e fivela na frente.
  const BAG_ICON = [
    '....XXXX....',
    '...X....X...',
    '..XXXXXXXX..',
    '.X.X....X.X.',
    '.X.X....X.X.',
    '.X.XXXXXX.X.',
    '.X.X.XX.X.X.',
    '.X.X....X.X.',
    '.X.XXXXXX.X.',
    '.X........X.',
    '.X........X.',
    '..XXXXXXXX..',
  ].flatMap((line, y) => [...line].flatMap((cell, x) => (cell === 'X' ? [{ x, y }] : [])))

  const GEAR_ICON = [
    '....XXXX....',
    '...X....X...',
    '.XXX....XXX.',
    'X..X....X..X',
    'X...XXXX...X',
    '.X........X.',
    '.X........X.',
    'X...XXXX...X',
    'X..X....X..X',
    '.XXX....XXX.',
    '...X....X...',
    '....XXXX....',
  ].flatMap((line, y) => [...line].flatMap((cell, x) => (cell === 'X' ? [{ x, y }] : [])))

  function isNarrowDex(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches
  }

  function openPokedex() {
    pokedexMounted = true
    pokedexOpen = true
    if (isNarrowDex() && !pokedexHistoryPushed) {
      history.pushState({ pokedex: true }, '')
      pokedexHistoryPushed = true
    }
  }

  function closePokedex(fromPopstate = false) {
    if (!pokedexOpen) return
    pokedexOpen = false
    if (!fromPopstate && pokedexHistoryPushed) {
      pokedexHistoryPushed = false
      history.back()
      return
    }
    pokedexHistoryPushed = false
  }

  function togglePokedex() {
    if (pokedexOpen) closePokedex()
    else openPokedex()
  }

  const clock = serverClock(() => game?.now ?? 0)

  const ready = $derived(
    game ? readyStatus({ plots: game.plots, daycare: game.daycare }, clock.now()) : null,
  )
  const showReadyBanner = $derived(
    screen === 'meadow' && ready !== null && shouldShowReadyBanner(ready, dismissedReady),
  )

  $effect(() => {
    if (!game || phase !== 'play' || !game.trainer.energyEnabled) return
    const nextAt = game.trainer.energyNextAt
    if (nextAt === null) return
    if (clock.now() < nextAt) return
    if (reloadedForNextAt === nextAt) return
    reloadedForNextAt = nextAt
    void loadState()
  })

  // Virou o dia em Brasília com o app aberto: busca o clima novo.
  $effect(() => {
    if (!game || phase !== 'play') return
    const until = game.weather.until
    if (clock.now() < until) return
    if (reloadedForWeather === until) return
    reloadedForWeather = until
    void loadState()
  })

  /** Plantas que crescem mais rápido se plantadas hoje. */
  const weatherBerries = $derived(
    game ? game.berries.filter((berry) => berry.favoriteWeather === game!.weather.key).map((berry) => berry.name) : [],
  )

  async function forceWeather(weather: WeatherKey | null) {
    try {
      await api('/api/dev/weather', { weather })
    } catch {
      return
    }
    await loadState()
  }

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
      pokedexOpen = false
      pokedexMounted = false
      pokedexHistoryPushed = false
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
    game = await adoptLegacyBattleAuto(next)
    phase = 'play'
  }

  /** Uma vez: se o aparelho tinha Auto ligado e o servidor não, grava e esquece a chave. */
  async function adoptLegacyBattleAuto(state: GameState): Promise<GameState> {
    const legacyOn = takeLegacyBattleAuto()
    if (!legacyOn || state.trainer.battleAuto) return state
    try {
      const response = await api('/api/trainer/prefs', { battleAuto: true }, 'PUT')
      if (!response.ok) return state
      return { ...state, trainer: { ...state.trainer, battleAuto: true } }
    } catch {
      return state
    }
  }

  function onProgress(done: number, total: number) {
    progress = { done, total }
  }

  function retry() {
    offline = false
    progress = { done: 0, total: 0 }
    void loadState()
  }

  // Sem conexão durante o jogo: tenta o /state a cada RECONNECT_MS e assim que
  // o aparelho avisa que a rede voltou. A primeira resposta apaga o aviso
  // (api() marca online) e já traz o estado atualizado.
  $effect(() => {
    if (phase !== 'play' || !connection.offline) return
    const retryState = () => void loadState()
    const timer = window.setInterval(retryState, RECONNECT_MS)
    window.addEventListener('online', retryState)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', retryState)
    }
  })

  async function logout() {
    configOpen = false
    try {
      await api('/api/auth/logout', {})
    } catch {
      // Sem rede o cookie continua valendo: fica no jogo, com o aviso no topo.
      return
    }
    if (pokedexOpen && pokedexHistoryPushed) {
      pokedexHistoryPushed = false
      history.back()
    }
    pokedexOpen = false
    pokedexMounted = false
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
    const onPopState = () => {
      if (pokedexOpen) closePokedex(true)
    }
    window.addEventListener('popstate', onPopState)
    const unregisterSw = registerServiceWorker({
      onChange: (handle) => {
        updateAvailable = handle.available
        applyUpdate = handle.apply
      },
    })
    return () => {
      window.removeEventListener('popstate', onPopState)
      unregisterSw?.()
    }
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
  <main
    class="meadow fit"
    class:immersive={screen === 'meadow'}
    class:pokedex-open={pokedexOpen}
  >
    <!-- No jardim o gramado é o fundo da tela; HUD e docks flutuam por cima. -->
    {#if screen === 'meadow'}
      <div class="garden-layer">
        <Garden
          {game}
          onState={loadState}
          openPlotIndex={focusPlot}
          onPlotOpened={() => (focusPlot = null)}
        />
      </div>
    {/if}

    {#if updateAvailable}
      <button type="button" class="update-banner" onclick={() => applyUpdate()}>
        Versão nova disponível · Atualizar
      </button>
    {/if}

    <div class="top-chrome">
    {#if connection.offline}
      <p class="offline-banner" role="status">Sem conexão · tentando de novo</p>
    {/if}
    <header class="panel hud">
      <div class="hud-trainer">
        <div class="level-wrap" aria-label="Nível de treinador {game.trainer.level}">
          <span class="level-tab">Nv</span>
          <div class="level">{game.trainer.level}</div>
          <div class="level-xp" aria-hidden="true">
            <span style:width="{trainerXpPct}%"></span>
          </div>
        </div>
        {#if game.trainer.energyEnabled}
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
        {:else}
          <!-- Energia desligada: o lugar dela mostra o XP de treinador. -->
          <div class="energy trainer-progress">
            <span class="label">Treinador</span>
            <div class="pips" aria-hidden="true">
              <span class="pip xp-bar"><span style:width="{trainerXpPct}%"></span></span>
            </div>
            <span class="timer">XP {game.trainer.xp}/{game.trainer.xpToNext}</span>
          </div>
        {/if}
      </div>
      <span class="hud-sep" aria-hidden="true"></span>
      <div class="hud-actions">
        <!-- Clima de hoje: o jardim já mostra, mas o ícone deixa claro e abre os detalhes. -->
        <button
          type="button"
          class="btn icon-btn"
          aria-label="Clima: {game.weather.name}"
          title={game.weather.name}
          aria-pressed={weatherOpen}
          onclick={() => (weatherOpen = true)}
        >
          <WeatherIcon weather={game.weather.key} />
        </button>
        <button
          type="button"
          class="btn icon-btn badge-host"
          aria-label="Pokédex"
          aria-pressed={pokedexOpen}
          title="Pokédex"
          onclick={togglePokedex}
        >
          <svg class="hud-icon" viewBox="0 0 12 12" width={hudIcon} height={hudIcon} aria-hidden="true">
            {#each DEX_ICON as px (`${px.x},${px.y}`)}
              <rect x={px.x} y={px.y} width="1" height="1" />
            {/each}
          </svg>
          {#if claimable > 0}
            <span class="dot" aria-hidden="true"></span>
            <span class="sr-only">{claimable === 1 ? '1 recompensa para resgatar' : `${claimable} recompensas para resgatar`}</span>
          {/if}
        </button>
        <button
          type="button"
          class="btn icon-btn"
          aria-label="Mochila"
          title="Mochila"
          aria-pressed={screen === 'bag'}
          onclick={() => (screen = 'bag')}
        >
          <svg class="hud-icon" viewBox="0 0 12 12" width={hudIcon} height={hudIcon} aria-hidden="true">
            {#each BAG_ICON as px (`${px.x},${px.y}`)}
              <rect x={px.x} y={px.y} width="1" height="1" />
            {/each}
          </svg>
        </button>
        <button
          type="button"
          class="btn icon-btn"
          aria-label="Configurações"
          title="Configurações"
          aria-pressed={configOpen}
          onclick={() => (configOpen = true)}
        >
          <svg class="hud-icon" viewBox="0 0 12 12" width={hudIcon} height={hudIcon} aria-hidden="true">
            {#each GEAR_ICON as px (`${px.x},${px.y}`)}
              <rect x={px.x} y={px.y} width="1" height="1" />
            {/each}
          </svg>
        </button>
      </div>
    </header>
    {#if screen === 'meadow' && showReadyBanner && ready?.summary}
      <div class="ready-banner panel" role="status">
        <button type="button" class="ready-go" onclick={onReadyBanner}>{ready.summary}</button>
        <button type="button" class="ready-dismiss" aria-label="Dispensar" onclick={dismissReady}>✕</button>
      </div>
    {/if}
    </div>

    {#if screen !== 'meadow'}
      <div class="world">
        {#if screen === 'explore'}
          <Explore {game} onClose={() => (screen = 'meadow')} onState={loadState} onOpenPc={() => openPc('explore')} />
        {:else if screen === 'collection'}
          <Collection {game} onClose={() => (screen = 'meadow')} onState={loadState} onOpenPc={() => openPc('collection')} />
        {:else if screen === 'pc'}
          <PcBox {game} onClose={() => (screen = pcReturn)} onState={loadState} />
        {:else if screen === 'daycare'}
          <Daycare {game} onClose={() => (screen = 'meadow')} onState={loadState} />
        {:else if screen === 'bag'}
          <Bag {game} onClose={() => (screen = 'meadow')} onState={loadState} />
        {/if}
      </div>
    {/if}

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

    {#if pokedexMounted && game}
      <div
        class="pokedex-shell"
        class:open={pokedexOpen}
        aria-hidden={!pokedexOpen}
        inert={!pokedexOpen ? true : undefined}
      >
        <Pokedex {game} onState={loadState} onClose={() => closePokedex()} />
      </div>
    {/if}

    {#if weatherOpen}
      <Modal label="Clima" onBackdrop={() => (weatherOpen = false)}>
        <div class="weather-panel">
          <header class="config-head">
            <h2 class="weather-title"><WeatherIcon weather={game.weather.key} size={36} /> {game.weather.name}</h2>
            <button type="button" class="btn config-close" aria-label="Fechar" onclick={() => (weatherOpen = false)}>
              ✕
            </button>
          </header>
          <p>Muda à meia-noite · em {formatCountdown(Math.max(0, game.weather.until - clock.now()))}.</p>
          {#if weatherBerries.length > 0}
            <p>
              Crescem {Math.round((1 - game.weatherGrowFactor) * 100)}% mais rápido se plantadas hoje:
              <b>{weatherBerries.join(', ')}</b>.
            </p>
          {:else}
            <p>Nenhuma planta prefere este clima.</p>
          {/if}
          <p class="weather-hint">Cada planta tem um clima favorito: veja na hora de plantar.</p>
          {#if game.devTools}
            <div class="weather-dev">
              {#each ['sunny', 'cloudy', 'rain', 'wind'] as const as key (key)}
                <button
                  type="button"
                  class="btn icon-btn"
                  aria-label="Forçar {WEATHER_WITH[key]} (teste)"
                  aria-pressed={game.weather.key === key}
                  onclick={() => void forceWeather(key)}
                >
                  <WeatherIcon weather={key} />
                </button>
              {/each}
              <button type="button" class="btn" onclick={() => void forceWeather(null)}>Sorteado</button>
            </div>
          {/if}
        </div>
      </Modal>
    {/if}

    {#if configOpen}
      <Modal label="Configurações" fullMobile onBackdrop={() => (configOpen = false)}>
        <div class="config">
          <header class="config-head">
            <h2>Configurações</h2>
            <button type="button" class="btn config-close" aria-label="Fechar" onclick={() => (configOpen = false)}>
              ✕
            </button>
          </header>
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
          <button type="button" class="btn mute-toggle" aria-pressed={muted} onclick={onMute}>
            <svg class="hud-icon" viewBox="0 0 12 12" width={hudIcon} height={hudIcon} aria-hidden="true">
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
            {muted ? 'Ligar som' : 'Silenciar'}
          </button>
          <div class="config-spacer"></div>
          <button type="button" class="btn config-logout" onclick={logout}>Sair da conta</button>
        </div>
      </Modal>
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
    box-shadow: inset 0 -3px 0 var(--accent-shade);
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
    box-shadow: inset 0 -4px 0 var(--accent-shade);
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

  .update-banner {
    flex: none;
    width: 100%;
    min-height: 44px;
    margin: 0;
    padding: 0.45rem 0.75rem;
    border: 0;
    background: var(--ink);
    color: var(--accent);
    font: inherit;
    font-size: 15px;
    font-weight: 700;
    text-align: center;
    cursor: pointer;
    touch-action: manipulation;
    z-index: 6;
  }

  /* Fica no topo do chrome, acima do HUD: no jardim desce junto com ele. Só
     informa (não é botão), então pode ser mais baixo que um alvo de toque. */
  .offline-banner {
    flex: none;
    margin: 0;
    padding: 0.3rem 0.75rem;
    background: var(--danger);
    color: #fff;
    font-size: 15px;
    font-weight: 700;
    text-align: center;
    text-shadow: 0 var(--px) 0 #00000055;
  }

  @media (prefers-reduced-motion: no-preference) {
    .offline-banner {
      animation: offline-blink 1.6s steps(2, jump-none) infinite alternate;
    }
  }

  @keyframes offline-blink {
    from {
      opacity: 1;
    }
    to {
      opacity: 0.8;
    }
  }

  /* Acima do HUD; no jardim o chrome desce um pouco se o aviso estiver aberto. */
  .meadow.immersive .update-banner {
    position: absolute;
    top: env(safe-area-inset-top);
    left: 0;
    right: 0;
  }

  .meadow.immersive:has(.update-banner) .top-chrome {
    top: calc(2.75rem + env(safe-area-inset-top));
  }

  /* Jardim = fundo da janela; HUD/docks flutuam por cima (fora do fluxo). */
  .meadow.immersive {
    position: fixed;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    max-width: none;
    margin: 0;
    gap: 0;
    padding: 0;
    overflow: hidden;
    /* Mesmo verde do gramado de fora (Garden.svelte), para as bordas do celular. */
    background: #4f7a3a;
  }

  .garden-layer {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  /* Desktop: menus com folga e largura limitada. Celular: cola nas bordas. */
  .meadow.immersive .top-chrome,
  .meadow.immersive .docks {
    width: min(
      calc(100% - 1rem - env(safe-area-inset-left) - env(safe-area-inset-right)),
      var(--menu-max)
    );
    margin-inline: auto;
  }

  /* HUD + banner “pronto” no mesmo fluxo: o banner acompanha a altura do HUD. */
  .meadow.immersive .top-chrome {
    --menu-max: 40rem;
    position: absolute;
    z-index: 4;
    top: calc(0.5rem + env(safe-area-inset-top));
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    pointer-events: none;
  }

  .meadow.immersive .top-chrome > * {
    pointer-events: auto;
  }

  .meadow.immersive .hud {
    position: relative;
    width: 100%;
    margin: 0;
    pointer-events: none;
  }

  .meadow.immersive .hud > * {
    pointer-events: auto;
  }

  .meadow.immersive .docks {
    --menu-max: 30rem;
    position: absolute;
    z-index: 4;
    bottom: calc(0.5rem + env(safe-area-inset-bottom));
    left: 0;
    right: 0;
    pointer-events: none;
  }

  .meadow.immersive .docks > * {
    pointer-events: auto;
  }

  .meadow.immersive .ready-banner {
    position: relative;
    top: auto;
    left: auto;
    right: auto;
    width: 100%;
    margin: 0;
  }

  @media (max-width: 899px) {
    .meadow {
      padding: 0;
    }

    .meadow.immersive .top-chrome,
    .meadow.immersive .docks {
      width: 100%;
      max-width: none;
      margin-inline: 0;
      left: 0;
      right: 0;
    }

    .meadow.immersive .top-chrome {
      top: env(safe-area-inset-top);
    }

    .meadow.immersive .hud {
      border-left: 0;
      border-right: 0;
      border-top: 0;
      box-shadow: inset 0 -1px 0 var(--panel-shade);
    }

    .meadow.immersive .docks {
      bottom: env(safe-area-inset-bottom);
      gap: 0.35rem;
      padding: 0 0.35rem 0.35rem;
      box-sizing: border-box;
    }

    .meadow.fit .world {
      padding: 0.5rem;
    }
  }

  .hud {
    /* Referência do painel de volume, que abre logo abaixo. */
    position: relative;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.4rem;
  }

  .hud-trainer {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1;
    min-width: 0;
    /* Desktop: ações à esquerda; o DOM fica perfil → ações pro empilhar no celular. */
    order: 2;
  }

  .hud-sep {
    flex: none;
    align-self: stretch;
    width: 1px;
    margin: 0.15rem 0;
    background: var(--panel-shade);
    order: 1;
  }

  .hud-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: none;
    order: 0;
  }

  /* Ícones do HUD (Pokédex / mochila / config): quadrado com borda e sombra. */
  .hud .icon-btn {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    border: var(--px) solid var(--panel-edge);
    background: var(--panel-face);
    box-shadow:
      1px 1px 0 #000,
      inset 0 -2px 0 var(--panel-shade);
    color: var(--ink);
  }

  .hud .icon-btn:active:not(:disabled) {
    background: var(--paper);
    box-shadow:
      1px 1px 0 #000,
      inset 0 2px 0 #00000022;
    transform: translateY(var(--px));
  }

  .hud .icon-btn[aria-pressed='true'] {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--selected-face);
    box-shadow:
      1px 1px 0 #000,
      inset 0 -2px 0 var(--primary-shade);
  }

  /* Etiqueta “Nv” em cima do quadrado, tipo aba de pasta / marcador. */
  .level-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: none;
    width: 44px;
  }

  .level-tab {
    z-index: 1;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    margin: 0 0 calc(var(--px) * -1);
    padding: 0 4px;
    height: 11px;
    border: var(--px) solid var(--ink);
    border-bottom: 0;
    background: var(--accent);
    color: var(--ink);
    font-size: 0.5rem;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    box-shadow: 1px 0 0 #000;
  }

  .level {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 44px;
    height: 44px;
    border: var(--px) solid var(--accent);
    background: var(--ink);
    color: var(--accent);
    font-size: 1.3rem;
    font-weight: 700;
    line-height: 1;
    text-align: center;
    box-shadow:
      1px 1px 0 #000,
      inset 0 calc(var(--px) * -2) 0 #00000055;
  }

  .level-xp {
    width: 100%;
    height: 4px;
    margin-top: 2px;
    background: #00000044;
  }

  .level-xp > span {
    display: block;
    height: 100%;
    background: var(--grass-side);
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
    display: flex;
    gap: 3px;
    width: 100%;
  }

  .pip {
    flex: 1 1 0;
    min-width: 0;
    height: 14px;
    background: #00000022;
    box-shadow: inset 0 0 0 var(--px) #00000033;
  }

  .pip.full {
    background: var(--accent);
    box-shadow:
      inset 0 calc(var(--px) * -2) 0 var(--accent-shade),
      inset 0 var(--px) 0 #fff3a0;
  }

  .trainer-progress {
    cursor: default;
  }

  .xp-bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
    box-shadow:
      inset 0 calc(var(--px) * -2) 0 var(--accent-shade),
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

  .icon-btn {
    flex: none;
  }

  /* Tamanho vem do snapIconSize (escala inteira na tela), não do CSS. */
  .hud-icon {
    display: block;
    flex: none;
    fill: currentColor;
    shape-rendering: crispEdges;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }

  /* Só para leitor de tela. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* Alerta de resgate: bolinha pixelada (8px, cantos cortados) no canto. */
  .dot {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 8px;
    height: 8px;
    background: #f06a2a;
    clip-path: polygon(2px 0, 6px 0, 6px 2px, 8px 2px, 8px 6px, 6px 6px, 6px 8px, 2px 8px, 2px 6px, 0 6px, 0 2px, 2px 2px);
    box-shadow: inset -2px -2px 0 #b8401a;
  }

  .badge-host {
    position: relative;
  }

  .weather-panel {
    display: grid;
    gap: 0.5rem;
  }

  .weather-panel p {
    margin: 0;
  }

  .weather-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .weather-hint {
    font-size: 0.85rem;
    opacity: 0.75;
  }

  /* Só em teste: forçar o clima. */
  .weather-dev {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.25rem;
  }

  .weather-dev .icon-btn {
    width: 44px;
    height: 44px;
    padding: 0;
  }

  .config {
    display: grid;
    gap: 0.75rem;
    min-height: 0;
    flex: 1;
  }

  .config-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .config-head h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  .config-close {
    min-width: 44px;
    flex: none;
    padding-left: 0.45rem;
    padding-right: 0.45rem;
  }

  .mute-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .config-spacer {
    flex: 1;
    min-height: 1rem;
  }

  .config-logout {
    width: 100%;
    color: #fff;
    background: var(--danger);
    text-shadow: 0 var(--px) 0 #801818;
    box-shadow: inset 0 -3px 0 #801818;
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
    box-shadow: inset 0 -3px 0 var(--accent-shade);
    appearance: none;
  }

  .volume-range::-moz-range-thumb {
    box-sizing: border-box;
    width: 18px;
    height: 26px;
    border: 3px solid var(--ink);
    border-radius: 0;
    background: var(--accent);
    box-shadow: inset 0 -3px 0 var(--accent-shade);
  }

  /* Celular: perfil em cima; ações embaixo à esquerda. */
  @media (max-width: 420px) {
    .hud {
      flex-wrap: wrap;
      row-gap: 0.45rem;
    }

    .hud-trainer {
      order: 0;
      flex: 1 1 100%;
    }

    .hud-sep {
      order: 1;
      width: 100%;
      height: 1px;
      margin: 0;
    }

    .hud-actions {
      order: 2;
    }

    .hud .icon-btn {
      flex: none;
      width: 48px;
      height: 48px;
      min-width: 48px;
      min-height: 48px;
    }
  }

  /* Pokédex: tela cheia no celular; painel à direita no PC. */
  .pokedex-shell {
    position: fixed;
    z-index: 50;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    pointer-events: none;
    visibility: hidden;
  }

  .pokedex-shell.open {
    pointer-events: auto;
    visibility: visible;
  }

  .pokedex-shell :global(.pokedex) {
    flex: 1;
    min-height: 0;
  }

  @media (max-width: 899px) {
    .meadow.pokedex-open .garden-layer,
    .meadow.pokedex-open .top-chrome,
    .meadow.pokedex-open .docks,
    .meadow.pokedex-open .world,
    .meadow.pokedex-open .update-banner {
      display: none !important;
    }
  }

  @media (min-width: 900px) {
    .pokedex-shell {
      inset: auto;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(420px, 100%);
      transform: translateX(100%);
      visibility: visible;
      transition: transform 0.2s ease;
      box-shadow: -4px 0 0 #00000022;
    }

    .pokedex-shell.open {
      transform: translateX(0);
    }

    @media (prefers-reduced-motion: reduce) {
      .pokedex-shell {
        transition: none;
      }
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

  .top-chrome {
    display: contents;
  }

  .ready-banner {
    position: relative;
    z-index: 8;
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
