<script lang="ts">
  import { isFlippable, PIECES, type PieceKey, type StructurePiece } from '@garden/layout'
  import type { GardenLayout } from './api'
  import type { BuildPick } from './build'

  // Construção do jardim (PROGRESSAO.md 4.3): a barra de baixo do modo
  // Construir. O jardim cuida dos toques na grade; aqui ficam o inventário
  // (o que está guardado) e as ações da peça escolhida.

  let {
    layout,
    pick,
    pending,
    message,
    fits,
    mouse,
    onPick,
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
    onMove: () => void
    onTurn: () => void
    onConfirm: () => void
    onStore: () => void
    onCancel: () => void
    onClose: () => void
  } = $props()

  const plotsFree = $derived(Math.max(0, layout.plotLimit - layout.plotsPlaced))
  const name = (piece: PieceKey) => PIECES[piece].name
</script>

<div class="build-tray panel" role="region" aria-label="Construir">
  <div class="head">
    <strong>Construir</strong>
    <button type="button" class="btn" onclick={onClose}>Pronto</button>
  </div>

  {#if pick?.kind === 'selected'}
    <p class="hint">{name(pick.piece)}</p>
    <div class="row">
      <button type="button" class="btn btn-primary" disabled={pending} onclick={onMove}>Mover</button>
      {#if isFlippable(pick.piece)}
        <button type="button" class="btn" disabled={pending} onclick={onTurn}>Girar</button>
      {/if}
      <button type="button" class="btn" disabled={pending} onclick={onStore}>Guardar</button>
      <button type="button" class="btn" disabled={pending} onclick={onCancel}>Voltar</button>
    </div>
  {:else if pick}
    <p class="hint">
      {#if mouse}
        Clique numa casa para {pick.kind === 'move' ? 'levar' : 'colocar'} {name(pick.piece).toLowerCase()}.{isFlippable(pick.piece)
          ? ' R gira.'
          : ''} Esc cancela.
      {:else}
        Arraste {name(pick.piece).toLowerCase()} ou use as setas, e confirme.
      {/if}
    </p>
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
    <p class="hint">Toque numa peça do jardim para mover ou guardar, ou escolha uma guardada.</p>
    <div class="row pieces">
      <button
        type="button"
        class="btn piece"
        disabled={pending || plotsFree === 0}
        onclick={() => onPick('berry_plot')}
      >
        Canteiro <small>{layout.plotsPlaced}/{layout.plotLimit}</small>
      </button>
      {#each layout.stored as piece (piece)}
        <button type="button" class="btn piece" disabled={pending} onclick={() => onPick(piece as StructurePiece)}>
          {name(piece)}
        </button>
      {/each}
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

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .piece small {
    opacity: 0.7;
    margin-left: 0.25rem;
  }
</style>
