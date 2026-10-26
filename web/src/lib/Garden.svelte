<script lang="ts">
  import { untrack } from 'svelte'
  import type { GameState } from './api'

  let { game }: { game: GameState } = $props()

  const columns = 6
  const gridRows = 6
  const baseTileW = 48
  const baseTileH = 24
  const baseSprite = 64
  const unitWidth = ((columns + gridRows) * baseTileW) / 2 + (baseSprite - baseTileW)

  type Walker = {
    id: number
    speciesId: number
    displayName: string
    isShiny: boolean
    col: number
    row: number
    facing: number
  }

  let lawn = $state<HTMLDivElement | null>(null)
  let scale = $state(1)
  let selectedId = $state<number | null>(null)
  let walkers = $state<Walker[]>([])

  const tileW = $derived(baseTileW * scale)
  const tileH = $derived(baseTileH * scale)
  const sprite = $derived(baseSprite * scale)
  const depth = $derived(8 * scale)
  const halfW = $derived(tileW / 2)
  const halfH = $derived(tileH / 2)
  const pad = $derived((sprite - tileW) / 2)
  const originX = $derived(gridRows * halfW + pad)
  const originY = $derived(sprite - halfH)
  const stageW = $derived((columns + gridRows) * halfW + pad * 2)
  const stageH = $derived(originY + (columns + gridRows) * halfH + depth)

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
      facing: 1,
    }))
    walkers = created
    const live = untrack(() => walkers)

    let cancelled = false
    const frames: number[] = []
    const waits: number[] = []

    function wander(walker: Walker) {
      if (cancelled) return
      let col = 0
      let row = 0
      do {
        col = Math.floor(Math.random() * columns)
        row = Math.floor(Math.random() * gridRows)
      } while (col === Math.round(walker.col) && row === Math.round(walker.row))
      const fromCol = walker.col
      const fromRow = walker.row
      const fromX = fromCol - fromRow
      const toX = col - row
      walker.facing = toX >= fromX ? 1 : -1
      const started = performance.now()
      const duration = 2800
      const step = (time: number) => {
        if (cancelled) return
        const progress = Math.min(1, (time - started) / duration)
        walker.col = fromCol + (col - fromCol) * progress
        walker.row = fromRow + (row - fromRow) * progress
        if (progress < 1) frames.push(requestAnimationFrame(step))
        else waits.push(window.setTimeout(() => wander(walker), 1600 + Math.random() * 1400))
      }
      frames.push(requestAnimationFrame(step))
    }

    for (const walker of live) waits.push(window.setTimeout(() => wander(walker), 400))

    return () => {
      cancelled = true
      for (const frame of frames) cancelAnimationFrame(frame)
      for (const wait of waits) clearTimeout(wait)
    }
  })
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
        {@const spot = place(walker.col, walker.row)}
        <button
          class="mon"
          class:selected={selectedId === walker.id}
          style:left="{spot.x}px"
          style:top="{spot.y + halfH - sprite}px"
          style:width="{sprite}px"
          style:height="{sprite}px"
          style:margin-left="{-sprite / 2}px"
          style:z-index={Math.round(walker.col + walker.row) + 1}
          aria-label={walker.displayName}
          onclick={() => (selectedId = walker.id)}
        >
          <span class="shadow" aria-hidden="true"></span>
          <img
            src="/sprites/showdown/{walker.isShiny ? 'shiny/' : ''}{walker.speciesId}.gif"
            alt={walker.displayName}
            style:transform={walker.facing < 0 ? 'scaleX(-1)' : undefined}
          />
        </button>
      {/each}
    </div>
  </div>

  {#if selected}
    <section class="panel sheet" aria-label="Detalhes">
      <div class="portrait">
        <img
          src="/sprites/showdown/{selected.isShiny ? 'shiny/' : ''}{selected.speciesId}.gif"
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
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    touch-action: manipulation;
  }

  .shadow {
    position: absolute;
    left: 25%;
    right: 25%;
    bottom: 2%;
    height: 12%;
    border-radius: 50%;
    background: #00000030;
  }

  .mon img {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: bottom;
  }

  .mon.selected img {
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
