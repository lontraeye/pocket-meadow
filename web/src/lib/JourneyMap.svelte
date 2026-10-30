<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import type { PlaceTool, PlaceView } from './api'
  import { cellHash, GROUND, GROUND_TUFTS, iconOf, MAP_SPRITES, TREE_SPRITE } from './mapSprites'

  /**
   * O mapa é a tela da exploração (JORNADA.md, seção 11): lugares na
   * geografia, ligados por linhas. O marcador desliza até o lugar novo e o mapa
   * centraliza em você. Tocar seleciona; quem viaja é o painel de baixo.
   * Pixel art desenhada aqui (mapSprites.ts): gramado em tiles, caminhos de
   * terra em "L", árvores no vazio e um desenho por tipo de lugar.
   */
  let {
    places,
    current,
    goalTown,
    selected,
    onSelect,
    onActivate,
    visible = true,
    walking = false,
    bottomInset = 0,
  }: {
    places: PlaceView[]
    current: string
    /** Cidade do marco do momento: ganha uma bandeira. */
    goalTown: string | null
    selected: string
    onSelect: (slug: string) => void
    /** Toque duplo no mesmo lugar (ex.: viajar direto para o vizinho). */
    onActivate: (slug: string) => void
    /** Escondido atrás do campo: centraliza de novo quando volta a aparecer. */
    visible?: boolean
    /** Andando sozinho pelo caminho: o marcador vai a passo, balançando. */
    walking?: boolean
    /** Quanto da parte de baixo está coberto por um painel flutuante (px). */
    bottomInset?: number
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

  /** Cor de cada ferramenta no mapa (caminhos e lugares que só abrem com ela). */
  const TOOL_STYLE: Partial<Record<PlaceTool, { fill: string; rim: string; label: string }>> = {
    surf: { fill: '#68a0f0', rim: '#2a5aa8', label: 'Surf' },
    rockSmash: { fill: '#c08048', rim: '#6a4020', label: 'Rock Smash' },
  }

  // Cada lugar ocupa uma casa de 64 px; os desenhos são 16×16 em pixels de 2 px.
  const CELL = 64
  const PAD = 56
  const ART = 2

  const bySlug = $derived(new Map(places.map((place) => [place.slug, place])))
  const here = $derived(bySlug.get(current) ?? null)
  const neighbors = $derived(new Map((here?.links ?? []).map((link) => [link.to, link])))
  const minX = $derived(Math.min(...places.map((place) => place.x)))
  const minY = $derived(Math.min(...places.map((place) => place.y)))
  const width = $derived((Math.max(...places.map((place) => place.x)) - minX) * CELL + PAD * 2)
  const height = $derived((Math.max(...places.map((place) => place.y)) - minY) * CELL + PAD * 2)

  type Point = [number, number]
  type Edge = { key: string; points: Point[]; open: boolean; mine: boolean; tool: PlaceTool | null }

  /** Caminho em "L" (só na horizontal e na vertical), como nos mapas dos jogos. */
  function lPath(a: PlaceView, b: PlaceView): Point[] {
    const [ax, ay, bx, by] = [px(a), py(a), px(b), py(b)]
    if (ax === bx || ay === by) return [[ax, ay], [bx, by]]
    return Math.abs(bx - ax) >= Math.abs(by - ay)
      ? [[ax, ay], [bx, ay], [bx, by]]
      : [[ax, ay], [ax, by], [bx, by]]
  }

  // Cada ligação uma vez (os dois lados listam a mesma).
  const edges = $derived.by(() => {
    const seen = new Set<string>()
    const out: Edge[] = []
    for (const place of places) {
      for (const link of place.links) {
        const key = [place.slug, link.to].sort().join('|')
        const other = bySlug.get(link.to)
        if (seen.has(key) || !other) continue
        seen.add(key)
        const mine = place.slug === current || link.to === current
        const tool = link.requires && TOOL_STYLE[link.requires] ? link.requires : null
        out.push({ key, points: lPath(place, other), open: link.open && place.open && other.open, mine, tool })
      }
    }
    return out
  })

  /** Lugar que só se alcança com uma ferramenta: ganha a moldura dela. */
  function gateTool(place: PlaceView): PlaceTool | null {
    const tools = new Set(place.links.map((link) => link.requires))
    if (tools.size !== 1) return null
    const [tool] = tools
    return tool && TOOL_STYLE[tool] ? tool : null
  }

  // Onde o treinador está desenhado: ao viajar, segue o caminho em "L" (passa
  // pela quina) em vez de cortar na diagonal por cima das árvores. Cada trecho
  // leva um tempo proporcional ao comprimento.
  let mePos = $state<Point | null>(null)
  let meMs = $state(0)
  let meLinear = $state(false)
  let meFrom = ''
  let meTimers: number[] = []

  $effect(() => {
    const slug = current
    const place = bySlug.get(slug)
    if (!place) return
    const target: Point = [px(place), py(place)]
    const from = meFrom
    // Mesmo lugar (ex.: o mapa recarregou): não interrompe a caminhada em curso.
    if (from === slug && mePos !== null) return
    meFrom = slug
    for (const timer of meTimers) window.clearTimeout(timer)
    meTimers = []
    const total = untrack(() => walking) ? 800 : 450
    const edge = untrack(() => edges.find((entry) => entry.key === [from, slug].sort().join('|')))
    if (!edge || untrack(() => mePos) === null) {
      meMs = untrack(() => mePos) === null ? 0 : total
      meLinear = false
      mePos = target
      return
    }
    const points = edge.points[0]![0] === target[0] && edge.points[0]![1] === target[1] ? [...edge.points].reverse() : edge.points
    const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index]![0], point[1] - points[index]![1]))
    const sum = lengths.reduce((acc, length) => acc + length, 0) || 1
    meLinear = points.length > 2 || untrack(() => walking)
    let delay = 0
    points.slice(1).forEach((point, index) => {
      const ms = Math.round((total * lengths[index]!) / sum)
      meTimers.push(
        window.setTimeout(() => {
          meMs = ms
          mePos = point
        }, delay),
      )
      delay += ms
    })
  })

  onMount(() => () => {
    for (const timer of meTimers) window.clearTimeout(timer)
  })

  /** Ferramentas que aparecem no mapa, para a legenda. */
  const legend = $derived(
    Object.entries(TOOL_STYLE).filter(([tool]) => places.some((place) => place.links.some((link) => link.requires === tool))),
  )

  /** Distância de um ponto até um caminho em "L". */
  function pathDistance(points: Point[], x: number, y: number): number {
    let best = Infinity
    for (let i = 1; i < points.length; i += 1) {
      const [x1, y1] = points[i - 1]!
      const [x2, y2] = points[i]!
      const cx = Math.max(Math.min(x1, x2), Math.min(Math.max(x1, x2), x))
      const cy = Math.max(Math.min(y1, y2), Math.min(Math.max(y1, y2), y))
      best = Math.min(best, Math.hypot(x - cx, y - cy))
    }
    return best
  }

  // Árvores no que sobra do gramado: sempre nas mesmas casas (hash da posição),
  // longe dos lugares, das placas e dos caminhos.
  const trees = $derived.by(() => {
    const step = 32
    const out: { x: number; y: number }[] = []
    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) {
        if (cellHash(x / step, y / step) % 100 >= 55) continue
        if (places.some((place) => Math.abs(px(place) - x) < 52 && y - py(place) > -44 && y - py(place) < 56)) continue
        if (edges.some((edge) => pathDistance(edge.points, x, y) < 28)) continue
        out.push({ x: x - 16, y: y - 18 })
      }
    }
    return out
  })

  // Gramado e árvores não mudam: viram uma imagem só (canvas), em vez de
  // milhares de retângulos no SVG, que davam engasgos ao arrastar o mapa.
  const background = $derived.by(() => {
    if (typeof document === 'undefined') return ''
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.fillStyle = GROUND
    ctx.fillRect(0, 0, width, height)
    for (let ty = 0; ty < height; ty += 32) {
      for (let tx = 0; tx < width; tx += 32) {
        for (const [x, y, color] of GROUND_TUFTS) {
          ctx.fillStyle = color
          ctx.fillRect(tx + x, ty + y, 2, 2)
        }
      }
    }
    for (const tree of trees) {
      for (const rect of TREE_SPRITE.rects) {
        ctx.fillStyle = rect.fill
        ctx.fillRect(tree.x + rect.x * ART, tree.y + rect.y * ART, rect.w * ART, ART)
      }
    }
    return canvas.toDataURL()
  })

  // Cada desenho vira uma imagem pequena (uma vez só): um elemento por lugar no
  // SVG, em vez de dezenas de retângulos.
  const spriteUrls = new Map<string, string>()
  function spriteUrl(id: string): string {
    const cached = spriteUrls.get(id)
    if (cached !== undefined) return cached
    const sprite = MAP_SPRITES.find((entry) => entry.id === id)
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas')
    const ctx = canvas?.getContext('2d')
    if (!sprite || !canvas || !ctx) return ''
    canvas.width = sprite.size
    canvas.height = sprite.height
    for (const rect of sprite.rects) {
      ctx.fillStyle = rect.fill
      ctx.fillRect(rect.x, rect.y, rect.w, 1)
    }
    const url = canvas.toDataURL()
    spriteUrls.set(id, url)
    return url
  }

  /** Largura da placa com o nome (a fonte pixel tem ~6,2 px por letra em 11 px). */
  const signWidth = (name: string) => Math.ceil(name.length * 6.4) + 12

  const px = (place: PlaceView) => (place.x - minX) * CELL + PAD
  const py = (place: PlaceView) => (place.y - minY) * CELL + PAD

  let scroller = $state<HTMLDivElement | null>(null)
  /** Lugar em que o mapa centralizou por último ('' = precisa centralizar na hora). */
  let centeredOn = ''

  function center(smooth: boolean) {
    const place = here
    const el = scroller
    if (!place || !el) return
    // Centro da área visível (acima do painel que cobre a parte de baixo).
    const left = px(place) - el.clientWidth / 2
    const top = py(place) - (el.clientHeight - bottomInset) / 2
    el.scrollTo({ left, top, behavior: smooth ? 'smooth' : 'instant' })
    centeredOn = place.slug
  }

  // Abre sempre em você (na hora); a cada viagem, desliza até o lugar novo.
  // O mapa pode ser arrastado à vontade; o botão do canto volta para você.
  $effect(() => {
    const slug = current
    if (!visible || !scroller) {
      centeredOn = ''
      return
    }
    if (slug !== centeredOn) center(centeredOn !== '')
  })

  /**
   * O painel de baixo mudou de altura (ou trocou o lugar escolhido): se o
   * lugar escolhido (você, se nada foi tocado) ficou embaixo dele, desliza só o
   * necessário para aparecer.
   */
  $effect(() => {
    const inset = bottomInset
    const place = bySlug.get(selected)
    const el = scroller
    if (!visible || !place || !el) return
    const y = py(place)
    const visibleBottom = el.scrollTop + el.clientHeight - inset
    if (y + 44 > visibleBottom) el.scrollTo({ top: y + 44 - (el.clientHeight - inset), behavior: 'smooth' })
    else if (y - 40 < el.scrollTop) el.scrollTo({ top: y - 40, behavior: 'smooth' })
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
  <svg
    class="map"
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    role="group"
    aria-label="Mapa de Johto"
    shape-rendering="crispEdges"
  >

    {#if background}
      <image class="ground" href={background} {width} {height} />
    {/if}

    {#each edges as edge (edge.key)}
      {@const points = edge.points.map((point) => point.join(',')).join(' ')}
      {@const tool = edge.tool ? TOOL_STYLE[edge.tool] : undefined}
      {#if edge.open}
        <polyline class="path-rim" {points} style:--rim={tool?.rim} />
        <polyline class="path" class:mine={edge.mine && !tool} {points} style:--fill={tool?.fill} />
      {:else}
        <polyline class="path closed" class:tool={tool !== undefined} {points} style:--fill={tool?.fill} />
      {/if}
    {/each}

    {#each places as place (place.slug)}
      {@const near = neighbors.get(place.slug)}
      {@const icon = iconOf(place.kind, place.slug)}
      {@const gate = gateTool(place)}
      {@const off = place.open ? '' : '-off'}
      <g
        class="node"
        class:closed={!place.open}
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
        {#if icon === 'town'}
          <!-- Cidade: praça de terra com a casinha. -->
          <rect class="plaza" x="-20" y="-20" width="40" height="40" />
          <image class="px" href={spriteUrl(`pm-town${off}`)} x="-16" y="-18" width="32" height="32" />
        {:else if icon === 'forest'}
          <image class="px" href={spriteUrl(`pm-grass${off}`)} x="-16" y="-16" width="32" height="32" />
          <image class="px" href={spriteUrl(`pm-tree${off}`)} x="-17" y="-20" width="22" height="22" />
          <image class="px" href={spriteUrl(`pm-tree${off}`)} x="-3" y="-18" width="22" height="22" />
          <image class="px" href={spriteUrl(`pm-tree${off}`)} x="-10" y="-6" width="22" height="22" />
        {:else}
          <image class="px" href={spriteUrl(`pm-${icon}${off}`)} x="-16" y="-16" width="32" height="32" />
        {/if}
        {#if gate}
          <rect class="gate" x="-19" y="-19" width="38" height="38" style:--rim={TOOL_STYLE[gate]?.rim} />
        {/if}
        {#if near?.open && place.slug !== selected}
          <!-- Vizinho aberto: setinha em cima. -->
          <path class="near" d="M-5 -30 h10 v2 h-2 v2 h-2 v2 h-2 v-2 h-2 v-2 h-2 z" />
        {/if}
        {#if near?.isNew}<rect class="new" x="12" y="-22" width="8" height="8" />{/if}
        {#if place.slug === goalTown}
          <image class="px" href={spriteUrl(`pm-flag`)} x="10" y="-36" width="16" height="16" />
        {/if}
        {#if place.slug === selected}
          <!-- Cursor de seleção: cantos piscando. -->
          <path
            class="cursor"
            d="M-24 -24 h10 v4 h-6 v6 h-4 z M24 -24 h-10 v4 h6 v6 h4 z M-24 24 h10 v-4 h-6 v-6 h-4 z M24 24 h-10 v-4 h6 v-6 h4 z"
          />
        {/if}
        {#if showLabel(place)}
          {@const sign = signWidth(place.name)}
          <rect class="sign" x={-sign / 2} y="22" width={sign} height="16" />
          <text class="label" y="34">{place.name}</text>
        {/if}
      </g>
    {/each}
    <!-- Você: desliza até o lugar novo ao viajar. -->
    {#if here && mePos}
      <g
        class="me"
        class:walking
        style:transform="translate({mePos[0]}px, {mePos[1]}px)"
        style:transition-duration="{meMs}ms"
        style:transition-timing-function={meLinear ? 'linear' : null}
        aria-hidden="true"
      >
        <rect class="me-shadow" x="-10" y="10" width="20" height="4" />
        <g class="me-body">
          <image class="px" href={spriteUrl(`pm-trainer`)} x={-4 * ART * 1.5} y={-8 * ART * 1.5} width={8 * ART * 1.5} height={10 * ART * 1.5} />
        </g>
      </g>
    {/if}
  </svg>
  <!-- Espaço para rolar o fim do mapa para cima do painel flutuante. -->
  <div class="inset" style:height="{bottomInset}px" style:width="{width}px"></div>
</div>
  <button type="button" class="recenter" aria-label="Voltar para onde você está" onclick={() => center(true)}>
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
      <path d="M8 0v3M8 13v3M0 8h3M13 8h3" stroke="currentColor" stroke-width="2" />
    </svg>
  </button>
  {#if legend.length > 0}
    <ul class="legend" aria-label="Legenda do mapa" style:bottom="{bottomInset + 8}px">
      <li><span class="swatch water"></span>Água</li>
      {#each legend as [tool, entry] (tool)}
        <li><span class="swatch line" style:--fill={entry?.fill} style:--rim={entry?.rim}></span>{entry?.label}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Toques rápidos no mapa não selecionam os nomes das placas (nem pintam o toque). */
  .map-box {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  /* Moldura de tela de jogo: borda escura e filete claro por dentro. */
  .map-scroll {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    border: 3px solid #283028;
    background: #88c870;
    box-shadow: inset 0 0 0 2px #f8f8f0;
    contain: layout paint;
    touch-action: pan-x pan-y;
    scrollbar-width: none;
  }

  .map-scroll::-webkit-scrollbar {
    display: none;
  }

  /* Camada própria: arrastar só move a imagem pronta, sem redesenhar. */
  .inset {
    background: #88c870;
  }

  .map {
    display: block;
    will-change: transform;
  }

  .ground,
  .px {
    image-rendering: pixelated;
    pointer-events: none;
  }

  .node.closed .gate {
    opacity: 0.5;
  }

  /* Caminhos de terra: borda escura por baixo e o miolo por cima. */
  .path-rim,
  .path {
    fill: none;
    stroke-linecap: square;
    stroke-linejoin: miter;
  }

  .path-rim {
    stroke: var(--rim, #9a7040);
    stroke-width: 18;
  }

  .path {
    stroke: var(--fill, #e8c890);
    stroke-width: 12;
  }

  /* Caminhos a partir de você: terra mais clara. */
  .path.mine {
    stroke: #f8e0a0;
  }

  /* Fechado: só pedrinhas no chão (tracejado), apagado. */
  .path.closed {
    stroke: #c8b890;
    stroke-width: 8;
    stroke-dasharray: 8 8;
    stroke-linecap: butt;
    opacity: 0.75;
  }

  .path.closed.tool {
    stroke: var(--fill);
  }

  .node {
    cursor: pointer;
    outline: none;
  }

  .hit {
    fill: transparent;
  }

  .plaza {
    fill: #e8c890;
    stroke: #9a7040;
    stroke-width: 3;
  }

  .gate {
    fill: none;
    stroke: var(--rim);
    stroke-width: 3;
    stroke-dasharray: 6 4;
  }

  /* Fechado: o desenho já vem apagado (-off); a praça e a placa acompanham. */
  .node.closed .plaza {
    fill: #b0c098;
    stroke: #8a9a78;
  }

  .node.closed .sign {
    fill: #d8e0c8;
    stroke: #6a7a60;
  }

  .node.closed .label {
    fill: #5a6a50;
  }

  .near {
    fill: #f8f8f0;
    stroke: #283028;
    stroke-width: 1.5;
    paint-order: stroke;
  }

  .new {
    fill: var(--accent, #f8d030);
    stroke: #283028;
    stroke-width: 2;
  }

  .cursor {
    fill: #f8d030;
    stroke: #283028;
    stroke-width: 1.5;
    paint-order: stroke;
    animation: blink 0.6s steps(2, jump-none) infinite alternate;
  }

  @keyframes blink {
    to {
      opacity: 0.35;
    }
  }

  .node:focus-visible .hit {
    stroke: #f8d030;
    stroke-width: 3;
  }

  /* Placa com o nome. */
  .sign {
    fill: #f8f8f0;
    stroke: #283028;
    stroke-width: 2;
  }

  .label {
    font-size: 11px;
    font-weight: 700;
    text-anchor: middle;
    fill: #283028;
    pointer-events: none;
  }

  .recenter {
    position: absolute;
    top: 8px;
    right: 8px;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    color: #283028;
    background: #f8f8f0;
    border: 3px solid #283028;
    box-shadow: 0 3px 0 #00000044;
    cursor: pointer;
  }

  .recenter:active {
    transform: translateY(2px);
    box-shadow: none;
  }

  .legend {
    position: absolute;
    left: 8px;
    bottom: 8px;
    display: flex;
    gap: 8px;
    margin: 0;
    padding: 3px 7px;
    list-style: none;
    font-size: 11px;
    font-weight: 700;
    color: #283028;
    background: #f8f8f0;
    border: 3px solid #283028;
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
    width: 10px;
    height: 10px;
    background: #5890e8;
    box-shadow: inset 0 0 0 2px #283028, inset 0 -4px 0 #a8d0f8;
  }

  .swatch.line {
    width: 14px;
    height: 6px;
    background: var(--fill);
    box-shadow: 0 0 0 2px var(--rim);
  }

  .me {
    pointer-events: none;
    transition: transform 0.45s ease-in-out;
  }

  .me-shadow {
    fill: #00000033;
  }

  /* Caminhando: um pulinho a cada passada (a duração vem do trecho, no style). */
  .me.walking .me-body {
    animation: step 0.27s steps(2, jump-none) infinite alternate;
  }

  @keyframes step {
    from {
      transform: translateY(0);
    }
    to {
      transform: translateY(-4px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .me {
      transition: none;
    }

    .me.walking .me-body,
    .cursor {
      animation: none;
    }
  }
</style>
