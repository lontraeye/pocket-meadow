<script lang="ts">
  import { untrack } from 'svelte'
  import type { GameState } from './api'
  import PmdSprite from './PmdSprite.svelte'
  import { gardenExtent, gardenSprite, showdownSrc, type PmdAnimName } from './sprites'

  let { game }: { game: GameState } = $props()

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
  let selectedId = $state<number | null>(null)
  let walkers = $state<Walker[]>([])

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
  const selectedCandies = $derived(
    selected === null
      ? 0
      : (game.candies.find((row) => row.evolutionChainId === selected.evolutionChainId)?.amount ?? 0),
  )

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

    function wander(walker: Walker) {
      if (cancelled) return
      if (Math.random() < sleepChance) {
        walker.anim = 'Sleep'
        waits.push(
          window.setTimeout(
            () => wander(walker),
            sleepMinMs + Math.random() * (sleepMaxMs - sleepMinMs),
          ),
        )
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
      const steps = route(hereCol, hereRow, col, row)
      let index = 0
      const next = () => {
        if (cancelled) return
        const step = steps[index]
        if (!step) {
          walker.anim = 'Idle'
          waits.push(
            window.setTimeout(() => wander(walker), idleMinMs + Math.random() * (idleMaxMs - idleMinMs)),
          )
          return
        }
        index += 1
        walker.anim = 'Walk'
        walker.dir = step.dir
        const fromCol = walker.col
        const fromRow = walker.row
        const started = performance.now()
        const tick = (now: number) => {
          if (cancelled) return
          const progress = Math.min(1, (now - started) / stepMs)
          walker.col = fromCol + (step.col - fromCol) * progress
          walker.row = fromRow + (step.row - fromRow) * progress
          if (progress < 1) frames.push(requestAnimationFrame(tick))
          else next()
        }
        frames.push(requestAnimationFrame(tick))
      }
      next()
    }

    for (const walker of live) waits.push(window.setTimeout(() => wander(walker), 400))

    return () => {
      cancelled = true
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
    const steps: { col: number; row: number; dir: number }[] = []
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
        <div
          class="tile"
          class:alt={(tile.col + tile.row) % 2 === 1}
          class:plot={tile.row === gridRows - 1 && tile.col < game.plotSlots}
          style:left="{spot.x}px"
          style:top="{spot.y}px"
          style:width="{tileW}px"
          style:height="{tileH + depth}px"
          style:--half="{halfH}px"
          style:--depth="{depth}px"
          style:margin-left="{-halfW}px"
          style:z-index={tile.col + tile.row}
        ></div>
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
          onclick={() => (selectedId = walker.id)}
        >
          {#if look.kind === 'pmd'}
            <PmdSprite
              speciesId={walker.speciesId}
              shiny={look.shinySheet}
              anim={walker.anim}
              dir={walker.dir}
              scale={pmdScale}
              shadow={look.shadow}
              {time}
            >
              {#if look.sparkle}<span class="sparkle"></span>{/if}
            </PmdSprite>
          {:else}
            <span class="shadow" aria-hidden="true"></span>
            <img
              src={showdownSrc(walker.speciesId, walker.isShiny)}
              alt=""
              style:transform={walker.dir === 5 || walker.dir === 7 ? 'scaleX(-1)' : undefined}
            />
          {/if}
        </button>
      {/each}
    </div>
  </div>

  {#if selected}
    <section class="panel sheet" aria-label="Detalhes">
      <div class="portrait">
        <img
          src={showdownSrc(selected.speciesId, selected.isShiny)}
          alt=""
        />
      </div>
      <div class="info">
        <h2>
          {selected.nickname ?? selected.displayName}
          {#if selected.isShiny}<span class="shiny" title="Shiny">★</span>{/if}
        </h2>
        <p class="lv">Nv {selected.level}</p>
        <div class="xp">
          {#if selected.xpToNext === null}
            <span>XP no máximo</span>
          {:else}
            <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={selected.xpToNext} aria-valuenow={selected.xp}>
              <span style:width="{Math.min(100, (selected.xp / selected.xpToNext) * 100)}%"></span>
            </div>
            <small>XP {selected.xp}/{selected.xpToNext}</small>
          {/if}
        </div>
        <p class="candy">Doces da linha: <strong>{selectedCandies}</strong></p>
      </div>
      <button type="button" class="btn close" aria-label="Fechar" onclick={() => (selectedId = null)}>✕</button>
    </section>
  {:else}
    <p class="hint">Toque em um Pokémon para ver os detalhes.</p>
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

  .sheet {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    align-items: center;
    padding-right: 3.25rem;
  }

  .portrait {
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    border: 8px solid transparent;
    border-image: url('/ui/inlay.png') 4 fill / 8px round;
  }

  .portrait img {
    max-width: 96px;
    max-height: 96px;
  }

  .info {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 1.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shiny {
    color: #e0a800;
  }

  p {
    margin: 0;
  }

  .lv {
    font-weight: 600;
    color: var(--ink-soft);
  }

  .xp {
    display: grid;
    gap: 0.1rem;
  }

  .bar {
    height: 10px;
    background: #00000025;
    box-shadow: inset 0 0 0 var(--px) var(--ink);
  }

  .bar span {
    display: block;
    height: 100%;
    background: #4aa3e0;
    box-shadow: inset 0 calc(var(--px) * -2) 0 #2f7bb0, inset 0 0 0 var(--px) var(--ink);
  }

  .xp small,
  .candy {
    font-size: 15px;
  }

  .close {
    position: absolute;
    top: 0;
    right: 0;
    padding: 0;
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

  @media (min-width: 800px) {
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 20rem;
      align-items: start;
    }

    .sheet {
      position: sticky;
      top: 1rem;
    }
  }
</style>
