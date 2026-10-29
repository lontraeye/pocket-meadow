<script lang="ts">
  import { spriteLoading } from './spriteLoading'
  import { api, errorText, type ApiError, type GameState, type OwnedPokemon } from './api'
  import PokemonSheet from './PokemonSheet.svelte'
  import { releaseYield } from './progression'
  import { play } from './sound'
  import { showdownSrc } from './sprites'

  let {
    game,
    onClose,
    onState,
    onOpenPc,
  }: { game: GameState; onClose: () => void; onState: () => Promise<void>; onOpenPc: () => void } = $props()

  type Filter = 'all' | 'team' | 'pc' | 'favorite' | 'shiny' | 'duplicate' | 'daycare'
  type Sort = 'recent' | 'level' | 'dex' | 'name'

  const storageKey = 'pocket-meadow-collection'
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'team', label: 'Time' },
    { id: 'pc', label: 'PC' },
    { id: 'favorite', label: 'Favoritos' },
    { id: 'shiny', label: 'Shiny' },
    { id: 'duplicate', label: 'Repetidos' },
    { id: 'daycare', label: 'Daycare' },
  ]
  const sorts: { id: Sort; label: string }[] = [
    { id: 'recent', label: 'Recentes' },
    { id: 'level', label: 'Nível' },
    { id: 'dex', label: 'Nº da Pokédex' },
    { id: 'name', label: 'Nome' },
  ]

  function readPrefs(): { filter: Filter; sort: Sort } {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return { filter: 'all', sort: 'recent' }
      const saved = JSON.parse(raw) as { filter?: Filter; sort?: Sort }
      const filter = filters.some((item) => item.id === saved.filter) ? saved.filter! : 'all'
      const sort = sorts.some((item) => item.id === saved.sort) ? saved.sort! : 'recent'
      return { filter, sort }
    } catch {
      return { filter: 'all', sort: 'recent' }
    }
  }

  const initial = readPrefs()
  let filter = $state<Filter>(initial.filter)
  let sort = $state<Sort>(initial.sort)
  let sortOpen = $state(false)
  let sortBtn = $state<HTMLButtonElement | null>(null)
  let sortList = $state<HTMLUListElement | null>(null)
  let query = $state('')
  let selecting = $state(false)
  let picked = $state<number[]>([])
  let openId = $state<number | null>(null)
  let confirm = $state(false)
  let message = $state('')
  let pending = $state(false)

  const sortLabel = $derived(sorts.find((item) => item.id === sort)?.label ?? 'Recentes')

  const counts = $derived.by(() => {
    const map = new Map<number, number>()
    for (const mon of game.pokemon) map.set(mon.speciesId, (map.get(mon.speciesId) ?? 0) + 1)
    return map
  })

  const visible = $derived.by(() => {
    const text = query.trim().toLocaleLowerCase('pt')
    const list = game.pokemon.filter((mon) => {
      if (filter === 'team' && mon.teamSlot === null) return false
      if (filter === 'pc' && mon.location !== 'pc') return false
      if (filter === 'favorite' && !mon.isFavorite) return false
      if (filter === 'shiny' && !mon.isShiny) return false
      if (filter === 'daycare' && mon.location !== 'daycare') return false
      if (filter === 'duplicate' && (counts.get(mon.speciesId) ?? 0) < 2) return false
      if (!text) return true
      const name = `${mon.displayName} ${mon.nickname ?? ''}`.toLocaleLowerCase('pt')
      return name.includes(text)
    })
    const byName = (mon: OwnedPokemon) => (mon.nickname ?? mon.displayName).toLocaleLowerCase('pt')
    list.sort((a, b) => {
      // No filtro Time, a ordem é a do time.
      if (filter === 'team') return (a.teamSlot ?? 0) - (b.teamSlot ?? 0)
      if (sort === 'level') return b.level - a.level || a.speciesId - b.speciesId
      if (sort === 'dex') return a.speciesId - b.speciesId || b.level - a.level
      if (sort === 'name') return byName(a).localeCompare(byName(b), 'pt')
      return b.caughtAt - a.caughtAt
    })
    return list
  })

  const open = $derived(game.pokemon.find((mon) => mon.id === openId) ?? null)
  const marked = $derived(game.pokemon.filter((mon) => picked.includes(mon.id)))
  const candyTotal = $derived(marked.reduce((sum, mon) => sum + releaseYield(mon.level, mon.isShiny, game.progression).chain, 0))
  const genericTotal = $derived(marked.reduce((sum, mon) => sum + releaseYield(mon.level, mon.isShiny, game.progression).generic, 0))
  const special = $derived(marked.filter((mon) => mon.isShiny || mon.isFavorite))
  const releaseBlocked = $derived(
    marked.length === 0
      ? 'Escolha alguém'
      : marked.length >= game.pokemon.length
        ? 'Fique com pelo menos um'
        : marked.some((mon) => mon.location === 'daycare')
          ? 'Tem alguém no daycare'
          : game.pokemon.some((mon) => mon.teamSlot !== null) &&
              game.pokemon.every((mon) => mon.teamSlot === null || picked.includes(mon.id))
            ? 'Deixe alguém no time'
          : marked.length > game.progression.releaseMax
            ? `Máximo de ${game.progression.releaseMax} por vez`
            : '',
  )

  $effect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ filter, sort }))
    } catch {
      // O navegador pode bloquear o storage; a coleção segue sem lembrar.
    }
  })

  function closeSort() {
    if (!sortOpen) return
    sortOpen = false
    sortBtn?.focus()
  }

  $effect(() => {
    if (!sortOpen) return
    const selected = sortList?.querySelector<HTMLButtonElement>('button[aria-selected="true"]')
    selected?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSort()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function toggle(id: number) {
    picked = picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id]
  }

  // O mais forte é escolhido entre todos da espécie, não só entre os visíveis:
  // com busca ou filtro ativos, ele poderia estar escondido e ir junto.
  // Shiny, favorito e quem está no daycare nunca entram no atalho.
  function keepStrongest() {
    const groups = new Map<number, OwnedPokemon[]>()
    for (const mon of game.pokemon) {
      const list = groups.get(mon.speciesId) ?? []
      list.push(mon)
      groups.set(mon.speciesId, list)
    }
    const shown = new Set(visible.map((mon) => mon.id))
    const ids: number[] = []
    for (const list of groups.values()) {
      if (list.length < 2) continue
      const keep = [...list].sort(
        (a, b) => b.level - a.level || Number(b.isFavorite) - Number(a.isFavorite) || b.xp - a.xp || a.id - b.id,
      )[0]
      for (const mon of list) {
        if (!keep || mon.id === keep.id || !shown.has(mon.id)) continue
        if (mon.isShiny || mon.isFavorite || mon.location === 'daycare') continue
        ids.push(mon.id)
      }
    }
    picked = ids.slice(0, game.progression.releaseMax)
  }

  async function releaseMarked() {
    if (releaseBlocked || pending) return
    pending = true
    message = ''
    try {
      const response = await api('/api/pokemon/release', { pokemonIds: marked.map((mon) => mon.id) })
      if (!response.ok) {
        const error = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError
        const named = error.pokemonId ? game.pokemon.find((mon) => mon.id === error.pokemonId) : undefined
        message = named ? `${named.nickname ?? named.displayName}: ${errorText(error)}` : errorText(error)
        return
      }
      picked = []
      confirm = false
      selecting = false
      play('release')
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }
</script>

<div class="collection">
  {#if open}
    <PokemonSheet {game} mon={open} onClose={() => (openId = null)} {onState} />
  {/if}
  <div class="scroll">
    {#if message}<p class="alert" role="alert">{message}</p>{/if}
    <input class="field" bind:value={query} placeholder="Buscar nome ou apelido" aria-label="Buscar" autocomplete="off" />
    <div class="chips" role="group" aria-label="Filtros">
      {#each filters as item (item.id)}
        <button type="button" class="btn chip" class:btn-primary={filter === item.id} aria-pressed={filter === item.id} onclick={() => (filter = item.id)}>
          {item.label}
        </button>
      {/each}
    </div>
    <!-- Menu próprio: o <select> nativo ignora a fonte e a lista aberta sai do tema. -->
    <div class="sort">
      <span class="sort-label" id="sort-label">Ordem</span>
      <div class="sort-menu">
        <button
          type="button"
          class="field sort-btn"
          bind:this={sortBtn}
          aria-haspopup="listbox"
          aria-expanded={sortOpen}
          aria-labelledby="sort-label"
          onclick={() => {
            if (sortOpen) closeSort()
            else sortOpen = true
          }}
        >
          <span class="sort-name">{sortLabel}</span>
          <svg class="caret" viewBox="0 0 5 3" width="10" height="6" aria-hidden="true">
            <rect x="0" y="0" width="5" height="1" /><rect x="1" y="1" width="3" height="1" /><rect x="2" y="2" width="1" height="1" />
          </svg>
        </button>
        {#if sortOpen}
          <button type="button" class="sort-dismiss" aria-label="Fechar ordem" onclick={closeSort}></button>
          <ul class="sort-list" role="listbox" aria-labelledby="sort-label" bind:this={sortList}>
            {#each sorts as item (item.id)}
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={sort === item.id}
                  class:on={sort === item.id}
                  onclick={() => {
                    sort = item.id
                    closeSort()
                  }}
                >
                  {item.label}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
    {#if visible.length === 0}
      <p class="hint">Ninguém com esse filtro.</p>
    {:else}
      <div class="grid">
        {#each visible as mon (mon.id)}
          <button
            type="button"
            class="card"
            class:on={picked.includes(mon.id)}
            aria-pressed={selecting ? picked.includes(mon.id) : undefined}
            onclick={() => (selecting ? toggle(mon.id) : (openId = mon.id))}
          >
            <img use:spriteLoading={showdownSrc(mon.speciesId, mon.isShiny)} src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" loading="lazy" width="72" height="72" />
            <span class="name">{mon.nickname ?? mon.displayName}</span>
            <small>Nv {mon.level}{mon.isShiny ? ' ★' : ''}{mon.isFavorite ? ' ♥' : ''}</small>
            {#if mon.teamSlot !== null}
              <span class="tag team-tag">Time</span>
            {:else if mon.location === 'pc'}
              <span class="tag pc-tag">PC</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <div class="dock">
    {#if confirm}
      <p class="preview">
        Soltar {marked.length} · +{candyTotal} doces e {genericTotal} genéricos.
      </p>
      {#if special.length > 0}
        <ul>
          {#each special as mon (mon.id)}
            <li>{mon.nickname ?? mon.displayName}{mon.isShiny ? ' · shiny' : ''}{mon.isFavorite ? ' · favorito' : ''}</li>
          {/each}
        </ul>
      {/if}
      <button type="button" class="btn btn-primary" disabled={pending} onclick={() => void releaseMarked()}>Confirmar</button>
      <button type="button" class="btn" disabled={pending} onclick={() => (confirm = false)}>Cancelar</button>
    {:else if selecting}
      <button type="button" class="btn btn-primary" disabled={pending || releaseBlocked !== ''} onclick={() => (confirm = true)}>
        {releaseBlocked || `Soltar ${marked.length} · +${candyTotal} doces`}
      </button>
      <button type="button" class="btn" onclick={keepStrongest}>Menos o mais forte</button>
      <button type="button" class="btn" onclick={() => { selecting = false; picked = [] }}>Cancelar</button>
    {:else}
      <div class="row">
        <button type="button" class="btn" onclick={() => (selecting = true)}>Selecionar</button>
        <button type="button" class="btn" onclick={onOpenPc}>Abrir o PC</button>
      </div>
      <button type="button" class="btn" onclick={onClose}>Jardim</button>
    {/if}
  </div>
</div>

<style>
  .collection {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.45rem;
    min-height: 0;
    min-width: 0;
  }

  .scroll {
    display: grid;
    align-content: start;
    /* Linhas no tamanho do conteúdo: a faixa de filtros (que rola de lado)
       tem altura mínima zero e era espremida. */
    grid-auto-rows: max-content;
    gap: 0.45rem;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    /* Faixa à direita só pra barra — cards não ficam por baixo. */
    padding-right: 12px;
    scrollbar-gutter: stable;
  }

  /* Uma faixa só, que rola para o lado: 7 filtros em fileiras tomavam a tela. */
  .chips {
    display: flex;
    flex: none;
    gap: 0.35rem;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding-bottom: 0.3rem;
    scrollbar-width: thin;
  }

  .chip {
    flex: none;
    width: auto;
    padding: 0 0.85rem;
    text-align: center;
  }

  .sort {
    display: grid;
    gap: 0.2rem;
    font-weight: 700;
  }

  .sort-label {
    font-weight: 700;
  }

  .sort-menu {
    position: relative;
    min-width: 0;
  }

  .sort-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    width: 100%;
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .sort-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caret {
    flex: none;
    fill: currentColor;
    shape-rendering: crispEdges;
  }

  .sort-dismiss {
    position: fixed;
    z-index: 19;
    inset: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: default;
  }

  .sort-list {
    position: absolute;
    z-index: 20;
    top: calc(100% + 0.2rem);
    left: 0;
    right: 0;
    display: grid;
    margin: 0;
    padding: 0.25rem;
    list-style: none;
    border: 2px solid var(--panel-edge);
    background: var(--panel-face);
    box-shadow:
      inset 0 0 0 1px var(--panel-shade),
      0 var(--px) 0 #0003;
  }

  .sort-list button {
    width: 100%;
    min-height: 44px;
    padding: 0 0.5rem;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 16px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .sort-list button:hover,
  .sort-list button:focus-visible {
    outline: none;
    background: #00000014;
  }

  .sort-list button.on {
    background: var(--selected-face);
    box-shadow: inset 3px 0 0 var(--selected);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.35rem;
  }

  .card {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 0.1rem;
    min-width: 0;
    min-height: 44px;
    padding: 0.35rem;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 2px 0 var(--inlay-shade);
    font: inherit;
    font-weight: 700;
    color: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }

  /* Marca no canto do card: no time ou no PC. */
  .tag {
    position: absolute;
    top: 3px;
    left: 3px;
    padding: 1px 4px;
    font-size: 11px;
    line-height: 1.2;
    color: #fff;
  }

  .team-tag {
    background: var(--primary);
  }

  .pc-tag {
    background: var(--ink-soft);
  }

  .card.on {
    border-color: var(--selected);
    background: var(--selected-face);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -2px 0 var(--selected);
  }

  .card img {
    width: 72px;
    height: 72px;
    object-fit: contain;
  }

  .name,
  small {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    font-size: 15px;
  }

  .hint,
  .preview,
  .alert {
    margin: 0;
    font-weight: 700;
  }

  .alert {
    color: var(--danger);
  }

  .dock {
    display: grid;
    flex: none;
    gap: 0.35rem;
  }

  .dock .btn {
    width: 100%;
  }

  .dock .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }

  ul {
    margin: 0;
    padding-left: 1.1rem;
    font-weight: 600;
  }

  @media (min-width: 720px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
    }
  }
</style>
