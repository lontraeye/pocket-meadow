<script lang="ts">
  // Alimentar vários de uma vez (PROGRESSAO.md, 4.2): quem está com fome e as
  // berries da mochila; um toque dá 1 berry para cada um, do mais faminto ao
  // menos, até a berry acabar. Faminto (abaixo do corte) não luta.
  import { api, berryIconSrc, errorText, itemLabel, type ApiError, type GameState } from './api'
  import { play } from './sound'

  let {
    game,
    ids = null,
    title = 'Alimentar',
    onState,
    onClose,
  }: {
    game: GameState
    /** Só estes (ex.: o time); null = todo o jardim. */
    ids?: number[] | null
    title?: string
    onState: () => Promise<void>
    onClose: () => void
  } = $props()

  const hungry = $derived(
    game.pokemon
      .filter(
        (mon) =>
          mon.location === 'garden' &&
          mon.pet.hunger < game.garden.fullAt &&
          (ids === null || ids.includes(mon.id)),
      )
      .sort((a, b) => a.pet.hunger - b.pet.hunger),
  )
  const berries = $derived(
    game.inventory
      .filter((row) => row.itemKey.startsWith('berry:') && row.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity),
  )
  let pending = $state(false)
  let message = $state('')

  async function feed(itemKey: string) {
    pending = true
    message = ''
    try {
      const response = await api('/api/garden/pets/feed-all', { berryKey: itemKey.slice(6), ...(ids ? { ids } : {}) })
      const body = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & { fed?: number }
      if (!response.ok) {
        message = errorText(body)
        return
      }
      play('harvest')
      message = `Alimentou ${body.fed} Pokémon.`
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }
</script>

<div class="feed">
  <header class="head">
    <h2>{title}</h2>
    <button type="button" class="btn close" aria-label="Fechar" onclick={onClose}>✕</button>
  </header>
  {#if hungry.length === 0}
    <p class="hint">Ninguém com fome agora.</p>
  {:else}
    <ul class="list">
      {#each hungry as mon (mon.id)}
        {@const starving = mon.pet.hunger < game.garden.fightMinHunger}
        <li>
          <span class="name">{mon.nickname ?? mon.displayName}</span>
          <span class="bar" class:low={starving} aria-hidden="true">
            <i style:width="{Math.round(mon.pet.hunger)}%"></i>
          </span>
          {#if starving}<small class="warn">não luta</small>{/if}
        </li>
      {/each}
    </ul>
    <p class="hint">Cada um recebe 1 berry (+{game.garden.berryFill} de fome), do mais faminto ao menos.</p>
    {#if berries.length === 0}
      <p class="hint">Sem berries na mochila. Colha na horta.</p>
    {:else}
      <div class="berries">
        {#each berries as row (row.itemKey)}
          <button type="button" class="btn berry" disabled={pending} onclick={() => void feed(row.itemKey)}>
            <img src={berryIconSrc(row.itemKey.slice(6))} alt="" width="24" height="24" />
            <span>{itemLabel(row.itemKey, game.berries)}</span>
            <small>×{row.quantity}</small>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
  {#if message}<p class="message" role="status">{message}</p>{/if}
</div>

<style>
  .feed {
    display: grid;
    gap: 0.6rem;
    width: 100%;
    min-width: 0;
  }

  .head {
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
  }

  .hint,
  .message {
    margin: 0;
    font-size: 0.9rem;
  }

  .hint {
    opacity: 0.75;
  }

  .list {
    display: grid;
    gap: 0.3rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 6rem auto;
    align-items: center;
    gap: 0.4rem;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    position: relative;
    height: 10px;
    border: 2px solid var(--panel-edge, #2b2b2b);
    background: #e6e2d6;
    overflow: hidden;
  }

  .bar i {
    position: absolute;
    inset: 0 auto 0 0;
    background: #e8a13a;
  }

  .bar.low i {
    background: #d9534f;
  }

  .warn {
    color: #c0392b;
    font-weight: 700;
  }

  .berries {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    gap: 0.35rem;
  }

  .berry {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 44px;
    text-align: left;
  }

  .berry img {
    image-rendering: pixelated;
  }

  .berry span {
    flex: 1;
    min-width: 0;
  }
</style>
