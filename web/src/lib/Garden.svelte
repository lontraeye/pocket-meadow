<script lang="ts">
  import { spriteLoading } from './spriteLoading'
  import { serverClock } from './serverClock.svelte'
  import { formatCountdown } from './time'
  import { untrack } from 'svelte'
  import { api, berryIconSrc, errorText, itemLabel, type ApiError, type GameState, type PlotState } from './api'
  import PmdSprite from './PmdSprite.svelte'
  import PokemonSheet from './PokemonSheet.svelte'
  import { play, playCry } from './sound'
  import { gardenExtent, gardenSprite, preloadPmd, showdownSrc, type PmdAnimName } from './sprites'

  let {
    game,
    onState,
    openPlotIndex = null,
    onPlotOpened,
  }: {
    game: GameState
    onState: () => Promise<void>
    openPlotIndex?: number | null
    onPlotOpened?: () => void
  } = $props()

  let plotIndex = $state<number | null>(null)
  let plotMessage = $state('')
  let plotPending = $state(false)
  let harvestResult = $state<{ berryKey: string; berries: number; seeds: number } | null>(null)
  let confirmUproot = $state(false)
  let selectedId = $state<number | null>(null)

  const plotsByIndex = $derived(new Map(game.plots.map((plot) => [plot.plotIndex, plot])))
  const seedRows = $derived(
    game.inventory.filter((row) => row.itemKey.startsWith('seed:') && row.quantity > 0),
  )

  const clock = serverClock(() => game.now)

  function plotStage(plot: PlotState | undefined): 'empty' | 'planted' | 'growing' | 'ready' {
    if (!plot) return 'empty'
    const now = clock.now()
    if (now >= plot.readyAt) return 'ready'
    const total = Math.max(1, plot.readyAt - plot.plantedAt)
    const progress = (now - plot.plantedAt) / total
    return progress < 0.2 ? 'planted' : 'growing'
  }

  function remainingMs(readyAt: number): number {
    return Math.max(0, readyAt - clock.now())
  }

  function openPlot(index: number) {
    selectedId = null
    plotIndex = index
    plotMessage = ''
    harvestResult = null
    confirmUproot = false
  }

  $effect(() => {
    if (openPlotIndex === null || openPlotIndex === undefined) return
    openPlot(openPlotIndex)
    onPlotOpened?.()
  })

  function closePlot() {
    plotIndex = null
    plotMessage = ''
    harvestResult = null
    confirmUproot = false
  }

  async function plant(berryKey: string) {
    if (plotIndex === null) return
    plotPending = true
    plotMessage = ''
    try {
      const response = await api(`/api/plots/${plotIndex}/plant`, { berryKey })
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError
      if (!response.ok) {
        plotMessage = errorText(payload)
        return
      }
      await onState()
      closePlot()
    } catch {
      plotMessage = 'Sem conexão com o servidor.'
    } finally {
      plotPending = false
    }
  }

  async function advancePlot(body: { minutes: number } | { ready: true }) {
    if (plotIndex === null) return
    plotPending = true
    plotMessage = ''
    try {
      const response = await api('/api/dev/plots/advance', { plotIndex, ...body })
      if (!response.ok) plotMessage = errorText((await response.json().catch(() => ({ error: 'internal' }))) as ApiError)
      await onState()
    } catch {
      plotMessage = 'Sem conexão com o servidor.'
    } finally {
      plotPending = false
    }
  }

  async function uproot() {
    if (plotIndex === null) return
    plotPending = true
    plotMessage = ''
    try {
      const response = await api(`/api/plots/${plotIndex}/uproot`, {})
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & { seedReturned?: boolean }
      confirmUproot = false
      if (!response.ok) {
        plotMessage = errorText(payload)
        return
      }
      await onState()
      plotMessage = payload.seedReturned ? 'Arrancou. A semente voltou para a mochila.' : 'Arrancou. A semente se perdeu.'
    } catch {
      plotMessage = 'Sem conexão com o servidor.'
    } finally {
      plotPending = false
    }
  }

  async function harvest() {
    if (plotIndex === null) return
    plotPending = true
    plotMessage = ''
    try {
      const response = await api(`/api/plots/${plotIndex}/harvest`, {})
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & {
        berryKey?: string
        berries?: number
        seeds?: number
      }
      if (!response.ok) {
        plotMessage = errorText(payload)
        return
      }
      harvestResult = {
        berryKey: String(payload.berryKey ?? ''),
        berries: Number(payload.berries ?? 0),
        seeds: Number(payload.seeds ?? 0),
      }
      play('harvest')
      await onState()
    } catch {
      plotMessage = 'Sem conexão com o servidor.'
    } finally {
      plotPending = false
    }
  }

  const columns = 6
  const gridRows = 6
  const baseTileW = 48
  const baseTileH = 24
  const showdownSize = 64
  const stepMs = 480
  const idleMinMs = 1600
  const idleMaxMs = 3000
  const sleepChance = 0.15
  const sleepMinMs = 20_000
  const sleepMaxMs = 40_000
  // Virar de uma direção para a vizinha (Walk e Idle têm 8) antes de andar
  // numa direção nova, em vez de girar na hora.
  const turnStepMs = 110
  const sleepDir = 0

  // A pose de sono do PMD olha para ↙ em quase todas as espécies. Quem dorme
  // olhando para a direita (↘ → ↗) usa a pose espelhada, para não virar de lado.
  function sleepFlip(walker: Walker): boolean {
    return walker.anim === 'Sleep' && walker.dir >= 1 && walker.dir <= 3
  }

  type Walker = {
    id: number
    speciesId: number
    displayName: string
    isShiny: boolean
    col: number
    row: number
    dir: number
    anim: PmdAnimName
  }

  let lawn = $state<HTMLDivElement | null>(null)
  let scale = $state(1)
  let time = $state(0)
  let walkers = $state<Walker[]>([])
  // Comandos de teste (botão no card em modo dev), ligados pelo $effect do passeio.
  let devCommands: { sleep: (id: number) => void; wake: (id: number) => void } | null = null
  const devTools = import.meta.env.DEV

  type Step = { col: number; row: number; dir: number }

  const tileW = $derived(baseTileW * scale)
  const tileH = $derived(baseTileH * scale)
  const pmdScale = $derived(2 * scale)
  const depth = $derived(8 * scale)
  const halfW = $derived(tileW / 2)
  const halfH = $derived(tileH / 2)

  const gardenPokemon = $derived(
    [...game.pokemon.filter((mon) => mon.location === 'garden')]
      .sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
        return a.id - b.id
      })
      .slice(0, game.gardenMaxVisible),
  )

  const selected = $derived(game.pokemon.find((mon) => mon.id === selectedId) ?? null)
  const selectedAsleep = $derived(walkers.find((walker) => walker.id === selectedId)?.anim === 'Sleep')

  // Quanto os sprites passam do ponto do chão, em px na escala 1. Depende só de
  // quem está no jardim, não da animação atual: senão o palco muda de tamanho
  // quando alguém troca de animação e o jardim inteiro pula.
  const extent = $derived.by(() => {
    const out = { side: 0, up: 0, down: 0 }
    for (const mon of gardenPokemon) {
      const reach = gardenExtent(gardenSprite(mon.speciesId, mon.isShiny))
      out.side = Math.max(out.side, reach.left, reach.right)
      out.up = Math.max(out.up, reach.up)
      out.down = Math.max(out.down, reach.down)
    }
    return out
  })

  const unitWidth = $derived(
    ((columns + gridRows) * baseTileW) / 2 + 2 * Math.max(0, extent.side - baseTileW / 2),
  )
  const padX = $derived(Math.max(0, extent.side * scale - halfW))
  const padTop = $derived(Math.max(0, extent.up * scale - halfH))
  const padBottom = $derived(Math.max(0, extent.down * scale - halfH - depth))

  const originX = $derived(gridRows * halfW + padX)
  const originY = $derived(padTop)
  const stageW = $derived((columns + gridRows) * halfW + padX * 2)
  const stageH = $derived(originY + (columns + gridRows) * halfH + depth + padBottom)

  const tiles = Array.from({ length: columns * gridRows }, (_, index) => ({
    col: index % columns,
    row: Math.floor(index / columns),
  }))

  function place(col: number, row: number): { x: number; y: number } {
    return {
      x: originX + (col - row) * halfW,
      y: originY + (col + row) * halfH,
    }
  }

  $effect(() => {
    const node = lawn
    if (!node) return
    const measure = () => {
      const fit = Math.floor(node.clientWidth / unitWidth)
      scale = Math.min(2, Math.max(1, fit))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  })

  $effect(() => {
    for (const mon of gardenPokemon) {
      const look = gardenSprite(mon.speciesId, mon.isShiny)
      if (look.kind === 'pmd') preloadPmd(mon.speciesId, look.shinySheet)
    }
  })

  $effect(() => {
    const mons = gardenPokemon
    const created = mons.map((mon, index) => ({
      id: mon.id,
      speciesId: mon.speciesId,
      displayName: mon.nickname ?? mon.displayName,
      isShiny: mon.isShiny,
      col: (index % (columns - 1)) + 1,
      row: Math.floor(index / (columns - 1)) + 1,
      dir: 1,
      anim: 'Idle' as const,
    }))
    walkers = created
    const live = untrack(() => walkers)

    let cancelled = false
    const frames: number[] = []
    const waits: number[] = []
    // Cada Pokémon segue um plano (passear, dormir…). Trocar o número do plano
    // faz os timers e frames pendentes do plano antigo pararem sozinhos.
    const plans = new Map<number, number>()
    const alive = (walker: Walker, plan: number) => !cancelled && plans.get(walker.id) === plan

    function canSleep(walker: Walker): boolean {
      // O Sleep só tem a direção 0 (de frente). Só dorme quem já olha para ela
      // ou para uma vizinha (↘ ↙), para a troca não parecer um giro. Dorme
      // direto, sem virar: virar mostraria o Idle de frente para a câmera.
      const facing = (walker.dir - sleepDir + 8) % 8
      return facing <= 1 || facing >= 7
    }

    // Mantém a direção em que estava: o Sleep tem uma pose só, e a direção
    // decide se ela é espelhada (ver sleepFlip) e de onde ele vira ao acordar.
    function sleep(walker: Walker, plan: number) {
      walker.anim = 'Sleep'
      waits.push(
        window.setTimeout(() => wander(walker, plan), sleepMinMs + Math.random() * (sleepMaxMs - sleepMinMs)),
      )
    }

    function wander(walker: Walker, plan: number) {
      if (!alive(walker, plan)) return
      if (canSleep(walker) && Math.random() < sleepChance) {
        sleep(walker, plan)
        return
      }
      let col = 0
      let row = 0
      const hereCol = Math.round(walker.col)
      const hereRow = Math.round(walker.row)
      do {
        col = Math.floor(Math.random() * columns)
        row = Math.floor(Math.random() * gridRows)
      } while (col === hereCol && row === hereRow)
      walkSteps(walker, plan, route(hereCol, hereRow, col, row), () => {
        walker.anim = 'Idle'
        waits.push(
          window.setTimeout(() => wander(walker, plan), idleMinMs + Math.random() * (idleMaxMs - idleMinMs)),
        )
      })
    }

    function walkSteps(walker: Walker, plan: number, steps: Step[], done: () => void) {
      let index = 0
      const next = () => {
        if (!alive(walker, plan)) return
        const step = steps[index]
        if (!step) {
          done()
          return
        }
        index += 1
        turn(walker, plan, step.dir, () => {
          walker.anim = 'Walk'
          const fromCol = walker.col
          const fromRow = walker.row
          const started = performance.now()
          const tick = (now: number) => {
            if (!alive(walker, plan)) return
            const progress = Math.min(1, (now - started) / stepMs)
            walker.col = fromCol + (step.col - fromCol) * progress
            walker.row = fromRow + (step.row - fromRow) * progress
            if (progress < 1) frames.push(requestAnimationFrame(tick))
            else next()
          }
          frames.push(requestAnimationFrame(tick))
        })
      }
      next()
    }

    // Gira parado (Idle), uma direção vizinha por vez, pelo lado mais curto.
    // Se já está olhando para lá, segue direto, sem interromper o Walk.
    function turn(walker: Walker, plan: number, target: number, done: () => void) {
      if (!alive(walker, plan)) return
      if (walker.dir === target) {
        done()
        return
      }
      const clockwise = (target - walker.dir + 8) % 8
      walker.anim = 'Idle'
      walker.dir = (walker.dir + (clockwise <= 4 ? 1 : 7)) % 8
      waits.push(window.setTimeout(() => turn(walker, plan, target, done), turnStepMs))
    }

    function start(walker: Walker, delay: number) {
      const plan = (plans.get(walker.id) ?? 0) + 1
      plans.set(walker.id, plan)
      waits.push(window.setTimeout(() => wander(walker, plan), delay))
    }

    // Só para testes: termina o passo atual, anda até ficar olhando para ↘ ou
    // ↙ e dorme.
    const sleepNow = (id: number) => {
      const walker = live.find((item) => item.id === id)
      if (!walker) return
      const plan = (plans.get(walker.id) ?? 0) + 1
      plans.set(walker.id, plan)

      // No meio de um passo, a posição é fracionada: o destino do passo é o
      // bloco seguinte na direção em que ele está andando.
      let col = walker.col
      let row = walker.row
      if (walker.dir === 1) col = Math.ceil(col)
      else if (walker.dir === 5) col = Math.floor(col)
      else if (walker.dir === 7) row = Math.ceil(row)
      else if (walker.dir === 3) row = Math.floor(row)
      col = Math.round(col)
      row = Math.round(row)
      const steps: Step[] = []
      if (col !== walker.col || row !== walker.row) steps.push({ col, row, dir: walker.dir })

      // Terminar o passo não muda a direção, então dá para checar já.
      if (!canSleep(walker)) {
        if (col < columns - 1) steps.push({ col: col + 1, row, dir: 1 })
        else if (row < gridRows - 1) steps.push({ col, row: row + 1, dir: 7 })
        else steps.push({ col: col - 1, row, dir: 5 }, { col, row, dir: 1 })
      }
      walkSteps(walker, plan, steps, () => sleep(walker, plan))
    }

    // Só para testes: acorda e volta a passear.
    const wakeNow = (id: number) => {
      const walker = live.find((item) => item.id === id)
      if (!walker) return
      walker.anim = 'Idle'
      start(walker, idleMinMs)
    }

    devCommands = { sleep: sleepNow, wake: wakeNow }

    for (const walker of live) start(walker, 400)

    return () => {
      cancelled = true
      devCommands = null
      for (const frame of frames) cancelAnimationFrame(frame)
      for (const wait of waits) clearTimeout(wait)
    }
  })

  $effect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const loop = (now: number) => {
      time = now
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  })

  function route(fromCol: number, fromRow: number, toCol: number, toRow: number) {
    const steps: Step[] = []
    let col = fromCol
    let row = fromRow
    const colDelta = Math.sign(toCol - col)
    const rowDelta = Math.sign(toRow - row)
    while (col !== toCol) {
      col += colDelta
      steps.push({ col, row, dir: colDelta > 0 ? 1 : 5 })
    }
    while (row !== toRow) {
      row += rowDelta
      steps.push({ col, row, dir: rowDelta > 0 ? 7 : 3 })
    }
    return steps
  }
