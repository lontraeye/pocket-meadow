<script lang="ts">
  import { onMount } from 'svelte'
  import type { PlaceView } from './api'

  /**
   * Mapa da região (JORNADA.md, seção 11): lugares na geografia, ligados por
   * linhas. Você marcado; visitados cheios; fechados apagados. Toque num vizinho
   * aberto viaja. Desenho provisório em SVG, até a arte do mapa.
   */
  let {
    places,
    current,
    pending,
    onTravel,
    onClose,
  }: {
    places: PlaceView[]
    current: string
    pending: boolean
    onTravel: (slug: string) => void
    onClose: () => void
  } = $props()

  const CELL = 44
  const PAD = 34

  const bySlug = $derived(new Map(places.map((place) => [place.slug, place])))
  const here = $derived(bySlug.get(current) ?? null)
  const neighbors = $derived(new Map((here?.links ?? []).map((link) => [link.to, link])))
  const minX = $derived(Math.min(...places.map((place) => place.x)))
  const minY = $derived(Math.min(...places.map((place) => place.y)))
  const width = $derived((Math.max(...places.map((place) => place.x)) - minX) * CELL + PAD * 2)
  const height = $derived((Math.max(...places.map((place) => place.y)) - minY) * CELL + PAD * 2)

  // Cada ligação uma vez (os dois lados listam a mesma).
  const edges = $derived.by(() => {
    const seen = new Set<string>()
    const out: { a: PlaceView; b: PlaceView; open: boolean }[] = []
    for (const place of places) {
      for (const link of place.links) {
        const key = [place.slug, link.to].sort().join('|')
        const other = bySlug.get(link.to)
        if (seen.has(key) || !other) continue
        seen.add(key)
        out.push({ a: place, b: other, open: link.open && place.open })
      }
    }
    return out
  })

  let selected = $state<string | null>(null)
  const info = $derived(selected ? (bySlug.get(selected) ?? null) : null)
  const infoLink = $derived(selected ? (neighbors.get(selected) ?? null) : null)

  let scroller = $state<HTMLDivElement | null>(null)

  const px = (place: PlaceView) => (place.x - minX) * CELL + PAD
  const py = (place: PlaceView) => (place.y - minY) * CELL + PAD

  // Abre centrado em você.
  onMount(() => {
    if (!scroller || !here) return
    scroller.scrollLeft = px(here) - scroller.clientWidth / 2
    scroller.scrollTop = py(here) - scroller.clientHeight / 2
  })

  function showLabel(place: PlaceView): boolean {
    return place.kind === 'town' || place.slug === current || neighbors.has(place.slug) || place.slug === selected
  }

  function tap(place: PlaceView) {
    selected = place.slug
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose()
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="map-overlay" role="dialog" aria-modal="true" aria-label="Mapa de Johto">
  <div class="map-panel panel">
    <header>
      <h2>Mapa de Johto</h2>
      <button type="button" class="btn close" aria-label="Fechar mapa" onclick={onClose}>✕</button>
    </header>
    <div class="map-scroll" bind:this={scroller}>
      <svg class="map" {width} {height} viewBox="0 0 {width} {height}" role="group" aria-label="Lugares">
        {#each edges as edge (`${edge.a.slug}|${edge.b.slug}`)}
          <line
            x1={px(edge.a)}
            y1={py(edge.a)}
            x2={px(edge.b)}
            y2={py(edge.b)}
            class="edge"
            class:closed={!edge.open}
          />
        {/each}
        {#each places as place (place.slug)}
          {@const here_ = place.slug === current}
          {@const near = neighbors.get(place.slug)}
          <g
            class="node {place.kind}"
            class:current={here_}
            class:visited={place.visited}
            class:closed={!place.open}
            class:near={near?.open}
            class:picked={place.slug === selected}
            transform="translate({px(place)} {py(place)})"
            role="button"
            tabindex="0"
            aria-label="{place.name}{here_ ? ' (você está aqui)' : ''}{place.open ? '' : ` · ${place.reason}`}"
            onclick={() => tap(place)}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                tap(place)
              }
            }}
          >
            <!-- Alvo de toque maior que o desenho. -->
            <rect class="hit" x="-20" y="-20" width="40" height="40" />
            {#if place.kind === 'town'}
              <rect class="dot" x="-9" y="-9" width="18" height="18" />
            {:else}
              <circle class="dot" r="8" />
            {/if}
            {#if here_}<circle class="ring" r="14" />{/if}
            {#if showLabel(place)}
              <text class="label" y="24">{place.name}</text>
            {/if}
          </g>
        {/each}
      </svg>
    </div>
    <footer class="info">
      {#if info}
        <p>
          <strong>{info.name}</strong>
          {#if info.wildLevelRange} · Nv {info.wildLevelRange[0]}–{info.wildLevelRange[1]}{/if}
          {#if info.speciesTotal > 0} · {info.speciesCaught}/{info.speciesTotal} espécies{/if}
        </p>
        {#if info.slug === current}
          <p class="hint">Você está aqui.</p>
        {:else if infoLink?.open}
          <button type="button" class="btn btn-primary" disabled={pending} onclick={() => onTravel(info.slug)}>
            Ir para {info.name}
          </button>
        {:else if infoLink}
          <p class="hint">{infoLink.reason}</p>
        {:else if !info.open}
          <p class="hint">{info.reason}</p>
        {:else}
          <p class="hint">Longe daqui: chegue pelos lugares vizinhos.</p>
        {/if}
      {:else}
        <p class="hint">Toque num lugar. Dá para ir só aos vizinhos de onde você está.</p>
      {/if}
    </footer>
  </div>
</div>

<style>
  .map-overlay {
    position: fixed;
    z-index: 45;
    inset: 0;
    display: grid;
    place-items: center;
    padding:
      calc(env(safe-area-inset-top) + 0.5rem)
      calc(env(safe-area-inset-right) + 0.5rem)
      calc(env(safe-area-inset-bottom) + 0.5rem)
      calc(env(safe-area-inset-left) + 0.5rem);
    background: #00000066;
  }

  .map-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 0.5rem;
    box-sizing: border-box;
    width: min(100%, 560px);
    /* Altura da tela (100% do grid não limita): a faixa de baixo sempre aparece. */
    height: min(
      calc(100dvh - 1rem - env(safe-area-inset-top) - env(safe-area-inset-bottom)),
      720px
    );
    padding: 0.6rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  .close {
    min-width: 44px;
    padding: 0;
  }

  .map-scroll {
    overflow: auto;
    overscroll-behavior: contain;
    border: 2px solid var(--panel-edge);
    background: var(--grass, #8fc25a);
    background: color-mix(in srgb, var(--grass-side, #5d8f34) 30%, var(--paper));
    touch-action: pan-x pan-y;
  }

  .map {
    display: block;
  }

  .edge {
    stroke: var(--ink);
    stroke-width: 3;
  }

  .edge.closed {
    stroke: var(--ink-soft);
    stroke-dasharray: 4 4;
    opacity: 0.5;
  }

  .node {
    cursor: pointer;
    outline: none;
  }

  .hit {
    fill: transparent;
  }

  .dot {
    fill: var(--paper);
    stroke: var(--ink);
    stroke-width: 3;
  }

  .node.town .dot {
    fill: var(--panel-face);
  }

  .node.visited .dot {
    fill: var(--ink);
  }

  .node.water .dot {
    fill: #6890f0;
  }

  .node.near .dot {
    stroke: var(--primary);
  }

  .node.closed {
    opacity: 0.4;
  }

  .node.closed .dot {
    stroke-dasharray: 3 3;
    fill: var(--paper);
  }

  .node.current .dot {
    fill: var(--primary);
    stroke: var(--primary-shade);
  }

  .ring {
    fill: none;
    stroke: var(--primary);
    stroke-width: 3;
  }

  .node.picked .dot,
  .node:focus-visible .dot {
    stroke-width: 5;
  }

  .label {
    font-size: 11px;
    font-weight: 700;
    text-anchor: middle;
    fill: var(--ink);
    paint-order: stroke;
    stroke: var(--paper);
    stroke-width: 3px;
    pointer-events: none;
  }

  .info {
    display: grid;
    gap: 0.35rem;
    min-height: 4.5rem;
  }

  .info p {
    margin: 0;
  }

  .info .btn {
    width: 100%;
  }

  .hint {
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
</style>
