<script lang="ts">
  import type { PlaceTool, PlaceView } from './api'

  /**
   * O mapa é a tela da exploração (JORNADA.md, seção 11): lugares na
   * geografia, ligados por linhas. O marcador desliza até o lugar novo e o mapa
   * centraliza em você. Tocar seleciona; quem viaja é o painel de baixo.
   * Desenho provisório em SVG, até a arte do mapa.
   */
  let {
    places,
    current,
    goalTown,
    selected,
    onSelect,
    onActivate,
  }: {
    places: PlaceView[]
    current: string
    /** Cidade do marco do momento: ganha uma bandeira. */
    goalTown: string | null
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

  /** Cor de cada ferramenta no mapa (linhas e lugares que só abrem com ela). */
  const TOOL_COLORS: Partial<Record<PlaceTool, { color: string; label: string }>> = {
    surf: { color: '#3f86e0', label: 'Surf' },
    rockSmash: { color: '#b0703a', label: 'Rock Smash' },
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
    const out: { key: string; a: PlaceView; b: PlaceView; open: boolean; mine: boolean; tool: string | null }[] = []
    for (const place of places) {
      for (const link of place.links) {
        const key = [place.slug, link.to].sort().join('|')
        const other = bySlug.get(link.to)
        if (seen.has(key) || !other) continue
        seen.add(key)
        const mine = place.slug === current || link.to === current
        const tool = link.requires ? (TOOL_COLORS[link.requires]?.color ?? null) : null
        out.push({ key, a: place, b: other, open: link.open && place.open && other.open, mine, tool })
      }
    }
    return out
  })

  /** Lugar que só se alcança com uma ferramenta: ganha a cor dela. */
  function gateColor(place: PlaceView): string | null {
    const tools = new Set(place.links.map((link) => link.requires))
    if (tools.size !== 1) return null
    const [tool] = tools
    return tool ? (TOOL_COLORS[tool]?.color ?? null) : null
  }

  /** Ferramentas que aparecem no mapa, para a legenda. */
  const legend = $derived(
    Object.entries(TOOL_COLORS).filter(([tool]) => places.some((place) => place.links.some((link) => link.requires === tool))),
  )

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
      place.slug === goalTown ||
      (neighbors.has(place.slug) && place.open)
    )
  }
</script>

<div class="map-box">
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
        class:tool={edge.tool !== null}
        style:--tool={edge.tool}
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
        class:gated={gateColor(place) !== null}
        style:--tool={gateColor(place)}
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
        {#if place.slug === goalTown}
          <!-- Bandeira do marco. -->
          <line class="pole" x1="9" y1="-6" x2="9" y2="-30" />
          <path class="flag" d="M9 -30 L25 -25 L9 -20 Z" />
        {/if}
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
  {#if legend.length > 0}
    <ul class="legend" aria-label="Legenda do mapa">
      <li><span class="swatch water"></span>Água</li>
      {#each legend as [tool, entry] (tool)}
        <li><span class="swatch line" style:--tool={entry?.color}></span>{entry?.label}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .map-box {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  .map-scroll {
    flex: 1;
    min-width: 0;
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

  /* Caminhos a partir de você: dourados (o azul é da água e do Surf). */
  .edge.mine {
    stroke: var(--accent-shade);
  }

  /* Caminho que pede ferramenta: na cor dela, aberto ou não. */
  .edge.tool {
    stroke: var(--tool);
  }

  .edge.closed {
    stroke: var(--ink-soft);
    stroke-width: 3;
    stroke-dasharray: 5 6;
    opacity: 0.45;
  }

  .edge.tool.closed {
    stroke: var(--tool);
    stroke-width: 4;
    opacity: 0.7;
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

  .node.gated:not(.water) .dot {
    fill: color-mix(in srgb, var(--tool) 35%, var(--paper));
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

  .pole {
    stroke: var(--ink);
    stroke-width: 2;
  }

  .flag {
    fill: var(--accent);
    stroke: var(--ink);
    stroke-width: 1.5;
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

  .legend {
    position: absolute;
    left: 6px;
    bottom: 6px;
    display: flex;
    gap: 8px;
    margin: 0;
    padding: 3px 7px;
    list-style: none;
    font-size: 11px;
    font-weight: 700;
    color: var(--ink);
    background: color-mix(in srgb, var(--paper) 88%, transparent);
    border: 2px solid var(--panel-edge);
    pointer-events: none;
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .swatch {
    display: inline-block;
  }

  .swatch.water {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #6890f0;
    border: 1.5px solid var(--ink);
  }

  .swatch.line {
    width: 14px;
    height: 4px;
    background: var(--tool);
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