</script>

<div class="layout">
  <div class="lawn" bind:this={lawn} aria-label="Jardim">
    <div class="stage" style:width="{stageW}px" style:height="{stageH}px">
      {#each tiles as tile (`${tile.col}-${tile.row}`)}
        {@const spot = place(tile.col, tile.row)}
        {@const isPlot = tile.row === gridRows - 1 && tile.col < game.plotSlotsUnlocked}
        {@const plot = isPlot ? plotsByIndex.get(tile.col) : undefined}
        {@const stage = isPlot ? plotStage(plot) : null}
        {#if isPlot}
          <button
            type="button"
            class="tile plot"
            class:alt={(tile.col + tile.row) % 2 === 1}
            class:planted={stage === 'planted'}
            class:growing={stage === 'growing'}
            class:ready={stage === 'ready'}
            style:left="{spot.x}px"
            style:top="{spot.y}px"
            style:width="{tileW}px"
            style:height="{tileH + depth}px"
            style:--half="{halfH}px"
            style:--depth="{depth}px"
            style:margin-left="{-halfW}px"
            style:z-index={tile.col + tile.row}
            aria-label={`Canteiro ${tile.col + 1}`}
            onclick={() => openPlot(tile.col)}
          >
            {#if stage === 'planted'}
              <span class="crop sprout" aria-hidden="true"></span>
            {:else if stage === 'growing'}
              <span class="crop bush" aria-hidden="true"></span>
            {:else if stage === 'ready' && plot}
              <img class="crop berry" src={berryIconSrc(plot.berryKey)} alt="" />
            {/if}
          </button>
        {:else}
          <div
            class="tile"
            class:alt={(tile.col + tile.row) % 2 === 1}
            style:left="{spot.x}px"
            style:top="{spot.y}px"
            style:width="{tileW}px"
            style:height="{tileH + depth}px"
            style:--half="{halfH}px"
            style:--depth="{depth}px"
            style:margin-left="{-halfW}px"
            style:z-index={tile.col + tile.row}
          ></div>
        {/if}
      {/each}
      {#each walkers as walker (walker.id)}
        {@const look = gardenSprite(walker.speciesId, walker.isShiny)}
        {@const spot = place(walker.col, walker.row)}
        <!-- O botão é o ponto do chão (centro do bloco); o sprite cresce a partir dele. -->
        <button
          class="mon"
          class:selected={selectedId === walker.id}
          style:left="{spot.x}px"
          style:top="{spot.y + halfH}px"
          style:--size="{showdownSize * scale}px"
          style:z-index={Math.round(walker.col + walker.row) + 1}
          aria-label={walker.displayName}
          onclick={() => {
            selectedId = walker.id
            playCry(walker.speciesId)
          }}
        >
          {#if look.kind === 'pmd'}
            <PmdSprite
              speciesId={walker.speciesId}
              shiny={look.shinySheet}
              anim={walker.anim}
              dir={walker.dir}
              scale={pmdScale}
              shadow={look.shadow}
              flip={sleepFlip(walker)}
              {time}
            >
              {#if look.sparkle}<span class="sparkle"></span>{/if}
            </PmdSprite>
          {:else}
            <span class="shadow" aria-hidden="true"></span>
            <img
              use:spriteLoading={showdownSrc(walker.speciesId, walker.isShiny)}
              src={showdownSrc(walker.speciesId, walker.isShiny)}
              alt=""
              style:transform={walker.dir === 5 || walker.dir === 7 ? 'scaleX(-1)' : undefined}
            />
          {/if}
        </button>
      {/each}
    </div>
  </div>

  {#if plotIndex !== null}
    {@const plot = plotsByIndex.get(plotIndex)}
    {@const stage = plotStage(plot)}
    {@const berry = plot ? game.berries.find((row) => row.key === plot.berryKey) : null}
    <div class="details plot-sheet">
      <section class="panel sheet" aria-label="Canteiro">
        <header class="sheet-head">
          <h2>Canteiro {plotIndex + 1}</h2>
          <button type="button" class="btn" onclick={closePlot}>Fechar</button>
        </header>
        {#if plotMessage}<p class="alert" role="status">{plotMessage}</p>{/if}
        {#if harvestResult}
          <p class="good">
            Colheu {harvestResult.berries} {itemLabel(`berry:${harvestResult.berryKey}`, game.berries)}
            e {harvestResult.seeds} semente{harvestResult.seeds === 1 ? '' : 's'}.
          </p>
          <button type="button" class="btn btn-primary" onclick={closePlot}>Ok</button>
        {:else if stage === 'empty'}
          <p class="hint">Escolha uma semente para plantar.</p>
          {#if seedRows.length === 0}
            <p class="hint">Sem sementes na mochila.</p>
          {:else}
            <ul class="seed-list">
              {#each seedRows as row (row.itemKey)}
                {@const key = row.itemKey.slice(5)}
                {@const info = game.berries.find((berry) => berry.key === key)}
                <li>
                  <button type="button" class="btn choice" disabled={plotPending} onclick={() => void plant(key)}>
                    <img src={berryIconSrc(key)} alt="" width="28" height="28" />
                    <span>{itemLabel(row.itemKey, game.berries)} ×{row.quantity}</span>
                    {#if info}<small>{Math.round(info.growMs / 60000)} min</small>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {:else if plot && (stage === 'planted' || stage === 'growing')}
          {@const left = remainingMs(plot.readyAt)}
          {@const total = Math.max(1, plot.readyAt - plot.plantedAt)}
          {@const progress = Math.min(1, 1 - left / total)}
          <p class="hint">{berry?.name ?? plot.berryKey} crescendo…</p>
          <div class="bar" aria-hidden="true"><span style:width="{progress * 100}%"></span></div>
          <p class="timer">{formatCountdown(left)}</p>
          {#if game.devTools}
            <div class="dev-row">
              <button type="button" class="btn" disabled={plotPending} onclick={() => void advancePlot({ minutes: 10 })}>+10 min (teste)</button>
              <button type="button" class="btn" disabled={plotPending} onclick={() => void advancePlot({ ready: true })}>Pronta agora (teste)</button>
            </div>
          {/if}
          {#if confirmUproot}
            <p class="hint">
              Arrancar antes de ficar pronta tem {Math.round((1 - game.uprootSeedReturnChance) * 100)}% de chance de
              perder a semente.
            </p>
            <button type="button" class="btn" disabled={plotPending} onclick={() => void uproot()}>Arrancar mesmo assim</button>
            <button type="button" class="btn" disabled={plotPending} onclick={() => (confirmUproot = false)}>Cancelar</button>
          {:else}
            <button type="button" class="btn" disabled={plotPending} onclick={() => (confirmUproot = true)}>Arrancar</button>
          {/if}
        {:else if plot && stage === 'ready'}
          <p class="hint">{berry?.name ?? plot.berryKey} pronta.</p>
          <button type="button" class="btn btn-primary" disabled={plotPending} onclick={() => void harvest()}>
            Colher
          </button>
        {/if}
      </section>
    </div>
  {:else if selected}
    <div class="details">
      <PokemonSheet
        {game}
        mon={selected}
        dev={devTools
          ? {
              asleep: selectedAsleep,
              toggle: () => {
                if (!selected) return
                if (selectedAsleep) devCommands?.wake(selected.id)
                else devCommands?.sleep(selected.id)
              },
            }
          : null}
        onClose={() => (selectedId = null)}
        {onState}
      />
    </div>
  {:else}
    <p class="hint">Toque em um Pokémon ou canteiro.</p>
  {/if}
</div>

<style>
  .layout {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
  }

  .lawn {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    min-height: 16rem;
    overflow: hidden;
  }

  .stage {
    position: relative;
    flex: none;
  }

  /* Bloco isométrico: losango de cima + duas laterais. */
  .tile {
    --top: var(--grass-1);
    --left: var(--grass-side);
    --right: #6ea44b;
    position: absolute;
    background: var(--left);
    clip-path: polygon(
      50% 0,
      100% var(--half),
      100% calc(var(--half) + var(--depth)),
      50% 100%,
      0 calc(var(--half) + var(--depth)),
      0 var(--half)
    );
  }

  .tile.alt {
    --top: var(--grass-2);
  }

  .tile.plot {
    --top: var(--soil);
    --left: #7a5530;
    --right: #93683c;
    padding: 0;
    border: 0;
    cursor: pointer;
    touch-action: manipulation;
  }

  .tile.plot:focus-visible {
    outline: var(--px) dashed var(--ink);
    outline-offset: 2px;
  }

  .crop {
    position: absolute;
    left: 50%;
    top: calc(var(--half) * 0.35);
    z-index: 2;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .dev-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .crop.sprout {
    width: 10px;
    height: 14px;
    background: #5f9e3a;
    clip-path: polygon(50% 0, 100% 70%, 70% 100%, 30% 100%, 0 70%);
  }

  .crop.bush {
    width: 18px;
    height: 16px;
    background: #4f8a32;
    border-radius: 40% 40% 20% 20%;
    box-shadow: 6px 4px 0 #3f7228, -6px 4px 0 #3f7228;
  }

  .crop.berry {
    width: 22px;
    height: 22px;
    image-rendering: pixelated;
  }

  @media (prefers-reduced-motion: no-preference) {
    .tile.ready .crop.berry {
      animation: berry-bob 1.4s ease-in-out infinite;
    }
  }

  @keyframes berry-bob {
    0%,
    100% {
      transform: translateX(-50%) translateY(0);
    }
    50% {
      transform: translateX(-50%) translateY(-3px);
    }
  }

  .tile::before,
  .tile::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .tile::after {
    background: var(--right);
    clip-path: polygon(50% calc(var(--half) * 2), 100% var(--half), 100% calc(var(--half) + var(--depth)), 50% 100%);
  }

  .tile::before {
    z-index: 1;
    background: var(--top);
    clip-path: polygon(50% 0, 100% var(--half), 50% calc(var(--half) * 2), 0 var(--half));
  }

  .tile.plot::before {
    background:
      repeating-linear-gradient(90deg, #00000018 0 4px, transparent 4px 8px),
      var(--top);
  }

  .mon {
    position: absolute;
    width: 0;
    height: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    touch-action: manipulation;
  }

  .mon:focus-visible {
    outline: none;
  }

  /* Só o fallback do Showdown; a sombra do PMD fica no PmdSprite. */
  .shadow {
    position: absolute;
    left: calc(var(--size) * -0.25);
    top: calc(var(--size) * -0.06);
    width: calc(var(--size) * 0.5);
    height: calc(var(--size) * 0.12);
    border-radius: 50%;
    background: #00000030;
    pointer-events: none;
  }

  .sparkle {
    position: absolute;
    top: 6%;
    right: 10%;
    width: 4px;
    height: 4px;
    background: #fff4a8;
    box-shadow: 2px 0 0 #e0a800;
    animation: spark 2.8s steps(1, end) infinite;
    pointer-events: none;
  }

  @keyframes spark {
    0%,
    78% {
      opacity: 0;
    }
    79%,
    100% {
      opacity: 1;
    }
  }

  .mon img {
    position: absolute;
    left: calc(var(--size) * -0.5);
    top: calc(var(--size) * -1);
    display: block;
    width: var(--size);
    height: var(--size);
    object-fit: contain;
    object-position: bottom;
  }

  .mon.selected img,
  .mon.selected :global(.sprite),
  .mon:focus-visible img,
  .mon:focus-visible :global(.sprite) {
    filter: drop-shadow(2px 0 0 #fff) drop-shadow(-2px 0 0 #fff) drop-shadow(0 2px 0 #fff) drop-shadow(0 -2px 0 #fff);
  }

  .hint {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    margin: 0;
    color: var(--ink-soft);
    font-weight: 600;
  }

  .plot-sheet .sheet {
    display: grid;
    gap: 0.5rem;
  }

  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .sheet-head h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  .seed-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }

  .seed-list .choice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 44px;
    text-align: left;
  }

  .seed-list img {
    image-rendering: pixelated;
  }

  .seed-list span {
    flex: 1;
    min-width: 0;
  }

  .bar {
    height: 12px;
    background: #00000022;
    box-shadow: inset 0 0 0 var(--px) #00000033;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .timer {
    margin: 0;
    font-weight: 700;
  }

  .good,
  .alert {
    margin: 0;
  }

  .good {
    font-weight: 700;
  }

  @media (min-width: 800px) {
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 20rem;
      align-items: start;
    }

    .details {
      position: sticky;
      top: 1rem;
      min-width: 0;
    }
  }
</style>
