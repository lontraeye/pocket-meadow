<script lang="ts">
  import { benchOperatorIds } from './structures'
  // Como estão os Pokémon do jardim (PROGRESSAO.md, 4.2): resumo de fome,
  // carinho e felicidade; a equipe, quem trabalha (com a função) e o resto do
  // jardim; dar berry a um só ou alimentar todos. Faminto não luta.
  import { api, berryIconSrc, errorText, itemLabel, type ApiError, type GameState, type OwnedPokemon } from './api'
  import { liveHpRatio } from './hp'
  import { serverClock } from './serverClock.svelte'
  import { play } from './sound'
  import { formatCountdown } from './time'

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
  const operators = $derived(benchOperatorIds(game))
  const caretakerId = $derived(game.daycare.caretaker?.pokemonId ?? null)
  function roleOf(mon: OwnedPokemon): string | null {
    if (operators.has(mon.id)) return 'Opera a bancada'
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
  /** Barrinhas de cada Pokémon, na mesma ordem da legenda. */
  const STATS = [
    { key: 'hunger', label: 'Fome', color: '#e8a13a' },
    { key: 'affection', label: 'Carinho', color: '#e0708e' },
    { key: 'happiness', label: 'Felicidade', color: '#6fc46a' },
  ] as const
  /** Cor da mini-barra de HP conforme a fração (verde → amarelo → vermelho). */
  function hpColor(ratio: number): string {
    if (ratio <= 0) return '#d9534f'
    if (ratio < 0.25) return '#d9534f'
    if (ratio < 0.5) return '#e8a13a'
    return '#4caf7a'
  }
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

  const clock = serverClock(() => game.now)
  /** Quanto falta para o carinho voltar (0 = já pode). */
  function petWaitMs(mon: OwnedPokemon): number {
    return mon.pet.petReadyAt === null ? 0 : Math.max(0, mon.pet.petReadyAt - clock.now())
  }
  const pettable = $derived(pets.filter((mon) => petWaitMs(mon) === 0 && mon.pet.affection < 100))

  async function petOne(mon: OwnedPokemon) {
    pending = true
    message = ''
    try {
      const response = await api(`/api/garden/pets/${mon.id}/pet`, {})
      if (!response.ok) {
        message = errorText((await response.json().catch(() => ({ error: 'internal' }))) as ApiError)
        return
      }
      play('levelup')
      choosing = null
      message = `${mon.nickname ?? mon.displayName} adorou o carinho!`
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  /** Carinho em quem pode agora, um por um (não há rota em lote). */
  async function petAll() {
    const list = pettable
    pending = true
    message = ''
    let done = 0
    try {
      for (const mon of list) {
        const response = await api(`/api/garden/pets/${mon.id}/pet`, {})
        if (response.ok) done += 1
      }
      if (done > 0) play('levelup')
      choosing = null
      message = `Fez carinho em ${done} Pokémon.`
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  const portraitSrc =(speciesId: number) => `/sprites/pmd-portrait/${speciesId}.png`
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
    <!-- Legenda das barrinhas de cada Pokémon. -->
    <p class="legend">
      {#each STATS as stat (stat.key)}
        <span><i style:background={stat.color}></i>{stat.label}</span>
      {/each}
      <span><i style:background="#4caf7a"></i>HP</span>
    </p>

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
      <button type="button" class="btn" disabled={pending || pettable.length === 0} onclick={() => void petAll()}>
        {pettable.length === 0 ? 'Carinho já dado' : `Carinho em todos (${pettable.length})`}
      </button>
    </div>

    {#each groups as group (group.key)}
      <section class="group">
        <h3>{group.title}</h3>
        <ul class="list">
          {#each group.list as mon (mon.id)}
            {@const starving = mon.pet.hunger < game.garden.fightMinHunger}
            {@const hp = liveHpRatio(mon, game, clock.now())}
            {@const fainted = hp <= 0}
            {@const full = mon.pet.hunger >= game.garden.fullAt}
            {@const role = roleOf(mon)}
            {@const wait = petWaitMs(mon)}
            {@const hpPct = Math.round(hp * 100)}
            <li class="row">
              <img class="portrait" src={portraitSrc(mon.speciesId)} alt="" width="40" height="40" />
              <div class="info">
                <span class="name">{mon.nickname ?? mon.displayName} <small>Nv {mon.level}</small></span>
                {#if role}<small class="role">{role}</small>{/if}
                <span class="stats">
                  {#each STATS as stat (stat.key)}
                    {@const value = Math.round(mon.pet[stat.key])}
                    <span class="mini" aria-label="{stat.label} {value}" title="{stat.label} {value}">
                      <i style:width="{value}%" style:background={stat.key === 'hunger' && starving ? '#d9534f' : stat.color}></i>
                    </span>
                  {/each}
                  <span class="mini" aria-label="HP {hpPct}" title="HP {hpPct}">
                    <i style:width="{hpPct}%" style:background={hpColor(hp)}></i>
                  </span>
                </span>
                {#if fainted}<small class="warn">desmaiado · não luta</small>
                {:else if starving}<small class="warn">com fome · não luta</small>{/if}
              </div>
              <div class="acts">
                <button
                  type="button"
                  class="btn give"
                  disabled={pending || full}
                  aria-expanded={choosing === mon.id}
                  onclick={() => (choosing = choosing === mon.id ? null : mon.id)}
                >
                  {full ? 'Cheio' : 'Dar berry'}
                </button>
                <button
                  type="button"
                  class="btn give"
                  disabled={pending || wait > 0 || mon.pet.affection >= 100}
                  onclick={() => void petOne(mon)}
                >
                  {wait > 0 ? `Carinho ${formatCountdown(wait)}` : 'Carinho'}
                </button>
              </div>
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

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 0;
    font-size: 0.8rem;
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .legend i {
    display: inline-block;
    width: 10px;
    height: 6px;
  }

  /* Três barrinhas finas por Pokémon: fome, carinho, felicidade. */
  .stats {
    display: grid;
    gap: 2px;
    max-width: 9rem;
  }

  .mini {
    position: relative;
    display: block;
    height: 4px;
    background: #00000022;
    overflow: hidden;
  }

  .mini i {
    position: absolute;
    inset: 0 auto 0 0;
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

  .warn {
    font-size: 0.75rem;
    color: #c0392b;
    font-weight: 700;
  }

  .give {
    min-height: 44px;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    white-space: nowrap;
  }

  .acts {
    display: grid;
    gap: 0.3rem;
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
