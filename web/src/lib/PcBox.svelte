<script lang="ts">
  import { api, errorText, type ApiError, type GameState, type OwnedPokemon } from './api'
  import PokemonSheet from './PokemonSheet.svelte'
  import { play } from './sound'
  import { spriteLoading } from './spriteLoading'
  import { showdownSrc } from './sprites'

  /**
   * PC (como nos jogos): o time no topo e, embaixo, o jardim e o PC em
   * grade. Toque num Pokémon e depois no destino: uma vaga do time (ocupada
   * troca os dois) ou os botões Time, PC e Jardim. "Vários" move de uma vez.
   * As regras são do servidor (time de até 6, nunca vazio; daycare não sai).
   */
  let { game, onClose, onState }: { game: GameState; onClose: () => void; onState: () => Promise<void> } = $props()

  type Place = 'team' | 'garden' | 'pc'

  let tab = $state<'garden' | 'pc'>('pc')
  let pickedId = $state<number | null>(null)
  let many = $state(false)
  let marked = $state<number[]>([])
  let openId = $state<number | null>(null)
  let pending = $state(false)
  let message = $state('')

  const byLevel = (a: OwnedPokemon, b: OwnedPokemon) => b.level - a.level || a.id - b.id
  const team = $derived(
    game.pokemon.filter((mon) => mon.teamSlot !== null).sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0)),
  )
  const garden = $derived(game.pokemon.filter((mon) => mon.location === 'garden' && mon.teamSlot === null).sort(byLevel))
  const boxed = $derived(game.pokemon.filter((mon) => mon.location === 'pc').sort(byLevel))
  const shown = $derived(tab === 'pc' ? boxed : garden)
  const picked = $derived(game.pokemon.find((mon) => mon.id === pickedId) ?? null)
  const open = $derived(game.pokemon.find((mon) => mon.id === openId) ?? null)

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
      marked = marked.includes(mon.id) ? marked.filter((id) => id !== mon.id) : [...marked, mon.id]
      return
    }
    // Com alguém do time escolhido, tocar em outro do time troca as vagas.
    if (picked && placeOf(picked) !== 'team' && mon.teamSlot !== null) {
      void move(picked, 'team', mon.teamSlot)
      return
    }
    if (picked && picked.teamSlot !== null && mon.teamSlot !== null && picked.id !== mon.id) {
      void move(picked, 'team', mon.teamSlot)
      return
    }
    pickedId = pickedId === mon.id ? null : mon.id
  }

  function tapEmptySlot() {
    if (picked && !many) void move(picked, 'team')
  }

  async function send(path: string, body: unknown): Promise<boolean> {
    pending = true
    message = ''
    try {
      const response = await api(path, body)
      if (!response.ok) {
        message = errorText((await response.json().catch(() => ({ error: 'internal' }))) as ApiError)
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
      marked = []
      many = false
      tab = to
    }
  }

  function startMany() {
    pickedId = null
    marked = []
    many = true
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
            class:target={picked !== null && placeOf(picked) !== 'team' && !many}
            aria-label="Vaga {slot + 1} vazia"
            disabled={pending || picked === null || many}
            onclick={tapEmptySlot}
          >
            <span aria-hidden="true">+</span>
          </button>
        {/if}
      {/each}
    </div>
  </section>

  <div class="tabs" role="tablist">
    <button type="button" class="btn tab" class:btn-primary={tab === 'pc'} role="tab" aria-selected={tab === 'pc'} onclick={() => (tab = 'pc')}>
      PC <small>{boxed.length}</small>
    </button>
    <button type="button" class="btn tab" class:btn-primary={tab === 'garden'} role="tab" aria-selected={tab === 'garden'} onclick={() => (tab = 'garden')}>
      Jardim <small>{garden.length}</small>
    </button>
  </div>

  <div class="scroll">
    {#if shown.length === 0}
      <p class="hint">{tab === 'pc' ? 'O PC está vazio.' : 'Ninguém no jardim fora do time.'}</p>
    {:else}
      <div class="grid">
        {#each shown as mon (mon.id)}
          <button
            type="button"
            class="tile"
            class:picked={mon.id === pickedId}
            class:marked={marked.includes(mon.id)}
            aria-label="{nameOf(mon)}, nível {mon.level}"
            aria-pressed={many ? marked.includes(mon.id) : undefined}
            disabled={pending}
            onclick={() => tap(mon)}
          >
            <img use:spriteLoading={showdownSrc(mon.speciesId, mon.isShiny)} src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" loading="lazy" />
            <small>Nv {mon.level}</small>
            {#if mon.isFavorite}<span class="fav" aria-hidden="true">♥</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="dock">
    {#if message}<p class="alert" role="alert">{message}</p>{/if}
    {#if many}
      <p class="hint">{marked.length === 0 ? 'Toque para marcar vários.' : `${marked.length} marcado${marked.length === 1 ? '' : 's'}`}</p>
      <div class="row">
        <button type="button" class="btn" disabled={pending || marked.length === 0} onclick={() => void moveMarked('pc')}>→ PC</button>
        <button type="button" class="btn" disabled={pending || marked.length === 0} onclick={() => void moveMarked('garden')}>→ Jardim</button>
        <button type="button" class="btn" onclick={() => ((many = false), (marked = []))}>Cancelar</button>
      </div>
    {:else if picked}
      <p class="picked-line">
        <span><strong>{nameOf(picked)}</strong> · Nv {picked.level} · {PLACE_NAME[placeOf(picked)]}</span>
        <small>{placeOf(picked) === 'team' ? 'toque em outra vaga para trocar' : 'toque numa vaga do time para pôr ali'}</small>
      </p>
      <div class="row">
        {#if placeOf(picked) !== 'team'}
          <button type="button" class="btn btn-primary" disabled={pending} onclick={() => void move(picked, 'team')}>→ Time</button>
        {/if}
        {#if placeOf(picked) !== 'pc'}
          <button type="button" class="btn" disabled={pending} onclick={() => void move(picked, 'pc')}>→ PC</button>
        {/if}
        {#if placeOf(picked) !== 'garden'}
          <button type="button" class="btn" disabled={pending} onclick={() => void move(picked, 'garden')}>→ Jardim</button>
        {/if}
        <button type="button" class="btn" onclick={() => (openId = picked.id)}>Ficha</button>
      </div>
    {:else}
      <p class="hint">Toque num Pokémon para mover.</p>
      <div class="row">
        <button type="button" class="btn" onclick={startMany}>Vários</button>
        <button type="button" class="btn" onclick={onClose}>Voltar</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .pc {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.45rem;
    min-height: 0;
    min-width: 0;
  }

  .team {
    display: grid;
    flex: none;
    gap: 0.35rem;
  }

  .team h2 {
    margin: 0;
    font-size: 1.05rem;
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
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }

  .tab small {
    margin-left: 0.3rem;
    opacity: 0.8;
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

  .fav {
    position: absolute;
    top: 1px;
    right: 3px;
    color: var(--danger);
    font-size: 0.7rem;
  }

  .hint {
    margin: 0;
    color: var(--ink-soft);
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
