<script lang="ts">
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'

  /**
   * Overlay central reutilizável (destaques, avisos, etc.).
   * Renderiza no `document.body` para não ficar preso em `transform`
   * (ex.: painel da Pokédex).
   */
  let {
    label = 'Aviso',
    /** Toque no fundo: se omitido, o fundo só bloqueia clique sem fechar. */
    onBackdrop,
    /** No celular, o painel ocupa a tela toda (config, etc.). */
    fullMobile = false,
    children,
  }: {
    label?: string
    onBackdrop?: () => void
    fullMobile?: boolean
    children: Snippet
  } = $props()

  let host = $state<HTMLDivElement | null>(null)

  onMount(() => {
    const node = host
    if (!node) return
    document.body.appendChild(node)
    return () => {
      node.remove()
    }
  })
</script>

<div bind:this={host} class="modal" class:full-mobile={fullMobile} role="presentation">
  {#if onBackdrop}
    <button type="button" class="backdrop" aria-label="Fechar" onclick={onBackdrop}></button>
  {:else}
    <div class="backdrop" aria-hidden="true"></div>
  {/if}
  <div class="panel body" role="dialog" aria-modal="true" aria-label={label}>
    {@render children()}
  </div>
</div>

<style>
  .modal {
    position: fixed;
    z-index: 80;
    inset: 0;
    display: grid;
    place-items: center;
    padding:
      calc(env(safe-area-inset-top) + 0.75rem)
      calc(env(safe-area-inset-right) + 0.75rem)
      calc(env(safe-area-inset-bottom) + 0.75rem)
      calc(env(safe-area-inset-left) + 0.75rem);
    pointer-events: auto;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: #1a1208aa;
    cursor: pointer;
  }

  .backdrop:not(button) {
    cursor: default;
    pointer-events: auto;
  }

  .body {
    position: relative;
    z-index: 1;
    width: min(100%, 22rem);
    margin: 0;
    padding: 0.85rem 0.75rem;
  }

  @media (max-width: 699px) {
    .modal.full-mobile {
      padding: 0;
      place-items: stretch;
    }

    .modal.full-mobile .backdrop {
      display: none;
    }

    .modal.full-mobile .body {
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 100%;
      min-height: 100dvh;
      box-sizing: border-box;
      padding:
        calc(env(safe-area-inset-top) + 0.75rem)
        calc(env(safe-area-inset-right) + 0.75rem)
        calc(env(safe-area-inset-bottom) + 0.75rem)
        calc(env(safe-area-inset-left) + 0.75rem);
      border-radius: 0;
    }
  }
</style>
