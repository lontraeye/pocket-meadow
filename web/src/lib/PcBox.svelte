<script lang="ts">
  import { api, errorText, type ApiError, type GameState, type OwnedPokemon } from './api'
  import PokemonSheet from './PokemonSheet.svelte'
  import { releaseYield } from './progression'
  import { play } from './sound'
  import { spriteLoading } from './spriteLoading'
  import { showdownSrc } from './sprites'

  /**
   * PC (como nos jogos), que é também a coleção: o time no topo e, embaixo,
   * o PC, o jardim e o daycare em grade, com busca, filtros e ordem. Toque num
   * Pokémon e depois no destino: uma vaga do time (ocupada troca os dois) ou os
   * botões Time, PC e Jardim. "Selecionar" move ou solta vários de uma vez. As regras são
   * do servidor (time de até 6, nunca vazio; daycare não sai).
   */
  let { game, onClose, onState }: { game: GameState; onClose: () => void; onState: () => Promise<void> } = $props()

  type Place = 'team' | 'garden' | 'pc'
  type Tab = 'pc' | 'garden' | 'daycare'
  type Filter = 'all' | 'favorite' | 'shiny' | 'duplicate'
  type Sort = 'recent' | 'level' | 'dex' | 'name'

  const storageKey = 'pocket-meadow-pc'
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'favorite', label: 'Favoritos' },
    { id: 'shiny', label: 'Shiny' },
    { id: 'duplicate', label: 'Repetidos' },
  ]
  const sorts: { id: Sort; label: string }[] = [
    { id: 'recent', label: 'Recentes' },
    { id: 'level', label: 'Nível' },
    { id: 'dex', label: 'Nº' },
    { id: 'name', label: 'Nome' },
  ]

  function readPrefs(): { tab: Tab; filter: Filter; sort: Sort } {
    const fallback = { tab: 'pc' as Tab, filter: 'all' as Filter, sort: 'level' as Sort }
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return fallback
      const saved = JSON.parse(raw) as { tab?: Tab; filter?: Filter; sort?: Sort }
      return {
        tab: saved.tab === 'garden' || saved.tab === 'daycare' || saved.tab === 'pc' ? saved.tab : fallback.tab,
        filter: filters.some((item) => item.id === saved.filter) ? saved.filter! : fallback.filter,
        sort: sorts.some((item) => item.id === saved.sort) ? saved.sort! : fallback.sort,
      }
    } catch {
      return fallback
    }
  }

  const initial = readPrefs()
  let tab = $state<Tab>(initial.tab)
  let filter = $state<Filter>(initial.filter)
  let sort = $state<Sort>(initial.sort)
  let toolsOpen = $state(false)
  let query = $state('')
  let pickedId = $state<number | null>(null)
  /** Tocou numa vaga vazia sem ninguém escolhido: o próximo toque escolhe quem entra. */
  let filling = $state(false)
  let many = $state(false)
  let marked = $state<number[]>([])
  let confirmRelease = $state(false)
  let openId = $state<number | null>(null)
  let pending = $state(false)
  let message = $state('')

  $effect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ tab, filter, sort }))
    } catch {
      // O navegador pode bloquear o storage; o PC segue sem lembrar.
    }
  })

  const counts = $derived.by(() => {
    const map = new Map<number, number>()
    for (const mon of game.pokemon) map.set(mon.speciesId, (map.get(mon.speciesId) ?? 0) + 1)
    return map
  })

  const team = $derived(
    game.pokemon.filter((mon) => mon.teamSlot !== null).sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0)),
  )
  const inTab = (mon: OwnedPokemon, which: Tab): boolean =>
    which === 'pc'
      ? mon.location === 'pc'
      : which === 'daycare'
        ? mon.location === 'daycare'
        : mon.location === 'garden' && mon.teamSlot === null
  const tabCount = $derived({
    pc: game.pokemon.filter((mon) => inTab(mon, 'pc')).length,
    garden: game.pokemon.filter((mon) => inTab(mon, 'garden')).length,
    daycare: game.pokemon.filter((mon) => inTab(mon, 'daycare')).length,
  })

  const shown = $derived.by(() => {
    const text = query.trim().toLocaleLowerCase('pt')
    const byName = (mon: OwnedPokemon) => (mon.nickname ?? mon.displayName).toLocaleLowerCase('pt')
    const list = game.pokemon.filter((mon) => {
      if (!inTab(mon, tab)) return false
      if (filter === 'favorite' && !mon.isFavorite) return false
      if (filter === 'shiny' && !mon.isShiny) return false
      if (filter === 'duplicate' && (counts.get(mon.speciesId) ?? 0) < 2) return false
      if (!text) return true
      return `${mon.displayName} ${mon.nickname ?? ''}`.toLocaleLowerCase('pt').includes(text)
    })
    list.sort((a, b) => {
      if (sort === 'level') return b.level - a.level || a.id - b.id
      if (sort === 'dex') return a.speciesId - b.speciesId || b.level - a.level
      if (sort === 'name') return byName(a).localeCompare(byName(b), 'pt')
      return b.caughtAt - a.caughtAt
    })
    return list
  })

  const picked = $derived(game.pokemon.find((mon) => mon.id === pickedId) ?? null)
  const open = $derived(game.pokemon.find((mon) => mon.id === openId) ?? null)
  const markedMons = $derived(game.pokemon.filter((mon) => marked.includes(mon.id)))
  const candyTotal = $derived(markedMons.reduce((sum, mon) => sum + releaseYield(mon.level, mon.isShiny, game.progression).chain, 0))
  const genericTotal = $derived(markedMons.reduce((sum, mon) => sum + releaseYield(mon.level, mon.isShiny, game.progression).generic, 0))
  const special = $derived(markedMons.filter((mon) => mon.isShiny || mon.isFavorite))
  const releaseBlocked = $derived(
    markedMons.length === 0
      ? 'Escolha alguém'
      : markedMons.length >= game.pokemon.length
        ? 'Fique com pelo menos um'
        : markedMons.some((mon) => mon.location === 'daycare')
          ? 'Tem alguém no daycare'
          : team.length > 0 && team.every((mon) => marked.includes(mon.id))
            ? 'Deixe alguém no time'
            : markedMons.length > game.progression.releaseMax
              ? `Máximo de ${game.progression.releaseMax} por vez`
              : '',
  )
  const filtered = $derived(filter !== 'all' || query.trim() !== '')

  function placeOf(mon: OwnedPokemon): Place {
    return mon.teamSlot !== null ? 'team' : mon.location === 'pc' ? 'pc' : 'garden'
  }

  const PLACE_NAME: Record<Place, string> = { team: 'no time', garden: 'no jardim', pc: 'no PC' }

  function nameOf(mon: OwnedPokemon): string {
    return mon.nickname ?? mon.displayName
  }

  function tap(mon: OwnedPokemon) {
    play('tap')
    message = ''
    if (many) {
      if (mon.location === 'daycare') return
      marked = marked.includes(mon.id) ? marked.filter((id) => id !== mon.id) : [...marked, mon.id]
      return
    }
    // No daycare só dá para ver a ficha.
    if (mon.location === 'daycare') {
      openId = mon.id
      return
    }
    // Vaga vazia escolhida antes: quem for tocado (fora do time) entra.
    if (filling && mon.teamSlot === null) {
      filling = false
      void move(mon, 'team')
      return
    }
    filling = false
    // Com alguém escolhido, tocar num do time põe naquela vaga (ou troca).
    if (picked && picked.id !== mon.id && mon.teamSlot !== null) {
      void move(picked, 'team', mon.teamSlot)
      return
    }
    pickedId = pickedId === mon.id ? null : mon.id
  }

  function tapEmptySlot() {
    if (many) return
    play('tap')
    message = ''
    if (picked && placeOf(picked) !== 'team') {
      void move(picked, 'team')
      return
    }
    // Sem ninguém escolhido (ou escolhido do próprio time): pede quem entra.
    pickedId = null
    filling = !filling
  }

  async function send(path: string, body: unknown): Promise<boolean> {
    pending = true
    message = ''
    try {
      const response = await api(path, body)
      if (!response.ok) {
        const error = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError
        const named = error.pokemonId ? game.pokemon.find((mon) => mon.id === error.pokemonId) : undefined
        message = named ? `${nameOf(named)}: ${errorText(error)}` : errorText(error)
        return false
      }
      await onState()
      return true
    } catch {
      message = 'Sem conexão com o servidor.'
      return false
    } finally {
      pending = false
    }
  }

  async function move(mon: OwnedPokemon, to: Place, slot?: number) {
    const ok = await send('/api/pc/move', { pokemonId: mon.id, to, ...(slot !== undefined ? { slot } : {}) })
    if (ok) {
      pickedId = null
      if (to !== 'team') tab = to
    }
  }

  async function moveMarked(to: 'garden' | 'pc') {
    if (marked.length === 0) return
    const ok = await send('/api/pc/move-many', { pokemonIds: marked, to })
    if (ok) {
      stopMany()
      tab = to
    }
  }

  async function releaseMarked() {
    if (releaseBlocked || pending) return
    const ok = await send('/api/pokemon/release', { pokemonIds: marked })
    if (ok) {
      play('release')
      stopMany()
    }
  }

  function startMany() {
    pickedId = null
    filling = false
    marked = []
    confirmRelease = false
    many = true
  }

  function stopMany() {
    many = false
    marked = []
    confirmRelease = false
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
    const visible = new Set(shown.map((mon) => mon.id))
    const ids: number[] = []
    for (const list of groups.values()) {
      if (list.length < 2) continue
      const keep = [...list].sort(
        (a, b) => b.level - a.level || Number(b.isFavorite) - Number(a.isFavorite) || b.xp - a.xp || a.id - b.id,
      )[0]
      for (const mon of list) {
        if (!keep || mon.id === keep.id || !visible.has(mon.id)) continue
        if (mon.isShiny || mon.isFavorite || mon.location === 'daycare') continue
        ids.push(mon.id)
      }
    }
    marked = ids.slice(0, game.progression.releaseMax)
  }
