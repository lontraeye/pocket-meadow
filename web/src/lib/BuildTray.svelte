<script lang="ts">
  import { isFlippable, PIECES, STRUCTURE_PIECES, type PieceKey, type StructurePiece } from '@garden/layout'
  import { giftIconSrc, type GardenLayout } from './api'
  import type { BuildPick, PaintTool } from './build'
  import { BUILD_CATEGORIES, ICON_H, ICON_W, PIECE_ICONS, type BuildCategory } from './buildIcons'
  import { formatCountdown } from './time'
  import { FLOOR_NAMES, type PaintFloor } from '@habitat/config'
  import { habitatKind, type HabitatCheck, type HabitatKind } from '@habitat'
  import { habitatStatus, kindFloors, needText } from './habitatView'

  // Construção do jardim (PROGRESSAO.md 4.3): a barra de baixo do modo
  // Construir. O jardim cuida dos toques na grade; aqui ficam o catálogo (abas
  // por categoria e um cartão com ícone por peça), o detalhe da peça com
  // receita (colocar, achar, construir: passo 2c) e as ações da peça escolhida.

  let {
    layout,
    pick,
    pending,
    message,
    fits,
    mouse,
    now,
    itemName,
    paint,
    floorSrc,
    habitats,
    area,
    onNewHabitat,
    onEditHabitat,
    onAreaKind,
    onAreaSave,
    onAreaDelete,
    onAreaCancel,
    onPaint,
    onPick,
    onSelectPlaced,
    onCraft,
    onMove,
    onTurn,
    onConfirm,
    onStore,
    onCancel,
    onClose,
  }: {
    layout: GardenLayout
    pick: BuildPick | null
    pending: boolean
    message: string
    /** A prévia cabe onde está. */
    fits: boolean
    /** Mouse (a prévia segue o ponteiro e o clique coloca) ou toque (setas e Confirmar). */
    mouse: boolean
    /** Relógio do servidor (a obra em andamento). */
    now: number
    /** Nome do material, para o custo da receita. */
    itemName: (itemKey: string) => string
    /** Pincel escolhido na aba Chão (null = nenhum). */
    paint: PaintTool | null
    /** Amostra do chão (o tile). */
    floorSrc: (floor: PaintFloor) => string | null
    /** Habitats com a conta ao vivo. */
    habitats: { id: number; kind: HabitatKind; check: HabitatCheck }[]
    /** Habitat em edição (área marcada com o pincel), ou null. */
    area: { id: number | null; kind: HabitatKind; check: HabitatCheck; dirty: boolean } | null
    onNewHabitat: (kind: HabitatKind) => void
    onEditHabitat: (id: number) => void
    onAreaKind: (kind: HabitatKind) => void
    onAreaSave: () => void
    onAreaDelete: () => void
    onAreaCancel: () => void
    onPaint: (tool: PaintTool | null) => void
    onPick: (piece: PieceKey) => void
    /** Cartão de uma peça que já está no jardim: seleciona ela lá. */
    onSelectPlaced: (id: number) => void
    /** Constrói uma peça pela receita. */
    onCraft: (piece: StructurePiece) => void
    onMove: () => void
    onTurn: () => void
    onConfirm: () => void
    onStore: () => void
    onCancel: () => void
    onClose: () => void
  } = $props()

  /** Menu do habitat: chãos que valem ponto para o tipo e os outros (enfeite). */
  const areaFloors = $derived.by(() => {
    if (!area) return { scoring: [], others: [] }
    const scoring = new Set(kindFloors(area.kind))
    return {
      scoring: layout.floors.filter((row) => scoring.has(row.floor)),
      others: layout.floors.filter((row) => !scoring.has(row.floor)),
    }
  })

  const plotsFree = $derived(Math.max(0, layout.plotLimit - layout.plotsPlaced))
  const name = (piece: PieceKey) => PIECES[piece].name

  /** "Marco de Azalea" → "Azalea", para caber no cartão. */
  const town = (name: string) => name.replace(/^Marco de /, '')

  /**
   * Um cartão por peça: guardada (toca para colocar), no jardim (toca para achar
   * lá), ainda fechada (com o marco que abre) ou, no canteiro, quantos ainda cabem.
   */
  type Card = {
    piece: PieceKey
    badge: string | null
    note: string
    /** Segunda linha: o que o próximo marco traz. */
    more: string | null
    placedId: number | null
    ready: boolean
    locked: boolean
  }

  const cards = $derived.by((): Card[] => {
    const out: Card[] = [
      {
        piece: 'berry_plot',
        badge: plotsFree > 0 ? String(plotsFree) : null,
        note: `${layout.plotsPlaced}/${layout.plotLimit}`,
        more: layout.nextPlots ? `+${layout.nextPlots.plots - layout.plotLimit} em ${town(layout.nextPlots.name)}` : null,
        placedId: null,
        ready: plotsFree > 0,
        locked: false,
      },
    ]
    const base = { more: null, locked: false }
    for (const piece of STRUCTURE_PIECES) {
      // Um cartão por tipo: o selo conta as guardadas; a nota, quantas estão no jardim.
      const stored = layout.stored.filter((row) => row.piece === piece).length
      const placed = layout.pieces.filter((row) => row.piece === piece)
      const inGarden = placed.length > 0 ? (placed.length === 1 ? 'no jardim' : `${placed.length} no jardim`) : ''
      if (stored > 0) {
        const note = inGarden || (stored === 1 ? 'guardada' : 'guardadas')
        out.push({ ...base, piece, badge: String(stored), note, placedId: null, ready: true })
        continue
      }
      if (placed.length > 0) {
        out.push({ ...base, piece, badge: null, note: inGarden, placedId: placed[0]!.id, ready: false })
        continue
      }
      const closed = layout.locked.find((row) => row.piece === piece)
      if (closed) {
        out.push({ ...base, piece, badge: null, note: town(closed.unlockAt.name), placedId: null, ready: false, locked: true })
      }
    }
    // A obra em andamento aparece no cartão do tipo dela.
    const building = layout.building
    return building
      ? out.map((card) => (card.piece === building.piece ? { ...card, more: `obra · ${formatCountdown(building.readyAt - now)}` } : card))
      : out
  })

  /** A peça com receita que está aberta no detalhe (null = nenhuma). */
  let focus = $state<StructurePiece | null>(null)
  const focusRecipe = $derived(focus ? (layout.recipes.find((row) => row.piece === focus) ?? null) : null)
  const focusStored = $derived(focus ? layout.stored.filter((row) => row.piece === focus).length : 0)
  const focusPlaced = $derived(focus ? (layout.pieces.find((row) => row.piece === focus) ?? null) : null)
  /** Por que não dá para construir agora (null = dá). */
  const craftBlock = $derived.by((): string | null => {
    const recipe = focusRecipe
    if (!recipe) return null
    if (recipe.unlockAt) return `A receita abre no ${recipe.unlockAt.name}.`
    if (recipe.count >= recipe.cap) {
      return recipe.nextCap ? `No máximo (${recipe.cap}). Mais no ${recipe.nextCap.name}.` : `No máximo (${recipe.cap}).`
    }
    if (layout.building) return `Já tem uma obra: ${name(layout.building.piece).toLowerCase()}.`
    if (recipe.cost.some((item) => item.have < item.quantity)) return 'Faltam materiais.'
    return null
  })

  /** Tempo da receita, sem segundos ("1 h", "4 h", "30 min"). */
  function recipeTime(ms: number): string {
    const minutes = Math.round(ms / 60_000)
    return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`
  }

  let tab = $state<BuildCategory | 'all' | 'chao' | 'habitat'>('all')
  /** Bandeja recolhida: só a linha de cima, para ver o jardim enquanto constrói. */
  let collapsed = $state(false)
  /**
   * Escolher um pincel (chão, borracha ou a Área do habitat) recolhe a
   * bandeja sozinho, para pintar vendo o jardim; a seta abre de novo.
   */
  function choose(tool: PaintTool | null) {
    onPaint(tool)
    if (tool !== null || area) collapsed = true
  }
  /** Escolhendo o tipo do habitat novo. */
  let choosingKind = $state(false)
  function openTab(next: BuildCategory | 'all' | 'chao' | 'habitat') {
    choosingKind = false
    tab = next
    // Sair da aba Chão larga o pincel (o toque volta a escolher peças).
    if (next !== 'chao') onPaint(null)
  }
  const tabs = $derived(
    BUILD_CATEGORIES.map((category) => ({
      ...category,
      waiting: cards.filter((card) => card.ready && category.pieces.includes(card.piece)).length,
    })).filter((category) => cards.some((card) => category.pieces.includes(card.piece))),
  )
  const shown = $derived(
    tab === 'all' || tab === 'chao' || tab === 'habitat' ? cards : cards.filter((card) => BUILD_CATEGORIES.find((row) => row.key === tab)?.pieces.includes(card.piece)),
  )
  const waitingAll = $derived(cards.filter((card) => card.ready).length)

  function onCard(card: Card) {
    // Peça com receita: abre o detalhe (colocar, achar, construir).
    if (card.piece !== 'berry_plot' && layout.recipes.some((row) => row.piece === card.piece)) {
      focus = focus === card.piece ? null : card.piece
      return
    }
    if (card.ready) onPick(card.piece)
    else if (card.placedId !== null) onSelectPlaced(card.placedId)
  }
</script>

{#snippet icon(piece: PieceKey, px: number)}
  {@const art = PIECE_ICONS[piece]}
  <span
    class="icon"
    style:width="{ICON_W * px}px"
    style:height="{ICON_H * px}px"
    style:background-image="url({art.src})"
    style:background-size="{ICON_W * art.frames * px}px {ICON_H * px}px"
    style:background-position-x="{-art.frame * ICON_W * px}px"
    aria-hidden="true"
  ></span>
{/snippet}

{#snippet tabIcon(key: BuildCategory | 'all' | 'chao' | 'habitat')}
  <!-- Ícones em pixels (grade 12×12), como os do jardim. -->
  <svg viewBox="0 0 12 12" width="18" height="18" shape-rendering="crispEdges" aria-hidden="true">
    {#if key === 'all'}
      <rect x="1" y="1" width="4" height="4" /><rect x="7" y="1" width="4" height="4" />
      <rect x="1" y="7" width="4" height="4" /><rect x="7" y="7" width="4" height="4" />
    {:else if key === 'habitat'}
      <!-- Casinha. -->
      <rect x="5" y="1" width="2" height="1" /><rect x="3" y="2" width="6" height="2" /><rect x="1" y="4" width="10" height="1" />
      <rect x="2" y="5" width="8" height="6" /><rect x="5" y="8" width="2" height="3" fill="var(--panel-face)" />
    {:else if key === 'chao'}
      <!-- Losango de chão com um pincel. -->
      <rect x="5" y="5" width="2" height="1" /><rect x="3" y="6" width="6" height="1" /><rect x="1" y="7" width="10" height="1" />
      <rect x="3" y="8" width="6" height="1" /><rect x="5" y="9" width="2" height="1" />
      <rect x="8" y="1" width="2" height="2" /><rect x="7" y="3" width="2" height="2" />
    {:else if key === 'horta'}
      <!-- Broto saindo da terra. -->
      <rect x="5" y="3" width="2" height="6" /><rect x="2" y="2" width="3" height="2" /><rect x="7" y="4" width="3" height="2" />
      <rect x="1" y="9" width="10" height="2" />
    {:else if key === 'producao'}
      <!-- Engrenagem. -->
      <rect x="4" y="1" width="4" height="10" /><rect x="1" y="4" width="10" height="4" />
      <rect x="2" y="2" width="8" height="8" /><rect x="5" y="5" width="2" height="2" fill="var(--panel-face)" />
    {:else}
      <!-- Cruz da cura. -->
      <rect x="4" y="1" width="4" height="10" /><rect x="1" y="4" width="10" height="4" />
    {/if}
  </svg>
{/snippet}

{#snippet floorCard(floor: PaintFloor, unlockAt: { name: string } | null, scoring: boolean)}
  {@const src = floorSrc(floor)}
  <button
    type="button"
    class="card"
    class:focused={paint === floor}
    class:locked={unlockAt !== null}
    aria-pressed={paint === floor}
    disabled={pending || unlockAt !== null || (area !== null && (area.dirty || area.id === null))}
    aria-label={unlockAt ? `${FLOOR_NAMES[floor]}: abre no ${unlockAt.name}` : FLOOR_NAMES[floor]}
    onclick={() => choose(paint === floor ? null : floor)}
  >
    <span class="thumb">
      {#if src}<img class="swatch" src={src} alt="" width="48" height="24" />{/if}
    </span>
    <span class="card-name">{FLOOR_NAMES[floor]}</span>
    {#if unlockAt}<small>{town(unlockAt.name)}</small>{:else if scoring}<small class="more">vale ponto</small>{/if}
  </button>
{/snippet}

{#snippet catalogTabs()}
  <div class="tabs" role="tablist" aria-label="Categorias">
    <button
      type="button"
      class="tab"
      role="tab"
      aria-selected={tab === 'all'}
      aria-label="Tudo"
      title="Tudo"
      onclick={() => openTab('all')}
    >
      {@render tabIcon('all')}
      {#if waitingAll > 0}<span class="dot" aria-hidden="true"></span>{/if}
    </button>
    {#each tabs as category (category.key)}
      <button
        type="button"
        class="tab"
        role="tab"
        aria-selected={tab === category.key}
        aria-label={category.name}
        title={category.name}
        onclick={() => openTab(category.key)}
      >
        {@render tabIcon(category.key)}
        {#if category.waiting > 0}<span class="dot" aria-hidden="true"></span>{/if}
      </button>
    {/each}
    <button
      type="button"
      class="tab"
      role="tab"
      aria-selected={tab === 'chao'}
      aria-label="Chão"
      title="Chão"
      onclick={() => openTab('chao')}
    >
      {@render tabIcon('chao')}
    </button>
    <button
      type="button"
      class="tab"
      role="tab"
      aria-selected={tab === 'habitat'}
      aria-label="Habitats"
      title="Habitats"
      onclick={() => openTab('habitat')}
    >
      {@render tabIcon('habitat')}
    </button>
  </div>
{/snippet}

<!-- Catálogo e menu do habitat: altura fixa (não muda de tamanho entre as abas);
     movendo peça ou recolhida, fica só o que precisa. -->
<div class="build-tray panel" class:fixed={!collapsed && (area !== null || !pick)} role="region" aria-label="Construir">
  <div class="head">
    {#if area}
      <!-- No menu do habitat, a linha de cima diz qual é e como está. -->
      <p class="title">
        <strong>{habitatKind(area.kind).name}</strong>
        <span>{area.check.size === 0 ? 'marque a área' : `${area.check.size} casas · ${habitatStatus(area.kind, area.check)}`}</span>
      </p>
    {:else if pick || collapsed}
      <strong class="title">Construir</strong>
    {:else}
      {@render catalogTabs()}
    {/if}
    <button
      type="button"
      class="btn fold"
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Abrir menu' : 'Recolher menu'}
      title={collapsed ? 'Abrir menu' : 'Recolher menu'}
      onclick={() => (collapsed = !collapsed)}
    >
      <!-- Seta em pixels: para baixo recolhe, para cima abre. -->
      <svg viewBox="0 0 12 12" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true">
        {#if collapsed}
          <rect x="5" y="3" width="2" height="1" /><rect x="4" y="4" width="4" height="1" /><rect x="3" y="5" width="6" height="1" />
          <rect x="2" y="6" width="8" height="1" /><rect x="1" y="7" width="10" height="1" />
        {:else}
          <rect x="1" y="4" width="10" height="1" /><rect x="2" y="5" width="8" height="1" /><rect x="3" y="6" width="6" height="1" />
          <rect x="4" y="7" width="4" height="1" /><rect x="5" y="8" width="2" height="1" />
        {/if}
      </svg>
    </button>
    <button type="button" class="btn done" onclick={onClose}>{area ? 'Sair' : 'Pronto'}</button>
  </div>

  {#if collapsed}
    <!-- Recolhida: nada além da linha de cima (o pincel continua valendo). -->
  {:else if area}
    <!-- Menu de construção do habitat: tipo, área e os chãos do tipo separados
         dos outros. O pincel de chão só pinta dentro da área. -->
    <div class="catalog habitat-menu">
      <div class="kinds" role="group" aria-label="Tipo do habitat">
        {#each layout.habitatKinds as row (row.kind)}
          <button
            type="button"
            class="btn kind"
            class:btn-primary={area.kind === row.kind}
            aria-pressed={area.kind === row.kind}
            disabled={pending || row.unlockAt !== null}
            title={row.unlockAt ? `Abre no ${row.unlockAt.name}` : undefined}
            onclick={() => onAreaKind(row.kind)}
          >
            {habitatKind(row.kind).name}
          </button>
        {/each}
      </div>
      <p class="hint">{needText(area.kind, area.check)}</p>

      <div class="cards floors" role="group" aria-label="Ferramentas do habitat">
        <button
          type="button"
          class="card"
          class:focused={paint === null}
          aria-pressed={paint === null}
          disabled={pending}
          onclick={() => choose(null)}
        >
          <span class="thumb">{@render tabIcon('habitat')}</span>
          <span class="card-name">Área</span>
          <small>marcar</small>
        </button>
        {#each areaFloors.scoring as row (row.floor)}
          {@render floorCard(row.floor, row.unlockAt, true)}
        {/each}
      </div>
      {#if areaFloors.others.length > 0}
        <p class="hint section">Outros chãos (enfeite, sem ponto)</p>
        <div class="cards floors" role="group" aria-label="Outros chãos">
          {#each areaFloors.others as row (row.floor)}
            {@render floorCard(row.floor, row.unlockAt, false)}
          {/each}
          <button
            type="button"
            class="card"
            class:focused={paint === 'erase'}
            aria-pressed={paint === 'erase'}
            disabled={pending || area.dirty || area.id === null}
            onclick={() => choose(paint === 'erase' ? null : 'erase')}
          >
            <span class="thumb">
              {#if floorSrc('grama-alta')}<img class="swatch erase" src={floorSrc('grama-alta')} alt="" width="48" height="24" />{/if}
            </span>
            <span class="card-name">Apagar</span>
            <small>gramado</small>
          </button>
        </div>
      {/if}
      <p class="hint">
        {#if paint === null}
          {mouse ? 'Clique ou arraste' : 'Toque ou arraste'} para marcar a área; começar numa casa marcada desmarca.
        {:else if area.dirty || area.id === null}
          Salve a área para pintar o chão.
        {:else}
          {mouse ? 'Clique ou arraste' : 'Toque ou arraste'} dentro da área para {paint === 'erase' ? 'apagar' : 'pintar'}.
        {/if}
        {mouse ? 'Botão do meio ou direito move a câmera.' : 'Dois dedos movem a câmera.'} A seta recolhe o menu.
      </p>
      <div class="row">
        {#if area.dirty || area.id === null}
          <button type="button" class="btn btn-primary" disabled={pending || area.check.size === 0} onclick={onAreaSave}>Salvar área</button>
        {/if}
        {#if area.id !== null}
          <button type="button" class="btn" disabled={pending} onclick={onAreaDelete}>Excluir</button>
        {/if}
        <button type="button" class="btn" disabled={pending} onclick={onAreaCancel}>
          {area.dirty || area.id === null ? 'Cancelar' : 'Pronto'}
        </button>
      </div>
    </div>
  {:else if pick?.kind === 'selected'}
    <div class="picked">
      <span class="thumb small">{@render icon(pick.piece, 1)}</span>
      <p class="hint"><strong>{name(pick.piece)}</strong></p>
    </div>
    <div class="row">
      <button type="button" class="btn btn-primary" disabled={pending} onclick={onMove}>Mover</button>
      {#if isFlippable(pick.piece)}
        <button type="button" class="btn" disabled={pending} onclick={onTurn}>Girar</button>
      {/if}
      <button type="button" class="btn" disabled={pending} onclick={onStore}>Guardar</button>
      <button type="button" class="btn" disabled={pending} onclick={onCancel}>Voltar</button>
    </div>
  {:else if pick}
    <div class="picked">
      <span class="thumb small">{@render icon(pick.piece, 1)}</span>
      <p class="hint">
        {#if mouse}
          Clique numa casa para {pick.kind === 'move' ? 'levar' : 'colocar'} {name(pick.piece).toLowerCase()}.{isFlippable(pick.piece)
            ? ' R gira.'
            : ''} Esc cancela.
        {:else}
          Arraste {name(pick.piece).toLowerCase()} ou use as setas, e confirme.
        {/if}
      </p>
    </div>
    <div class="row">
      {#if !mouse}
        <button type="button" class="btn btn-primary" disabled={pending || !fits} onclick={onConfirm}>Confirmar</button>
      {/if}
      {#if isFlippable(pick.piece)}
        <button type="button" class="btn" disabled={pending} onclick={onTurn}>Girar{mouse ? ' (R)' : ''}</button>
      {/if}
      <button type="button" class="btn" disabled={pending} onclick={onCancel}>Cancelar</button>
    </div>
  {:else if tab === 'habitat'}
    <!-- Habitats (5.22): área e tipo escolhidos; a fronteira é a área de cada um. -->
    <div class="catalog">
      {#if choosingKind}
        <p class="hint">Que tipo de habitat?</p>
        <div class="kinds" role="group" aria-label="Tipo do habitat">
          {#each layout.habitatKinds as row (row.kind)}
            <button
              type="button"
              class="btn kind"
              disabled={pending || row.unlockAt !== null}
              onclick={() => {
                choosingKind = false
                onNewHabitat(row.kind)
              }}
            >
              {habitatKind(row.kind).name}{#if row.unlockAt}<small> · {town(row.unlockAt.name)}</small>{/if}
            </button>
          {/each}
        </div>
        <div class="row"><button type="button" class="btn" onclick={() => (choosingKind = false)}>Voltar</button></div>
      {:else}
        {#if habitats.length === 0}
          <p class="hint">Nenhum habitat. Crie um, marque a área e pinte o chão do tipo na aba Chão.</p>
        {:else}
          <ul class="habitat-list">
            {#each habitats as row (row.id)}
              <li>
                <button type="button" class="btn habitat-row" disabled={pending} onclick={() => onEditHabitat(row.id)}>
                  <strong>{habitatKind(row.kind).name}</strong>
                  <span class:ready={row.check.ready}>{habitatStatus(row.kind, row.check)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        <div class="row">
          <button type="button" class="btn btn-primary" disabled={pending} onclick={() => (choosingKind = true)}>Novo habitat</button>
        </div>
      {/if}
    </div>
  {:else if tab === 'chao'}
    <!-- Chão dos habitats (5.22): sem custo nem limite; o espaço é o freio. -->
    <div class="catalog">
      <div class="cards floors" role="tabpanel">
        {#each layout.floors as row (row.floor)}
          {@const src = floorSrc(row.floor)}
          <button
            type="button"
            class="card"
            class:focused={paint === row.floor}
            class:locked={row.unlockAt !== null}
            aria-pressed={paint === row.floor}
            disabled={pending || row.unlockAt !== null}
            aria-label={row.unlockAt ? `${FLOOR_NAMES[row.floor]}: abre no ${row.unlockAt.name}` : FLOOR_NAMES[row.floor]}
            onclick={() => choose(paint === row.floor ? null : row.floor)}
          >
            <span class="thumb">
              {#if src}<img class="swatch" src={src} alt="" width="48" height="24" />{/if}
            </span>
            <span class="card-name">{FLOOR_NAMES[row.floor]}</span>
            {#if row.unlockAt}<small>{town(row.unlockAt.name)}</small>{/if}
          </button>
        {/each}
        <button
          type="button"
          class="card"
          class:focused={paint === 'erase'}
          aria-pressed={paint === 'erase'}
          disabled={pending}
          onclick={() => choose(paint === 'erase' ? null : 'erase')}
        >
          <span class="thumb">
            {#if floorSrc('grama-alta')}<img class="swatch erase" src={floorSrc('grama-alta')} alt="" width="48" height="24" />{/if}
          </span>
          <span class="card-name">Apagar</span>
          <small>gramado</small>
        </button>
      </div>
      <p class="hint">
        {paint
          ? `${mouse ? 'Clique ou arraste' : 'Toque ou arraste'} nas casas para ${paint === 'erase' ? 'apagar' : 'pintar'}.`
          : 'Escolha um chão. Juntos, 6 ou mais viram um habitat.'}
      </p>
    </div>
  {:else}
    <div class="catalog">
      <div class="cards" role="tabpanel">
        {#each shown as card (card.piece)}
          <button
            type="button"
            class="card"
            class:placed={!card.ready}
            class:locked={card.locked}
            class:focused={focus === card.piece}
            aria-pressed={card.piece !== 'berry_plot' && layout.recipes.some((row) => row.piece === card.piece) ? focus === card.piece : undefined}
            disabled={pending ||
              (!card.ready && card.placedId === null && !layout.recipes.some((row) => row.piece === card.piece && row.unlockAt === null))}
            aria-label={card.locked
              ? `${name(card.piece)}: abre no Marco de ${card.note}`
              : `${name(card.piece)}: ${card.note}${card.more ? `, ${card.more}` : ''}`}
            onclick={() => onCard(card)}
          >
            <span class="thumb">
              {@render icon(card.piece, 2)}
              {#if card.badge}<span class="badge">{card.badge}</span>{/if}
              {#if card.locked}
                <!-- Cadeado em pixels (grade 12×12). -->
                <svg class="lock" viewBox="0 0 12 12" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true">
                  <rect x="3" y="1" width="6" height="2" /><rect x="2" y="2" width="2" height="4" /><rect x="8" y="2" width="2" height="4" />
                  <rect x="1" y="5" width="10" height="7" /><rect x="5" y="7" width="2" height="3" fill="var(--panel-face)" />
                </svg>
              {/if}
            </span>
            <span class="card-name">{name(card.piece)}</span>
            <small>{card.note}</small>
            {#if card.more}<small class="more">{card.more}</small>{/if}
          </button>
        {/each}
      </div>

      {#if focus && focusRecipe}
        {@const recipe = focusRecipe}
        {@const building = layout.building?.piece === focus ? layout.building : null}
        <!-- Detalhe da peça: o que tem, a receita e as ações. -->
        <div class="detail" role="group" aria-label={name(focus)}>
          <p class="hint">
            <strong>{name(focus)}</strong>
            <span class="count">{recipe.count}/{recipe.cap}</span>
          </p>
          {#if building}
            {@const total = Math.max(1, building.readyAt - building.startedAt)}
            <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(((now - building.startedAt) / total) * 100)}>
              <span style:width="{Math.min(100, Math.max(0, ((now - building.startedAt) / total) * 100))}%"></span>
              <b>Pronta em {formatCountdown(building.readyAt - now)}</b>
            </div>
          {/if}
          <ul class="cost" aria-label="Receita">
            {#each recipe.cost as item (item.itemKey)}
              <li class:short={item.have < item.quantity}>
                <img src={giftIconSrc(item.itemKey)} alt="" width="20" height="20" />
                <span>{itemName(item.itemKey)}</span>
                <strong>{Math.min(item.have, item.quantity)}/{item.quantity}</strong>
              </li>
            {/each}
          </ul>
          {#if craftBlock}<p class="hint block">{craftBlock}</p>{/if}
          <div class="row">
            {#if focusStored > 0}
              <button type="button" class="btn btn-primary" disabled={pending} onclick={() => focus && onPick(focus)}>Colocar</button>
            {:else if focusPlaced}
              <button type="button" class="btn" disabled={pending} onclick={() => focusPlaced && onSelectPlaced(focusPlaced.id)}>Achar</button>
            {/if}
            <button
              type="button"
              class="btn"
              class:btn-primary={focusStored === 0 && craftBlock === null}
              disabled={pending || craftBlock !== null}
              onclick={() => focus && onCraft(focus)}
            >
              Construir · {recipeTime(recipe.ms)}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if message}
    <p class="message" role="status">{message}</p>
  {/if}
</div>

<style>
  .build-tray {
    position: absolute;
    z-index: 8;
    left: 50%;
    bottom: calc(0.5rem + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    width: min(30rem, calc(100% - 1rem));
    box-sizing: border-box;
    display: grid;
    /* Sem isso, a fileira de cartões (que rola para o lado) estica a bandeja. */
    grid-template-columns: minmax(0, 1fr);
    gap: 0.4rem;
    align-content: start;
    max-height: 60vh;
    overflow-y: auto;
    color: var(--ink);
    pointer-events: auto;
  }

  .build-tray.fixed {
    height: min(21rem, 60vh);
  }

  /* Filas que rolam para o lado: a barra fica embaixo dos botões, não por cima. */
  .tabs,
  .kinds,
  .cards {
    scrollbar-width: thin;
    padding-bottom: 8px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    min-width: 0;
  }

  .head .title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .head .title span {
    margin-left: 0.4rem;
    font-size: 0.9rem;
  }

  .head .fold,
  .head .done {
    flex: none;
  }

  .head .fold {
    width: 44px;
    min-width: 44px;
    padding: 0;
    fill: currentColor;
  }

  .hint,
  .message {
    margin: 0;
    font-size: 0.9rem;
  }

  .message {
    font-weight: 700;
  }

  /* As ações numa linha só, em colunas iguais (no celular não sobra um botão
     sozinho embaixo). */
  .row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 0.3rem;
  }

  .row .btn {
    min-width: 0;
    padding: 0 0.3rem;
    font-size: 15px;
  }

  .picked {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Catálogo: as abas na linha de cima (ao lado do Pronto) e os cartões numa
     fileira só, que rola para o lado: a bandeja fica baixa no celular. */
  .catalog {
    min-width: 0;
  }

  .tabs {
    display: flex;
    flex: 1 1 auto;
    gap: 0.25rem;
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }

  .tabs .tab {
    flex: none;
  }

  .tab {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 2px solid var(--panel-edge);
    background: var(--paper);
    color: var(--ink-soft);
    fill: currentColor;
    cursor: pointer;
    touch-action: manipulation;
  }

  .tab[aria-selected='true'] {
    background: var(--accent);
    color: var(--ink);
    box-shadow: inset 0 -3px 0 var(--accent-shade);
  }

  .dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 7px;
    height: 7px;
    border: 1px solid var(--panel-edge);
    background: #e04030;
  }

  .cards {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 5.4rem;
    align-items: stretch;
    gap: 0.35rem;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    /* Folga para o selo do cartão, que passa um pouco da borda. */
    padding: 6px 6px 8px 0;
  }

  .card {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 0.15rem;
    padding: 0.3rem 0.2rem 0.35rem;
    border: 2px solid var(--panel-edge);
    background: var(--panel-hi);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
    box-shadow: inset 0 -3px 0 var(--panel-shade);
  }

  .card:not(:disabled):hover,
  .card:not(:disabled):focus-visible {
    background: #fff8d8;
    box-shadow: inset 0 -3px 0 var(--accent-shade);
  }

  .card:disabled {
    cursor: default;
    opacity: 0.55;
  }

  /* Já está no jardim: o cartão fica apagado, mas tocar acha a peça lá. */
  .card.placed .icon {
    filter: grayscale(0.6) opacity(0.7);
  }

  .card.placed small {
    color: var(--ink-soft);
  }

  /* Fechada: só a silhueta escura, com o cadeado em cima. */
  .card.locked .icon {
    filter: brightness(0) opacity(0.35);
  }

  .card.locked:disabled {
    opacity: 1;
  }

  .lock {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    fill: var(--ink);
  }

  .card.focused {
    background: #fff8d8;
    box-shadow: inset 0 -3px 0 var(--accent-shade);
    outline: 2px solid var(--accent-shade);
    outline-offset: -4px;
  }

  /* Detalhe da peça com receita, embaixo dos cartões. */
  .detail {
    display: grid;
    gap: 0.35rem;
    margin-top: 0.4rem;
    padding-top: 0.4rem;
    border-top: 2px solid var(--panel-shade);
  }

  .detail .hint {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .detail .hint.block {
    display: block;
    color: var(--ink-soft);
    font-size: 0.8rem;
  }

  .count {
    font-size: 0.8rem;
    color: var(--ink-soft);
  }

  .cost {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.8rem;
  }

  .cost li {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .cost img {
    image-rendering: pixelated;
  }

  .cost li.short strong {
    color: #c03020;
  }

  .bar {
    position: relative;
    height: 1.2rem;
    border: 2px solid var(--panel-edge);
    background: var(--paper);
    overflow: hidden;
  }

  .bar span {
    position: absolute;
    inset: 0 auto 0 0;
    background: #8ccf6a;
  }

  .bar b {
    position: relative;
    display: block;
    text-align: center;
    font-size: 0.72rem;
    line-height: 1rem;
  }

  .card small.more {
    font-size: 0.62rem;
    color: var(--ink-soft);
  }

  .card-name {
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1.15;
    text-align: center;
  }

  .card small {
    font-size: 0.68rem;
    color: var(--ink-soft);
  }

  /* O ícone em cima de um pedacinho de gramado. */
  .swatch {
    image-rendering: pixelated;
  }

  .swatch.erase {
    filter: grayscale(1) opacity(0.5);
  }

  .habitat {
    font-weight: 600;
  }

  .habitat-menu {
    display: grid;
    gap: 0.35rem;
  }

  .section {
    margin-top: 0.2rem;
    font-weight: 600;
  }

  .kinds {
    display: flex;
    gap: 0.35rem;
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }

  .kinds .kind {
    flex: none;
  }

  .kind {
    min-height: 44px;
  }

  .habitat-list {
    display: grid;
    gap: 0.3rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .habitat-row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    min-height: 44px;
  }

  .habitat-row .ready {
    color: #2f8f4e;
  }

  .thumb {
    position: relative;
    display: grid;
    place-items: end center;
    width: 4rem;
    height: 4.4rem;
    border: 1px solid var(--panel-shade);
    background: linear-gradient(#e6f2dc, #b9d9a2);
  }

  .thumb.small {
    flex: none;
    width: 2.2rem;
    height: 2.6rem;
  }

  .icon {
    display: block;
    background-repeat: no-repeat;
    image-rendering: pixelated;
    filter: drop-shadow(0 1px 0 rgb(0 0 0 / 0.25));
  }

  .badge {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 1.2rem;
    height: 1.2rem;
    padding: 0 0.2rem;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border: 2px solid var(--panel-edge);
    background: var(--accent);
    font-size: 0.7rem;
    font-weight: 700;
  }
</style>
