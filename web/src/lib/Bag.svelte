<script lang="ts">
  import { serverClock } from './serverClock.svelte'
  import { formatCountdown } from './time'
  import {
    api,
    ballIconSrc,
    berryIconSrc,
    effectLabel,
    errorText,
    itemLabel,
    type ActiveEffect,
    type ApiError,
    type BerryInfo,
    type GameState,
  } from './api'

  let { game, onClose, onState }: { game: GameState; onClose: () => void; onState: () => Promise<void> } = $props()

  let message = $state('')
  let pending = $state(false)
  let confirmRenew = $state<string | null>(null)

  const seeds = $derived(
    game.inventory
      .filter((row) => row.itemKey.startsWith('seed:') && row.quantity > 0)
      .sort((a, b) => a.itemKey.localeCompare(b.itemKey)),
  )
  const berries = $derived(
    game.inventory
      .filter((row) => row.itemKey.startsWith('berry:') && row.quantity > 0)
      .sort((a, b) => a.itemKey.localeCompare(b.itemKey)),
  )
  const balls = $derived(
    game.balls.list
      .map((ball) => {
        const quantity = game.inventory.find((row) => row.itemKey === ball.itemKey)?.quantity ?? 0
        return { ...ball, quantity }
      })
      .filter((ball) => ball.quantity > 0),
  )

  const clock = serverClock(() => game.now)

  function berryOf(itemKey: string): BerryInfo | undefined {
    if (!itemKey.startsWith('berry:')) return undefined
    return game.berries.find((row) => row.key === itemKey.slice(6))
  }

  function energyFull(): boolean {
    return game.trainer.energy >= game.trainer.energyMax
  }

  function oranDisabled(itemKey: string): string {
    const berry = berryOf(itemKey)
    if (berry?.key === 'oran' && game.trainer.energyEnabled && energyFull()) return 'Energia já está cheia'
    return ''
  }

  function hasSameEffect(berry: BerryInfo): ActiveEffect | undefined {
    if (!berry.effectKey) return undefined
    return game.effects.find((row) => row.effectKey === berry.effectKey)
  }

  async function useBerry(itemKey: string, force = false) {
    const berry = berryOf(itemKey)
    if (!berry) return
    const reason = oranDisabled(itemKey)
    if (reason) {
      message = reason
      return
    }
    if (!force && hasSameEffect(berry)) {
      confirmRenew = itemKey
      return
    }
    confirmRenew = null
    pending = true
    message = ''
    try {
      const response = await api(`/api/items/${encodeURIComponent(itemKey)}/use`, {})
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError
      if (!response.ok) {
        message = errorText(payload)
        return
      }
      await onState()
      message = berry.key === 'oran' ? `+energia (${berry.effectDescription})` : `Efeito: ${berry.effectDescription}`
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }
</script>

<div class="bag">
  <div class="scroll">
    {#if message}<p class="alert" role="status">{message}</p>{/if}

    {#if confirmRenew}
      {@const berry = berryOf(confirmRenew)}
      <section class="panel sheet" aria-label="Confirmar renovação">
        <h2>Renovar efeito?</h2>
        <p class="hint">Já tem esse efeito; vai renovar{berry ? ` (${berry.effectDescription})` : ''}.</p>
        <button type="button" class="btn btn-primary" disabled={pending} onclick={() => void useBerry(confirmRenew!, true)}>
          Renovar
        </button>
        <button type="button" class="btn" disabled={pending} onclick={() => (confirmRenew = null)}>Cancelar</button>
      </section>
    {/if}

    <section class="panel sheet">
      <h2>Sementes</h2>
      {#if seeds.length === 0}
        <p class="hint">Nenhuma semente.</p>
      {:else}
        <ul class="list">
          {#each seeds as row (row.itemKey)}
            {@const key = row.itemKey.slice(5)}
            <li>
              <img src={berryIconSrc(key)} alt="" width="30" height="30" />
              <span>{itemLabel(row.itemKey, game.berries, game.balls.list)}</span>
              <strong>×{row.quantity}</strong>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="panel sheet">
      <h2>Pokébolas</h2>
      {#if balls.length === 0}
        <p class="hint">Nenhuma pokébola.</p>
      {:else}
        <ul class="list">
          {#each balls as ball (ball.key)}
            <li>
              <img src={ballIconSrc(ball.sprite)} alt="" width="30" height="30" />
              <span>{ball.displayName}</span>
              <strong>×{ball.quantity}</strong>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="panel sheet">
      <h2>Berries</h2>
      {#if berries.length === 0}
        <p class="hint">Nenhuma berry.</p>
      {:else}
        <ul class="list use">
          {#each berries as row (row.itemKey)}
            {@const berry = berryOf(row.itemKey)}
            {@const disabled = oranDisabled(row.itemKey)}
            {@const bagUsable = berry?.bagUsable === true}
            <li>
              <img src={berryIconSrc(row.itemKey.slice(6))} alt="" width="30" height="30" />
              <div class="meta">
                <span>{itemLabel(row.itemKey, game.berries)} ×{row.quantity}</span>
                <small>{berry?.effectDescription ?? ''}</small>
                {#if disabled}<small class="warn">{disabled}</small>{/if}
              </div>
              {#if bagUsable}
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={pending || disabled !== ''}
                  onclick={() => void useBerry(row.itemKey)}
                >
                  Usar
                </button>
              {:else}
                <small class="warn">Só na captura</small>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="panel sheet">
      <h2>Efeitos ativos</h2>
      {#if game.effects.length === 0}
        <p class="hint">Nenhum efeito ativo.</p>
      {:else}
        <ul class="list">
          {#each game.effects as effect (effect.id)}
            <li>
              <span>{effectLabel(effect.effectKey)}{effect.multiplier}</span>
              {#if effect.charges !== null}
                <strong>{effect.charges} carga{effect.charges === 1 ? '' : 's'}</strong>
              {:else if effect.expiresAt !== null}
                <strong>{formatCountdown(Math.max(0, effect.expiresAt - clock.now()))}</strong>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
  <div class="dock">
    <button type="button" class="btn" onclick={onClose}>Fechar</button>
  </div>
</div>

<style>
  .bag {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
  }

  .scroll {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
    overflow: auto;
    /* Barra na faixa da direita, fora dos painéis (não por cima). */
    padding-right: 10px;
    scrollbar-gutter: stable;
  }

  .sheet {
    display: grid;
    gap: 0.5rem;
    padding: 0.75rem;
  }

  .sheet h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .hint {
    margin: 0;
    font-size: 0.9rem;
    opacity: 0.85;
  }

  .alert {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: #00000018;
    font-size: 0.95rem;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }

  .list li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
  }

  .list img {
    image-rendering: pixelated;
    flex: none;
  }

  .list span {
    flex: 1;
    min-width: 0;
  }

  .list.use li {
    align-items: center;
  }

  .meta {
    display: grid;
    gap: 0.1rem;
    flex: 1;
    min-width: 0;
  }

  .meta small {
    font-size: 0.8rem;
    opacity: 0.8;
  }

  .warn {
    color: #8a3a1a;
  }

  .list .btn {
    flex: none;
    align-self: center;
    min-width: 72px;
    min-height: 44px;
    padding-block: 0;
  }

  .dock {
    display: grid;
    gap: 0.35rem;
    flex: none;
  }
</style>