</script>

<div class="pc">
  {#if open}
    <PokemonSheet {game} mon={open} onClose={() => (openId = null)} {onState} />
  {/if}

  <section class="panel sheet team" aria-label="Time">
    <h2>Time <small>{team.length}/{game.trainer.teamMax}</small></h2>
    <div class="team-grid">
      {#each Array.from({ length: game.trainer.teamMax }, (_, i) => i) as slot (slot)}
        {@const mon = team[slot]}
        {#if mon}
          <button
            type="button"
            class="tile"
            class:picked={mon.id === pickedId}
            class:marked={marked.includes(mon.id)}
            class:target={picked !== null && picked.id !== mon.id && !many}
            aria-label="{nameOf(mon)}, nível {mon.level}, vaga {slot + 1} do time"
            disabled={pending}
            onclick={() => tap(mon)}
          >
            <img use:spriteLoading={showdownSrc(mon.speciesId, mon.isShiny)} src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" />
            <small>Nv {mon.level}</small>
          </button>
        {:else}
          <button
            type="button"
            class="tile empty"
            class:target={(picked !== null && placeOf(picked) !== 'team' && !many) || filling}
            aria-label="Vaga {slot + 1} vazia: pôr alguém no time"
            disabled={pending || many}
            onclick={tapEmptySlot}
          >
            <span aria-hidden="true">+</span>
          </button>
        {/if}
      {/each}
    </div>
  </section>

  <div class="tabs" role="tablist">
    {#each [{ id: 'pc', label: 'PC' }, { id: 'garden', label: 'Jardim' }, { id: 'daycare', label: 'Daycare' }] as item (item.id)}
      <button
        type="button"
        class="btn tab"
        class:btn-primary={tab === item.id}
        role="tab"
        aria-selected={tab === item.id}
        onclick={() => (tab = item.id as Tab)}
      >
        {item.label} <small>{tabCount[item.id as Tab]}</small>
      </button>
    {/each}
  </div>

  <div class="tools">
    <input class="field" bind:value={query} placeholder="Buscar nome ou apelido" aria-label="Buscar" autocomplete="off" />
    <button type="button" class="btn tools-btn" class:on={filtered} aria-expanded={toolsOpen} onclick={() => (toolsOpen = !toolsOpen)}>
      Filtrar
    </button>
  </div>
  {#if toolsOpen}
    <div class="chips" role="group" aria-label="Filtros">
      {#each filters as item (item.id)}
        <button type="button" class="btn chip" class:btn-primary={filter === item.id} aria-pressed={filter === item.id} onclick={() => (filter = item.id)}>
          {item.label}
        </button>
      {/each}
    </div>
    <div class="chips" role="group" aria-label="Ordem">
      {#each sorts as item (item.id)}
        <button type="button" class="btn chip" class:btn-primary={sort === item.id} aria-pressed={sort === item.id} onclick={() => (sort = item.id)}>
          {item.label}
        </button>
      {/each}
    </div>
  {/if}

  <div class="scroll">
    {#if shown.length === 0}
      <p class="hint">
        {filtered
          ? 'Ninguém com esse filtro.'
          : tab === 'pc'
            ? 'O PC está vazio.'
            : tab === 'daycare'
              ? 'Ninguém no daycare.'
              : 'Ninguém no jardim fora do time.'}
      </p>
    {:else}
      <div class="grid">
        {#each shown as mon (mon.id)}
          <button
            type="button"
            class="tile"
            class:picked={mon.id === pickedId}
            class:marked={marked.includes(mon.id)}
            class:locked={many && mon.location === 'daycare'}
            aria-label="{nameOf(mon)}, nível {mon.level}"
            aria-pressed={many ? marked.includes(mon.id) : undefined}
            disabled={pending}
            onclick={() => tap(mon)}
          >
            <img use:spriteLoading={showdownSrc(mon.speciesId, mon.isShiny)} src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" loading="lazy" />
            <small>Nv {mon.level}</small>
            {#if mon.isFavorite}<span class="fav" aria-hidden="true">♥</span>{/if}
            {#if mon.isShiny}<span class="shiny" aria-hidden="true">★</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="dock">
    {#if message}<p class="alert" role="alert">{message}</p>{/if}
    {#if many && confirmRelease}
      <p class="hint">Soltar {markedMons.length} · +{candyTotal} doces e {genericTotal} genéricos.</p>
      {#if special.length > 0}
        <p class="warn">
          {special.map((mon) => `${nameOf(mon)}${mon.isShiny ? ' (shiny)' : ''}${mon.isFavorite ? ' (favorito)' : ''}`).join(', ')}
        </p>
      {/if}
      <div class="row">
        <button type="button" class="btn danger" disabled={pending} onclick={() => void releaseMarked()}>Confirmar soltura</button>
        <button type="button" class="btn" disabled={pending} onclick={() => (confirmRelease = false)}>Cancelar</button>
      </div>
    {:else if many}
      <p class="hint">
        {marked.length === 0 ? 'Toque para marcar vários.' : `${marked.length} marcado${marked.length === 1 ? '' : 's'} · +${candyTotal} doces se soltar`}
      </p>
      <div class="row">
        <button type="button" class="btn" disabled={pending || marked.length === 0} onclick={() => void moveMarked('pc')}>→ PC</button>
        <button type="button" class="btn" disabled={pending || marked.length === 0} onclick={() => void moveMarked('garden')}>→ Jardim</button>
        <button type="button" class="btn" disabled={pending || releaseBlocked !== ''} onclick={() => (confirmRelease = true)}>Soltar</button>
      </div>
      <div class="row">
        <button type="button" class="btn" disabled={pending} onclick={keepStrongest}>Menos o mais forte</button>
        <button type="button" class="btn" onclick={stopMany}>Cancelar</button>
      </div>
    {:else if filling}
      <p class="hint">Escolha quem vai para o time (no PC ou no jardim).</p>
      <div class="row">
        <button type="button" class="btn" onclick={() => (filling = false)}>Cancelar</button>
        <button type="button" class="btn" onclick={onClose}>Sair</button>
      </div>
    {:else if picked}
      <p class="picked-line">
        <span><strong>{nameOf(picked)}</strong> · Nv {picked.level} · {PLACE_NAME[placeOf(picked)]}</span>
        <small>{placeOf(picked) === 'team' ? 'toque em outra vaga para trocar' : 'toque numa vaga do time para pôr no time'}</small>
      </p>
      <div class="row">
        {#if placeOf(picked) !== 'pc'}
          <button type="button" class="btn" disabled={pending} onclick={() => void move(picked, 'pc')}>→ PC</button>
        {/if}
        {#if placeOf(picked) !== 'garden'}
          <button type="button" class="btn" disabled={pending} onclick={() => void move(picked, 'garden')}>→ Jardim</button>
        {/if}
        <button type="button" class="btn" onclick={() => (openId = picked.id)}>Ficha</button>
        <button type="button" class="btn" onclick={onClose}>Sair</button>
      </div>
    {:else}
      <div class="row">
        <button type="button" class="btn" onclick={startMany}>Selecionar</button>
        <button type="button" class="btn" onclick={onClose}>Sair</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .pc {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.4rem;
    min-height: 0;
    min-width: 0;
  }

  .team {
    display: grid;
    flex: none;
    gap: 0.3rem;
    padding: 0.4rem 0.5rem;
  }

  .team h2 {
    margin: 0;
    font-size: 1rem;
  }

  .team h2 small {
    color: var(--ink-soft);
  }

  .team-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.25rem;
  }

  .tabs {
    display: grid;
    flex: none;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.3rem;
  }

  .tab {
    min-height: 40px;
    padding: 0 0.3rem;
    font-size: 16px;
  }

  .tab small {
    margin-left: 0.25rem;
    opacity: 0.8;
  }

  .tools {
    display: grid;
    flex: none;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.3rem;
  }

  .tools .field {
    min-width: 0;
  }

  .tools-btn {
    min-height: 44px;
    padding: 0 0.7rem;
  }

  .tools-btn.on {
    border-color: var(--primary);
    color: var(--primary);
  }

  /* Uma faixa só, que rola para o lado. */
  .chips {
    display: flex;
    flex: none;
    gap: 0.3rem;
    overflow-x: auto;
    padding-bottom: 0.2rem;
    scrollbar-width: thin;
  }

  .chip {
    flex: none;
    min-height: 40px;
    padding: 0 0.75rem;
    font-size: 16px;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-right: 10px;
    scrollbar-gutter: stable;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.25rem;
  }

  .tile {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 0;
    min-width: 0;
    min-height: 56px;
    padding: 2px;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 2px 0 var(--inlay-shade);
    color: inherit;
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }

  .tile img {
    width: 100%;
    max-width: 48px;
    aspect-ratio: 1;
    object-fit: contain;
    image-rendering: pixelated;
  }

  .tile small {
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1;
  }

  .tile.empty {
    place-items: center;
    border-style: dashed;
    color: var(--ink-soft);
    font-size: 1.3rem;
    background: none;
    box-shadow: none;
  }

  .tile.empty:disabled {
    cursor: default;
  }

  .tile.target {
    border-color: var(--primary);
  }

  .tile.picked,
  .tile.marked {
    border-color: var(--selected);
    background: var(--selected-face);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -2px 0 var(--selected);
  }

  .tile.locked {
    opacity: 0.5;
  }

  .fav,
  .shiny {
    position: absolute;
    top: 1px;
    font-size: 0.7rem;
  }

  .fav {
    right: 3px;
    color: var(--danger);
  }

  .shiny {
    left: 3px;
    color: var(--accent-shade);
  }

  .hint,
  .warn {
    margin: 0;
    color: var(--ink-soft);
  }

  .warn {
    color: var(--danger);
    font-weight: 700;
  }

  .dock {
    display: grid;
    flex: none;
    gap: 0.35rem;
  }

  .row {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: 0.35rem;
  }

  .row .btn {
    width: 100%;
    padding: 0 0.4rem;
  }

  .danger {
    color: var(--danger);
  }

  .picked-line {
    display: grid;
    margin: 0;
  }

  .picked-line small {
    color: var(--ink-soft);
  }

  .alert {
    margin: 0;
  }
</style>
