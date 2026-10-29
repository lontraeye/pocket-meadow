<script lang="ts">
  import type { PlaceView } from './api'

  /**
   * O mapa é a tela da exploração (JORNADA.md, seção 11): lugares na
   * geografia, ligados por linhas. O marcador desliza até o lugar novo e o mapa
   * centraliza em você. Tocar seleciona; quem viaja é o painel de baixo.
   * Desenho provisório em SVG, até a arte do mapa.
   */
  let {
    places,
    current,
    selected,
    onSelect,
    onActivate,
  }: {
    places: PlaceView[]
    current: string
    selected: string
    onSelect: (slug: string) => void
    /** Toque duplo no mesmo lugar (ex.: viajar direto para o vizinho). */
    onActivate: (slug: string) => void
  } = $props()

  // Toque duplo pelo intervalo entre dois toques: o dblclick não é confiável no celular.
  const DOUBLE_TAP_MS = 350
  let lastTap = { slug: '', at: 0 }

  function tap(slug: string) {
    const now = performance.now()
    const double = lastTap.slug === slug && now - lastTap.at < DOUBLE_TAP_MS
    lastTap = double ? { slug: '', at: 0 } : { slug, at: now }
    if (double) onActivate(slug)
    else onSelect(slug)
  }

  const CELL = 56
  const PAD = 48

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
    const out: { key: string; a: PlaceView; b: PlaceView; open: boolean; mine: boolean }[] = []
    for (const place of places) {
      for (const link of place.links) {
        const key = [place.slug, link.to].sort().join('|')
        const other = bySlug.get(link.to)
        if (seen.has(key) || !other) continue
        seen.add(key)
        const mine = place.slug === current || link.to === current
        out.push({ key, a: place, b: other, open: link.open && place.open && other.open, mine })
      }
    }
    return out
  })

  const px = (place: PlaceView) => (place.x - minX) * CELL + PAD
  const py = (place: PlaceView) => (place.y - minY) * CELL + PAD

  let scroller = $state<HTMLDivElement | null>(null)
  let first = true

  // Centraliza em você ao abrir (na hora) e a cada viagem (deslizando).
  $effect(() => {
    const place = here
    const el = scroller
    if (!place || !el) return
    const left = px(place) - el.clientWidth / 2
    const top = py(place) - el.clientHeight / 2
    el.scrollTo({ left, top, behavior: first ? 'instant' : 'smooth' })
    first = false
  })

  function showLabel(place: PlaceView): boolean {
    return (
      place.kind === 'town' ||
      place.slug === current ||
      place.slug === selected ||
      (neighbors.has(place.slug) && place.open)
    )
  }
</script>

<div class="map-scroll" bind:this={scroller}>
  <svg class="map" {width} {height} viewBox="0 0 {width} {height}" role="group" aria-label="Mapa de Johto">
    {#each edges as edge (edge.key)}
      <line
        x1={px(edge.a)}
        y1={py(edge.a)}
        x2={px(edge.b)}
        y2={py(edge.b)}
        class="edge"
        class:closed={!edge.open}
        class:mine={edge.mine && edge.open}
      />
    {/each}
    {#each places as place (place.slug)}
      {@const near = neighbors.get(place.slug)}
      <g
        class="node {place.kind}"
        class:visited={place.visited}
        class:closed={!place.open}
        class:near={near?.open}
        class:picked={place.slug === selected}
        transform="translate({px(place)} {py(place)})"
        role="button"
        tabindex="0"
        aria-label="{place.name}{place.slug === current ? ' (você está aqui)' : ''}{place.open ? '' : ` · ${place.reason}`}"
        aria-pressed={place.slug === selected}
        onclick={() => tap(place.slug)}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(place.slug)
          }
        }}
      >
        <!-- Alvo de toque de 48px, maior que o desenho. -->
        <rect class="hit" x="-24" y="-24" width="48" height="48" />
        {#if place.kind === 'town'}
          <rect class="dot" x="-11" y="-11" width="22" height="22" />
          <rect class="roof" x="-11" y="-11" width="22" height="6" />
        {:else}
          <circle class="dot" r="10" />
        {/if}
        {#if near?.isNew}<circle class="new" cx="11" cy="-11" r="5" />{/if}
        {#if showLabel(place)}
          <text class="label" y="28">{place.name}</text>
        {/if}
      </g>
    {/each}
    <!-- Você: desliza até o lugar novo ao viajar. -->
    {#if here}
      <g class="me" style:transform="translate({px(here)}px, {py(here)}px)" aria-hidden="true">
        <circle class="me-ring" r="17" />
        <circle class="me-dot" r="6" />
      </g>
    {/if}
  </svg>
</div>

<style>
  .map-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    border: 2px solid var(--panel-edge);
    background: color-mix(in srgb, var(--grass-side, #5d8f34) 32%, var(--paper));
    box-shadow: inset 0 2px 0 #00000022;
    touch-action: pan-x pan-y;
    scrollbar-width: none;
  }

  .map-scroll::-webkit-scrollbar {
    display: none;
  }

  .map {
    display: block;
  }

  .edge {
    stroke: color-mix(in srgb, var(--ink) 70%, transparent);
    stroke-width: 6;
    stroke-linecap: round;
  }

  .edge.mine {
    stroke: var(--primary);
  }

  .edge.closed {
    stroke: var(--ink-soft);
    stroke-width: 3;
    stroke-dasharray: 5 6;
    opacity: 0.45;
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

  .node.visited .dot {
    fill: color-mix(in srgb, var(--ink) 22%, var(--paper));
  }

  .roof {
    fill: var(--danger, #c03028);
  }

  .node.water .dot {
    fill: #6890f0;
  }

  .node.near .dot {
    stroke: var(--primary);
  }

  .node.closed {
    opacity: 0.38;
  }

  .node.closed .dot {
    stroke-dasharray: 3 3;
  }

  .node.picked .dot,
  .node:focus-visible .dot {
    stroke-width: 5;
    stroke: var(--selected, var(--primary));
  }

  .new {
    fill: var(--accent);
    stroke: var(--ink);
    stroke-width: 2;
  }

  .label {
    font-size: 12px;
    font-weight: 700;
    text-anchor: middle;
    fill: var(--ink);
    paint-order: stroke;
    stroke: var(--paper);
    stroke-width: 4px;
    pointer-events: none;
  }

  .me {
    pointer-events: none;
    transition: transform 0.45s ease-in-out;
  }

  .me-ring {
    fill: none;
    stroke: var(--primary);
    stroke-width: 4;
  }

  .me-dot {
    fill: var(--primary);
    stroke: #fff;
    stroke-width: 2;
  }

  @media (prefers-reduced-motion: reduce) {
    .me {
      transition: none;
    }
  }
</style>
