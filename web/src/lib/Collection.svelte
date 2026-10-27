<script lang="ts">
  import { spriteLoading } from './spriteLoading'
  import { api, errorText, type ApiError, type GameState, type OwnedPokemon } from './api'
  import PokemonSheet from './PokemonSheet.svelte'
  import { releaseYield } from './progression'
  import { play } from './sound'
  import { showdownSrc } from './sprites'

  let { game, onClose, onState }: { game: GameState; onClose: () => void; onState: () => Promise<void> } = $props()

  type Filter = 'all' | 'favorite' | 'shiny' | 'duplicate' | 'daycare'
  type Sort = 'recent' | 'level' | 'dex' | 'name'

  const storageKey = 'pocket-meadow-collection'
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'favorite', label: 'Favoritos' },
    { id: 'shiny', label: 'Shiny' },
    { id: 'duplicate', label: 'Repetidos' },
    { id: 'daycare', label: 'No daycare' },
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
  let query = $state('')
  let selecting = $state(false)
  let picked = $state<number[]>([])
  let openId = $state<number | null>(null)
  let confirm = $state(false)
  let message = $state('')
  let pending = $state(false)

  const counts = $derived.by(() => {
    const map = new Map<number, number>()
    for (const mon of game.pokemon) map.set(mon.speciesId, (map.get(mon.speciesId) ?? 0) + 1)
    return map
  })

  const visible = $derived.by(() => {
    const text = query.trim().toLocaleLowerCase('pt')
    const list = game.pokemon.filter((mon) => {
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
    <label class="sort">
      Ordem
      <select class="field" bind:value={sort}>
        {#each sorts as item (item.id)}
          <option value={item.id}>{item.label}</option>
        {/each}
      </select>
    </label>
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
      <button type="button" class="btn" onclick={() => (selecting = true)}>Selecionar</button>
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
    gap: 0.45rem;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: auto;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  /* Cresce até encher a linha (no 360px ficam ~2 por fileira; o último sozinho ocupa a linha). */
  .chip {
    flex: 1 1 7rem;
    width: auto;
    text-align: center;
  }

  .sort {
    display: grid;
    gap: 0.2rem;
    font-weight: 700;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.35rem;
  }

  .card {
    display: grid;
    justify-items: center;
    gap: 0.1rem;
    min-width: 0;
    min-height: 44px;
    padding: 0.25rem;
    border: 8px solid transparent;
    border-image: url('/ui/inlay.png') 4 fill / 8px round;
    background: none;
    font: inherit;
    font-weight: 700;
    color: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }

  .card.on {
    border-image-source: url('/ui/selected.png');
    border-image-slice: 6 fill;
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
