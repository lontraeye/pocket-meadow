<script lang="ts">
  // Como estão os Pokémon do jardim (PROGRESSAO.md, 4.2): resumo de fome,
  // carinho e felicidade; a equipe, quem trabalha (com a função) e o resto do
  // jardim; dar berry a um só ou alimentar todos. Faminto não luta.
  import { api, berryIconSrc, errorText, itemLabel, type ApiError, type GameState, type OwnedPokemon } from './api'
  import { play } from './sound'

  let {
    game,
    ids = null,
    title = 'Como estão os Pokémon',
    onState,
    onClose,
  }: {
    game: GameState
    /** Só estes (ex.: o time antes da luta); null = todo o jardim. */
    ids?: number[] | null
    title?: string
    onState: () => Promise<void>
    onClose: () => void
  } = $props()

  const pets = $derived(
    game.pokemon.filter((mon) => mon.location === 'garden' && (ids === null || ids.includes(mon.id))),
  )
  const operatorId = $derived(game.garden.bench.operatorId)
  const caretakerId = $derived(game.daycare.caretaker?.pokemonId ?? null)
  function roleOf(mon: OwnedPokemon): string | null {
    if (mon.id === operatorId) return 'Opera a bancada'
    if (mon.id === caretakerId) return 'Cuida do daycare'
    return null
  }
  const byHunger = (a: OwnedPokemon, b: OwnedPokemon) => a.pet.hunger - b.pet.hunger
  const groups = $derived(
    [
      { key: 'equipe', title: 'Equipe', list: pets.filter((mon) => mon.teamSlot !== null).sort(byHunger) },
      { key: 'trabalho', title: 'Trabalhando', list: pets.filter((mon) => mon.teamSlot === null && roleOf(mon)).sort(byHunger) },
      { key: 'jardim', title: 'Jardim', list: pets.filter((mon) => mon.teamSlot === null && !roleOf(mon)).sort(byHunger) },
    ].filter((group) => group.list.length > 0),
  )
  const average = (pick: (mon: OwnedPokemon) => number) =>
    pets.length === 0 ? 0 : Math.round(pets.reduce((sum, mon) => sum + pick(mon), 0) / pets.length)
  const summary = $derived([
    { key: 'fome', label: 'Fome', value: average((mon) => mon.pet.hunger), color: '#e8a13a' },
    { key: 'carinho', label: 'Carinho', value: average((mon) => mon.pet.affection), color: '#e0708e' },
    { key: 'felicidade', label: 'Felicidade', value: average((mon) => mon.pet.happiness), color: '#6fc46a' },
  ])
  const hungryCount = $derived(pets.filter((mon) => mon.pet.hunger < game.garden.fullAt).length)
  const berries = $derived(
    game.inventory
      .filter((row) => row.itemKey.startsWith('berry:') && row.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity),
  )

  /** Qual escolha de berry está aberta: 'all' (alimentar todos), o id de um Pokémon, ou nada. */
  let choosing = $state<'all' | number | null>(null)
  let pending = $state(false)
  let message = $state('')

  async function call(path: string, body: unknown, done: (result: { fed?: number }) => string) {
    pending = true
    message = ''
    try {
      const response = await api(path, body)
      const result = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & { fed?: number }
      if (!response.ok) {
        message = errorText(result)
        return
      }
      play('harvest')
      choosing = null
      message = done(result)
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  function feedAll(itemKey: string) {
    void call('/api/garden/pets/feed-all', { berryKey: itemKey.slice(6), ...(ids ? { ids } : {}) }, (r) => `Alimentou ${r.fed} Pokémon.`)
  }

  function feedOne(mon: OwnedPokemon, itemKey: string) {
    void call(`/api/garden/pets/${mon.id}/snack`, { berryKey: itemKey.slice(6) }, () => `${mon.nickname ?? mon.displayName} comeu.`)
  }

  const portraitSrc = (speciesId: number) => `/sprites/pmd-portrait/${speciesId}.png`
</script>

{#snippet berryChoice(onPick: (itemKey: string) => void)}
  {#if berries.length === 0}
    <p class="hint">Sem berries na mochila. Colha na horta.</p>
  {:else}
    <div class="berries">
      {#each berries as row (row.itemKey)}
        <button type="button" class="btn berry" disabled={pending} onclick={() => onPick(row.itemKey)}>
          <img src={berryIconSrc(row.itemKey.slice(6))} alt="" width="24" height="24" />
          <span>{itemLabel(row.itemKey, game.berries).replace('Berry ', '')}</span>
          <small>×{row.quantity}</small>
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="care">
  <header class="head">
    <h2>{title}</h2>
    <button type="button" class="btn close" aria-label="Fechar" onclick={onClose}>✕</button>
  </header>

  {#if pets.length === 0}
    <p class="hint">Nenhum Pokémon no jardim.</p>
  {:else}
    <!-- Resumo: médias do jardim (ou do time, quando aberto antes da luta). -->
    <div class="summary">
      {#each summary as item (item.key)}
        <div class="sum">
          <span class="sum-label">{item.label}</span>
          <span class="bar" aria-hidden="true"><i style:width="{item.value}%" style:background={item.color}></i></span>
          <span class="sum-value">{item.value}</span>
        </div>
      {/each}
    </div>

    <div class="all">
      <button
        type="button"
        class="btn btn-primary"
        disabled={pending || hungryCount === 0}
        aria-expanded={choosing === 'all'}
        onclick={() => (choosing = choosing === 'all' ? null : 'all')}
      >
        {hungryCount === 0 ? 'Ninguém com fome' : `Alimentar todos (${hungryCount})`}
      </button>
      {#if choosing === 'all'}
        <p class="hint">1 berry para cada um com fome, do mais faminto ao menos.</p>
        {@render berryChoice(feedAll)}
      {/if}
    </div>

    {#each groups as group (group.key)}
      <section class="group">
        <h3>{group.title}</h3>
        <ul class="list">
          {#each group.list as mon (mon.id)}
            {@const hunger = Math.round(mon.pet.hunger)}
            {@const starving = mon.pet.hunger < game.garden.fightMinHunger}
            {@const full = mon.pet.hunger >= game.garden.fullAt}
            {@const role = roleOf(mon)}
            <li class="row">
              <img class="portrait" src={portraitSrc(mon.speciesId)} alt="" width="40" height="40" />
              <div class="info">
                <span class="name">{mon.nickname ?? mon.displayName} <small>Nv {mon.level}</small></span>
                {#if role}<small class="role">{role}</small>{/if}
                <span class="hunger">
                  <span class="bar" class:low={starving} aria-label="Fome {hunger}"><i style:width="{hunger}%"></i></span>
                  <small class:warn={starving}>{starving ? `${hunger} · não luta` : hunger}</small>
                </span>
              </div>
              <button
                type="button"
                class="btn give"
                disabled={pending || full}
                aria-expanded={choosing === mon.id}
                onclick={() => (choosing = choosing === mon.id ? null : mon.id)}
              >
                {full ? 'Cheio' : 'Dar berry'}
              </button>
              {#if choosing === mon.id}
                <div class="pick">{@render berryChoice((itemKey) => feedOne(mon, itemKey))}</div>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}

  {#if message}<p class="message" role="status">{message}</p>{/if}
</div>

<style>
  .care {
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

  h3 {
    margin: 0 0 0.3rem;
    font-size: 0.95rem;
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

  .summary {
    display: grid;
    gap: 0.25rem;
  }

  .sum {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr) 2rem;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }

  .sum-value {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .bar {
    position: relative;
    display: block;
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

  .all {
    display: grid;
    gap: 0.35rem;
  }

  .all > .btn {
    min-height: 44px;
  }

  .list {
    display: grid;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* Retrato | nome, função e fome | botão. A escolha de berry abre embaixo. */
  .row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.45rem;
  }

  .portrait {
    image-rendering: pixelated;
    border: 2px solid var(--panel-edge, #2b2b2b);
    background: #f4efe0;
  }

  .info {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name small {
    opacity: 0.7;
  }

  .role {
    color: #3a7bd5;
    font-weight: 700;
  }

  .hunger {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
  }

  .warn {
    color: #c0392b;
    font-weight: 700;
  }

  .give {
    min-height: 44px;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    white-space: nowrap;
  }

  .pick {
    grid-column: 1 / -1;
  }

  .berries {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    gap: 0.35rem;
  }

  .berry {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    min-height: 44px;
    text-align: left;
  }

  .berry img {
    image-rendering: pixelated;
  }

  .berry span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
