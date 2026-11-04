<script lang="ts">
  import { isFlippable, PIECES, STRUCTURE_PIECES, type PieceKey } from '@garden/layout'
  import type { GardenLayout } from './api'
  import type { BuildPick } from './build'
  import { BUILD_CATEGORIES, ICON_H, ICON_W, PIECE_ICONS, type BuildCategory } from './buildIcons'

  // Construção do jardim (PROGRESSAO.md 4.3): a barra de baixo do modo
  // Construir. O jardim cuida dos toques na grade; aqui ficam o catálogo (abas
  // por categoria e um cartão com ícone por peça) e as ações da peça escolhida.

  let {
    layout,
    pick,
    pending,
    message,
    fits,
    mouse,
    onPick,
    onSelectPlaced,
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
    onPick: (piece: PieceKey) => void
    /** Cartão de uma peça que já está no jardim: seleciona ela lá. */
    onSelectPlaced: (id: number) => void
    onMove: () => void
    onTurn: () => void
    onConfirm: () => void
    onStore: () => void
    onCancel: () => void
    onClose: () => void
  } = $props()

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
    return out
  })

  let tab = $state<BuildCategory | 'all'>('all')
  const tabs = $derived(
    BUILD_CATEGORIES.map((category) => ({
      ...category,
      waiting: cards.filter((card) => card.ready && category.pieces.includes(card.piece)).length,
    })).filter((category) => cards.some((card) => category.pieces.includes(card.piece))),
  )
  const shown = $derived(
    tab === 'all' ? cards : cards.filter((card) => BUILD_CATEGORIES.find((row) => row.key === tab)?.pieces.includes(card.piece)),
  )
  const waitingAll = $derived(cards.filter((card) => card.ready).length)

  function onCard(card: Card) {
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

{#snippet tabIcon(key: BuildCategory | 'all')}
  <!-- Ícones em pixels (grade 12×12), como os do jardim. -->
  <svg viewBox="0 0 12 12" width="18" height="18" shape-rendering="crispEdges" aria-hidden="true">
    {#if key === 'all'}
      <rect x="1" y="1" width="4" height="4" /><rect x="7" y="1" width="4" height="4" />
      <rect x="1" y="7" width="4" height="4" /><rect x="7" y="7" width="4" height="4" />
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

{#snippet catalogTabs()}
  <div class="tabs" role="tablist" aria-label="Categorias">
    <button
      type="button"
      class="tab"
      role="tab"
      aria-selected={tab === 'all'}
      aria-label="Tudo"
      title="Tudo"
      onclick={() => (tab = 'all')}
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
        onclick={() => (tab = category.key)}
      >
        {@render tabIcon(category.key)}
        {#if category.waiting > 0}<span class="dot" aria-hidden="true"></span>{/if}
      </button>
    {/each}
  </div>
{/snippet}

<div class="build-tray panel" role="region" aria-label="Construir">
  <div class="head">
    {#if pick}
      <strong>Construir</strong>
    {:else}
      {@render catalogTabs()}
    {/if}
    <button type="button" class="btn" onclick={onClose}>Pronto</button>
  </div>

  {#if pick?.kind === 'selected'}
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
  {:else}
    <div class="catalog">
      <div class="cards" role="tabpanel">
        {#each shown as card (card.piece)}
          <button
            type="button"
            class="card"
            class:placed={!card.ready}
            class:locked={card.locked}
            disabled={pending || (!card.ready && card.placedId === null)}
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
    gap: 0.4rem;
    color: var(--ink);
    pointer-events: auto;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
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
    gap: 0.25rem;
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
    padding: 6px 6px 2px 0;
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
