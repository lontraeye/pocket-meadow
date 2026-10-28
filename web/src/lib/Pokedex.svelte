<script lang="ts">
  import { onMount } from 'svelte'
  import { api, errorText, itemLabel, type ApiError, type BerryInfo, type GameState } from './api'
  import { albumClaimCards, type HighlightCard } from './highlights'
  import Highlights from './Highlights.svelte'
  import PmdSprite from './PmdSprite.svelte'
  import { gardenSprite, groundAt, pmdAnim, showdownSrc } from './sprites'
  import StatTable from './StatTable.svelte'
  import { typeLabelPt } from './typesPt'

  let {
    game,
    onState,
    onClose,
  }: {
    game: GameState
    onState: () => Promise<void>
    onClose: () => void
  } = $props()

  type DexLayer = 'unknown' | 'seen' | 'caught' | 'locations' | 'moves'
  type EvoMember = { id: number; displayName?: string; stage: number }
  type DexSpecies = {
    id: number
    layer: DexLayer
    displayName?: string
    type1?: string
    type2?: string | null
    evolution?: EvoMember[]
    abilities?: { slot1: string; slot2: string | null; hidden: string | null }
    locations?: {
      regionSlug: string
      regionName: string
      minLevel: number
      maxLevel: number
      rarity: 'common' | 'uncommon' | 'rare'
    }[]
    moves?: {
      name: string
      displayName: string
      type: string
      power: number
      damageClass: string
      kind: 'fast' | 'charged'
      level: number
    }[]
    baseStats?: {
      hp: number
      attack: number
      defense: number
      spAttack: number
      spDefense: number
      speed: number
    }
    maxLevelReached?: number
    nextUnlock?: { needLevel: number; unlocks: 'locations' | 'moves' } | null
  }
  type DexPayload = {
    total: number
    seen: number
    caught: number
    milestones: { locations: number; moves: number }
    species: DexSpecies[]
  }
  type AlbumBlock = {
    key: string
    kind: 'region' | 'chain' | 'game' | string
    title: string
    total: number
    caught: number
    complete: boolean
    claimed: boolean
    reward: {
      items: { itemKey: string; quantity: number }[]
      genericCandies: number
      energy: number
    }
  }

  type Tab = 'list' | 'album' | 'guide'
  type Filter = 'all' | 'seen' | 'caught' | 'missing'

  let tab = $state<Tab>('list')
  let filter = $state<Filter>('all')
  let query = $state('')
  let regionFilter = $state('')
  let regionOpen = $state(false)
  let dex = $state<DexPayload | null>(null)
  let blocks = $state<AlbumBlock[]>([])
  let message = $state('')
  let pending = $state(false)
  let openId = $state<number | null>(null)
  let cards = $state<HighlightCard[]>([])
  let visibleIds = $state<Set<number>>(new Set())

  const open = $derived(dex?.species.find((row) => row.id === openId) ?? null)
  const byId = $derived(new Map((dex?.species ?? []).map((row) => [row.id, row])))

  const TYPE_GLOW: Record<string, string> = {
    normal: '#a8a878',
    fire: '#f08030',
    water: '#6890f0',
    electric: '#f8d030',
    grass: '#78c850',
    ice: '#98d8d8',
    fighting: '#c03028',
    poison: '#a040a0',
    ground: '#e0c068',
    flying: '#a890f0',
    psychic: '#f85888',
    bug: '#a8b820',
    rock: '#b8a038',
    ghost: '#705898',
    dragon: '#7038f8',
    dark: '#705848',
    steel: '#b8b8d0',
    fairy: '#ee99ac',
  }

  const regions = $derived(
    [
      ...new Set([
        ...blocks.filter((b) => b.kind === 'region').map((b) => b.title),
        ...(dex?.species ?? []).flatMap((sp) => (sp.locations ?? []).map((loc) => loc.regionName)),
      ]),
    ].sort((a, b) => a.localeCompare(b, 'pt')),
  )

  const regionBlocks = $derived(blocks.filter((b) => b.kind === 'region'))
  const chainBlocks = $derived(blocks.filter((b) => b.kind === 'chain'))
  const gameBlocks = $derived(blocks.filter((b) => b.kind === 'game'))

  const visible = $derived.by(() => {
    if (!dex) return []
    const text = query.trim().toLocaleLowerCase('pt')
    return dex.species.filter((sp) => {
      if (filter === 'seen' && sp.layer === 'unknown') return false
      if (filter === 'caught' && (sp.layer === 'unknown' || sp.layer === 'seen')) return false
      if (filter === 'missing' && sp.layer !== 'unknown' && sp.layer !== 'seen') return false
      if (regionFilter) {
        // Só quem já liberou "onde encontrar" tem região na resposta.
        if (!(sp.locations ?? []).some((loc) => loc.regionName === regionFilter)) return false
      }
      if (!text) return true
      const num = String(sp.id)
      const name = (sp.displayName ?? '').toLocaleLowerCase('pt')
      return num.includes(text) || name.includes(text) || text === `#${num}`
    })
  })

  onMount(() => {
    void reload()
  })

  async function reload() {
    pending = true
    message = ''
    try {
      const [dexRes, blockRes] = await Promise.all([api('/api/pokedex'), api('/api/pokedex/blocks')])
      if (!dexRes.ok) {
        message = errorText((await dexRes.json().catch(() => ({ error: 'internal' }))) as ApiError)
        return
      }
      if (!blockRes.ok) {
        message = errorText((await blockRes.json().catch(() => ({ error: 'internal' }))) as ApiError)
        return
      }
      dex = (await dexRes.json()) as DexPayload
      blocks = ((await blockRes.json()) as { blocks: AlbumBlock[] }).blocks
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  async function claim(block: AlbumBlock) {
    if (pending || !block.complete || block.claimed) return
    pending = true
    message = ''
    try {
      const response = await api(`/api/pokedex/blocks/${encodeURIComponent(block.key)}/claim`, {})
      if (!response.ok) {
        message = errorText((await response.json().catch(() => ({ error: 'internal' }))) as ApiError)
        return
      }
      const body = (await response.json()) as {
        title: string
        reward: AlbumBlock['reward']
      }
      cards = albumClaimCards({ title: body.title, reward: body.reward, berries: game.berries })
      await onState()
      await reload()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  function rarityLabel(rarity: string): string {
    if (rarity === 'rare') return 'Raro'
    if (rarity === 'uncommon') return 'Incomum'
    return 'Comum'
  }

  function observeCell(node: HTMLElement, id: number) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          visibleIds = new Set(visibleIds).add(id)
          io.disconnect()
        }
      },
      { rootMargin: '80px' },
    )
    io.observe(node)
    return {
      destroy() {
        io.disconnect()
      },
    }
  }

  function lookFor(id: number) {
    return gardenSprite(id, false)
  }

  /** Altura da área do sprite na ficha: do topo do quadro do Idle ao chão, na escala 2. */
  function artHeight(id: number): string {
    const sheet = pmdAnim(id, false, 'Idle')
    if (!sheet) return '6rem'
    return `${groundAt(sheet, 0, 0).y * 2 + 4}px`
  }

  function rewardLine(reward: AlbumBlock['reward'], berries: BerryInfo[]): string {
    const parts: string[] = []
    for (const item of reward.items) parts.push(`${itemLabel(item.itemKey, berries)} ×${item.quantity}`)
    if (reward.genericCandies > 0) parts.push(`${reward.genericCandies} doces genéricos`)
    if (reward.energy > 0) parts.push(`${reward.energy} energia`)
    return parts.join(' · ')
  }

  function evoLabel(row: EvoMember): string {
    return row.displayName ?? '???'
  }
</script>

{#if cards.length > 0}
  <Highlights {cards} onDone={() => (cards = [])} />
{/if}

{#if open}
  <div class="overlay" role="presentation">
    <button type="button" class="backdrop" aria-label="Fechar" onclick={() => (openId = null)}></button>
    <div class="panel sheet" role="dialog" aria-modal="true" aria-label="Ficha da Pokédex">
      <header class="sheet-head">
        <h2>Nº {String(open.id).padStart(3, '0')}</h2>
        <button type="button" class="btn sheet-close" onclick={() => (openId = null)}>Fechar</button>
      </header>
      <div class="sheet-body">
        <!-- A altura segue o sprite (do topo do quadro ao chão, na escala 2):
             com altura fixa, os maiores perdiam a cabeça. -->
        <div
          class="sheet-art"
          class:dim={open.layer === 'seen'}
          class:silhouette={open.layer === 'unknown'}
          style:height={artHeight(open.id)}
        >
          {#if lookFor(open.id).kind === 'pmd'}
            <div class="art-stage">
              <div class="art-anchor">
                <PmdSprite
                  speciesId={open.id}
                  shiny={false}
                  anim="Idle"
                  dir={0}
                  scale={2}
                  time={0}
                  shadow={0}
                />
              </div>
            </div>
          {:else}
            <img
              class="art-gif"
              src={showdownSrc(open.id, false)}
              alt=""
              width="96"
              height="96"
            />
          {/if}
        </div>

        {#if open.layer === 'unknown'}
          <h3>???</h3>
          <p class="hint">Ainda não encontrado.</p>
        {:else}
          <h3>{open.displayName}</h3>
          {#if open.type1}
            <p class="types">
              <span class="type" style:--type={TYPE_GLOW[open.type1] ?? '#888'}>{typeLabelPt(open.type1)}</span>
              {#if open.type2}
                <span class="type" style:--type={TYPE_GLOW[open.type2] ?? '#888'}>{typeLabelPt(open.type2)}</span>
              {/if}
            </p>
          {/if}

          {#if open.abilities}
            <h4>Habilidades</h4>
            <ul class="plain">
              <li>{open.abilities.slot1}</li>
              {#if open.abilities.slot2}<li>{open.abilities.slot2}</li>{/if}
              {#if open.abilities.hidden}<li>Oculta: {open.abilities.hidden}</li>{/if}
            </ul>
          {/if}

          {#if open.evolution && open.evolution.length > 0}
            <h4>Linha evolutiva</h4>
            <div class="evo-line">
              {#each open.evolution as member (member.id)}
                {@const known = Boolean(member.displayName)}
                <button
                  type="button"
                  class="evo"
                  class:dim={!known || (byId.get(member.id)?.layer === 'seen')}
                  class:silhouette={!known}
                  onclick={() => (openId = member.id)}
                >
                  <div class="evo-stage">
                    <div class="evo-anchor">
                      {#if lookFor(member.id).kind === 'pmd'}
                        <PmdSprite
                          speciesId={member.id}
                          shiny={false}
                          anim="Idle"
                          dir={0}
                          scale={1}
                          time={0}
                          shadow={0}
                        />
                      {:else}
                        <img src={showdownSrc(member.id, false)} alt="" width="40" height="40" />
                      {/if}
                    </div>
                  </div>
                  <small>{evoLabel(member)}</small>
                </button>
              {/each}
            </div>
          {/if}

          {#if open.locations}
            <h4>Onde encontrar</h4>
            <ul>
              {#each open.locations as loc (loc.regionSlug)}
                <li>{loc.regionName} · Nv {loc.minLevel}–{loc.maxLevel} · {rarityLabel(loc.rarity)}</li>
              {/each}
            </ul>
          {:else if open.nextUnlock?.unlocks === 'locations'}
            <p class="hint lock">
              Chegue ao Nv {open.nextUnlock.needLevel} com esta espécie para ver onde encontrar.
            </p>
          {/if}

          {#if open.baseStats}
            <div class="base-stats">
              <h4>Atributos base</h4>
              <StatTable stats={open.baseStats} />
            </div>
          {/if}
          {#if open.moves}
            <h4>Golpes</h4>
            <ul>
              {#each open.moves as move (`${move.name}-${move.level}`)}
                <li>
                  Nv {move.level} · {move.displayName}
                  <small>({move.kind === 'fast' ? 'Rápido' : 'Carregado'} · {typeLabelPt(move.type)} · {move.power})</small>
                </li>
              {/each}
            </ul>
          {:else if open.nextUnlock?.unlocks === 'moves'}
            <p class="hint lock">
              Chegue ao Nv {open.nextUnlock.needLevel} com esta espécie para ver golpes e atributos base.
            </p>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<div class="pokedex">
  <div class="chrome">
    <span class="lens" aria-hidden="true"></span>
    <span class="lights" aria-hidden="true"><i class="r"></i><i class="y"></i><i class="g"></i></span>
    <h1 class="title">Pokédex</h1>
    <button type="button" class="btn close" aria-label="Fechar" onclick={onClose}>✕</button>
  </div>
  <div class="screen">
    <div class="tabs" role="group" aria-label="Pokédex">
      <button type="button" class="btn tab" class:btn-primary={tab === 'list'} aria-pressed={tab === 'list'} onclick={() => (tab = 'list')}>Lista</button>
      <button type="button" class="btn tab" class:btn-primary={tab === 'album'} aria-pressed={tab === 'album'} onclick={() => (tab = 'album')}>Álbum</button>
      <button type="button" class="btn tab" class:btn-primary={tab === 'guide'} aria-pressed={tab === 'guide'} onclick={() => (tab = 'guide')}>Guia</button>
    </div>

    {#if message}<p class="alert" role="alert">{message}</p>{/if}

    {#if tab === 'list'}
      {#if dex}
        <div class="controls">
          <p class="counts">Vistos {dex.seen} · Capturados {dex.caught} de {dex.total}</p>
          <div class="search-row">
            <input class="field search" bind:value={query} placeholder="Nome ou nº" aria-label="Buscar na Pokédex" autocomplete="off" />
            <!-- Menu próprio no lugar do <select>: a lista aberta do select usa o
                 visual do sistema, fora do estilo do jogo. -->
            <div class="region">
              <button
                type="button"
                class="field region-btn"
                aria-haspopup="listbox"
                aria-expanded={regionOpen}
                aria-label={`Região: ${regionFilter || 'todas'}`}
                onclick={() => (regionOpen = !regionOpen)}
              >
                <span class="region-name">{regionFilter || 'Região'}</span>
                <svg class="caret" viewBox="0 0 5 3" width="10" height="6" aria-hidden="true">
                  <rect x="0" y="0" width="5" height="1" /><rect x="1" y="1" width="3" height="1" /><rect x="2" y="2" width="1" height="1" />
                </svg>
              </button>
              {#if regionOpen}
                <button type="button" class="region-dismiss" aria-label="Fechar lista de regiões" onclick={() => (regionOpen = false)}></button>
                <ul class="region-list" role="listbox" aria-label="Região">
                  {#each ['', ...regions] as name (name)}
                    <li>
                      <button
                        type="button"
                        role="option"
                        aria-selected={regionFilter === name}
                        class:on={regionFilter === name}
                        onclick={() => {
                          regionFilter = name
                          regionOpen = false
                        }}
                      >
                        {name || 'Todas as regiões'}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>
          <div class="chips" role="group" aria-label="Filtros">
            {#each [
              { id: 'all' as Filter, label: 'Todos' },
              { id: 'seen' as Filter, label: 'Vistos' },
              { id: 'caught' as Filter, label: 'Capt.' },
              { id: 'missing' as Filter, label: 'Falta' },
            ] as item (item.id)}
              <button
                type="button"
                class="btn chip"
                class:btn-primary={filter === item.id}
                aria-pressed={filter === item.id}
                onclick={() => (filter = item.id)}
              >
                {item.label}
              </button>
            {/each}
          </div>
        </div>
        <div class="grid-scroll">
          <div class="grid">
            {#each visible as sp (sp.id)}
              <button type="button" class="cell" use:observeCell={sp.id} onclick={() => (openId = sp.id)}>
                <small>#{String(sp.id).padStart(3, '0')}</small>
                <div class="thumb-stage" class:dim={sp.layer === 'seen'} class:silhouette={sp.layer === 'unknown'}>
                  {#if visibleIds.has(sp.id)}
                    {#if lookFor(sp.id).kind === 'pmd'}
                      <div class="thumb-anchor">
                        <PmdSprite
                          speciesId={sp.id}
                          shiny={false}
                          anim="Idle"
                          dir={0}
                          scale={1}
                          time={0}
                          shadow={0}
                        />
                      </div>
                    {:else}
                      <img class="thumb-gif" src={showdownSrc(sp.id, false)} alt="" loading="lazy" width="48" height="48" />
                    {/if}
                  {:else}
                    <span class="thumb-wait"></span>
                  {/if}
                </div>
                <span class="name">{sp.layer === 'unknown' ? '???' : sp.displayName}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else if pending}
        <p class="hint">Carregando…</p>
      {/if}
    {:else if tab === 'album'}
      <div class="album-scroll">
        {#snippet albumGroup(title: string, list: AlbumBlock[])}
          {#if list.length > 0}
            <h3 class="group-title">{title}</h3>
            <div class="album">
              {#each list as block (block.key)}
                <article class="block">
                  <header>
                    <strong>{block.title}</strong>
                    <small>{block.caught}/{block.total}</small>
                  </header>
                  <span class="bar" aria-hidden="true"
                    ><span style:transform="scaleX({block.total ? block.caught / block.total : 0})"></span></span
                  >
                  <p class="reward">{rewardLine(block.reward, game.berries)}</p>
                  {#if block.claimed}
                    <p class="hint claimed">Resgatado</p>
                  {:else if block.complete}
                    <button type="button" class="btn btn-primary claim" disabled={pending} onclick={() => void claim(block)}>
                      Resgatar
                    </button>
                  {/if}
                </article>
              {/each}
            </div>
          {/if}
        {/snippet}
        {@render albumGroup('Regiões', regionBlocks)}
        {@render albumGroup('Linhas evolutivas', chainBlocks)}
        {@render albumGroup('Kanto e Johto', gameBlocks)}
      </div>
    {:else}
      <div class="guide-scroll">
        <div class="guide">
          <h3>Energia</h3>
          <p>Cada encontro gasta 1 de energia. Ela volta com o tempo, até o máximo.</p>
          <h3>Encontros</h3>
          <p>Escolha uma região no mapa. O selvagem e o nível já ficam decididos no servidor.</p>
          <h3>Luta</h3>
          <p>Golpe rápido enche a energia do carregado. Auto joga sozinho; a captura continua sendo sua. Status (queimadura, veneno, paralisia…) só valem durante a luta.</p>
          <h3>Captura</h3>
          <p>Depois da vitória, lance a bola ou deixe ir. Errar pode fazer o Pokémon fugir.</p>
          <h3>Doces e evolução</h3>
          <p>Soltar duplicatas dá doces da linha. Alimentar sobe de nível; evoluir gasta doces no nível certo.</p>
          <h3>Daycare e berries</h3>
          <p>No daycare o Pokémon ganha XP com o tempo. No jardim, plante sementes e colha berries para bônus.</p>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .pokedex {
    --dex-lens: #7ec8e3;
    --dex-bar: var(--primary);
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0;
    min-height: 0;
    min-width: 0;
    height: 100%;
    padding: 0;
    padding-top: env(safe-area-inset-top);
    background: var(--paper);
    border-left: 2px solid var(--panel-edge);
    color: var(--ink);
  }

  .chrome {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 48px;
    padding: 0.35rem 0.45rem;
    flex: none;
    background: var(--panel-face);
    border-bottom: 2px solid var(--panel-edge);
    box-shadow: inset 0 -1px 0 var(--panel-shade);
  }

  .lens {
    flex: none;
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #eaf7ff, var(--dex-lens) 55%, #2a6a88);
    box-shadow: inset 0 0 0 1px #0e3a52;
  }

  .lights {
    display: flex;
    gap: 0.2rem;
    flex: none;
  }

  .lights i {
    display: block;
    width: 0.35rem;
    height: 0.35rem;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px #00000055;
  }

  .lights .r {
    background: #ff4d4d;
  }
  .lights .y {
    background: #ffd34d;
  }
  .lights .g {
    background: #5dcf6a;
  }

  .title {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink);
    line-height: 1.1;
  }

  .close {
    flex: none;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    box-shadow: none;
  }

  .screen {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.35rem;
    min-height: 0;
    /* Sem padding à direita: a barra de rolagem cola na borda do painel. */
    padding: 0.45rem 0 0.45rem 0.45rem;
    background: var(--panel-face);
    overflow: hidden;
  }

  .tabs,
  .controls,
  .alert {
    padding-right: 0.45rem;
  }

  .tabs {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.2rem;
    flex: none;
  }

  .tab {
    min-height: 44px;
    font-size: 0.85rem;
  }

  .controls {
    display: grid;
    gap: 0.25rem;
    flex: none;
  }

  .counts {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1.2;
  }

  .search-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem;
    min-width: 0;
  }

  .search {
    min-width: 0;
  }

  .region {
    position: relative;
    display: block;
    min-width: 0;
  }

  .region-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
    max-width: 8.5rem;
    padding-inline: 0.3rem;
    color: inherit;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  .region-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caret {
    flex: none;
    fill: currentColor;
    shape-rendering: crispEdges;
  }

  /* Toque fora fecha a lista (como o painel de volume do HUD). */
  .region-dismiss {
    position: fixed;
    z-index: 19;
    inset: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: default;
  }

  .region-list {
    position: absolute;
    z-index: 20;
    top: calc(100% + 0.2rem);
    right: 0;
    display: grid;
    width: max-content;
    min-width: 100%;
    max-width: 14rem;
    max-height: 16rem;
    margin: 0;
    padding: 0.25rem;
    overflow-y: auto;
    list-style: none;
    border: 2px solid var(--panel-edge);
    background: var(--panel-face);
    box-shadow:
      inset 0 0 0 1px var(--panel-shade),
      0 var(--px) 0 #0003;
  }

  .region-list button {
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

  .region-list button:hover,
  .region-list button:focus-visible {
    outline: none;
    background: #00000014;
  }

  .region-list button.on {
    background: var(--selected-face);
    box-shadow: inset 3px 0 0 var(--selected);
  }

  .chips {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.2rem;
  }

  .chip {
    min-height: 44px;
    padding-inline: 0.15rem;
    font-size: 0.72rem;
  }

  .grid-scroll,
  .album-scroll,
  .guide-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* Conteúdo inset; a barra fica na faixa à direita, fora das células. */
    padding-right: 10px;
    scrollbar-gutter: stable;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.25rem;
  }

  .cell {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 0.05rem;
    min-height: 0;
    margin: 0;
    padding: 0.25rem 0.1rem 0.3rem;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 1px 0 var(--inlay-shade);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .cell small {
    font-size: 0.62rem;
    line-height: 1;
  }

  .name {
    font-size: 0.65rem;
    font-weight: 700;
    text-align: center;
    line-height: 1.1;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thumb-stage {
    position: relative;
    width: 100%;
    height: 2.6rem;
  }

  .thumb-anchor {
    position: absolute;
    left: 50%;
    bottom: 0.15rem;
    width: 0;
    height: 0;
  }

  .thumb-gif {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 48px;
    height: 48px;
    transform: translateX(-50%);
    object-fit: contain;
    image-rendering: pixelated;
  }

  .thumb-wait {
    display: block;
    width: 100%;
    height: 100%;
    background: #00000012;
  }

  .dim {
    filter: grayscale(1) brightness(0.85) contrast(0.9);
    opacity: 0.85;
  }

  .silhouette {
    filter: brightness(0);
    opacity: 0.55;
  }

  .album {
    display: grid;
    gap: 0.35rem;
  }

  .group-title {
    margin: 0.45rem 0 0.2rem;
    font-size: 0.85rem;
  }

  .block {
    display: grid;
    gap: 0.2rem;
    padding: 0.4rem 0.45rem;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 1px 0 var(--inlay-shade);
  }

  .block header {
    display: flex;
    justify-content: space-between;
    gap: 0.35rem;
    font-size: 0.85rem;
  }

  .bar {
    display: block;
    height: 0.35rem;
    background: #00000022;
    overflow: hidden;
  }

  .bar > span {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--dex-bar);
    transform-origin: left center;
  }

  .reward {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.2;
  }

  .claim {
    min-height: 44px;
    font-size: 0.85rem;
  }

  .claimed {
    font-size: 0.75rem;
  }

  .guide h3 {
    margin: 0.5rem 0 0.1rem;
    font-size: 0.95rem;
  }

  .guide p {
    margin: 0;
    font-size: 0.85rem;
  }

  @media (max-width: 899px) {
    .pokedex {
      border-left: 0;
    }
  }

  /* Dentro da Pokédex (painel no PC; tela cheia no celular). */
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: end center;
    padding: 0.5rem;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: #18182099;
  }

  .sheet {
    position: relative;
    z-index: 1;
    width: min(100%, 28rem);
    max-height: min(92%, 36rem);
    overflow: auto;
    padding: 0.5rem 0.6rem 0.6rem;
  }

  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .sheet-close {
    min-height: 44px;
  }

  .sheet-head h2,
  .sheet-body h3,
  .sheet-body h4 {
    margin: 0;
  }

  .sheet-body {
    display: grid;
    gap: 0.35rem;
  }

  .sheet-body h4 {
    margin-top: 0.15rem;
    font-size: 0.9rem;
  }

  /* Sprite logo abaixo do nº / Fechar; corta o vazio do quadro PMD. */
  .sheet-art {
    width: 100%;
    height: 3rem;
    position: relative;
    margin: 0.1rem 0 0;
    overflow: visible;
  }

  .art-stage {
    position: absolute;
    inset: 0;
  }

  .art-anchor {
    position: absolute;
    left: 50%;
    bottom: 0.05rem;
    width: 0;
    height: 0;
  }

  .art-gif {
    display: block;
    margin: 0 auto;
    max-height: 100%;
    object-fit: contain;
    image-rendering: pixelated;
  }

  .types {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: 0;
  }

  .type {
    padding: 0.1rem 0.45rem;
    background: var(--type);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 800;
    text-shadow: 0 1px 0 #00000055;
  }

  .evo-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    justify-content: center;
  }

  .evo {
    display: grid;
    justify-items: center;
    gap: 0.1rem;
    margin: 0;
    padding: 0.2rem;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 1px 0 var(--inlay-shade);
    color: inherit;
    font: inherit;
    cursor: pointer;
    min-width: 3.5rem;
  }

  .evo-stage {
    position: relative;
    width: 2.6rem;
    height: 2.4rem;
  }

  .evo-anchor {
    position: absolute;
    left: 50%;
    bottom: 0.1rem;
    width: 0;
    height: 0;
  }

  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .plain li {
    margin: 0;
  }

  .hint {
    margin: 0;
    opacity: 0.85;
  }

  .hint.lock {
    font-weight: 700;
  }

  .alert {
    margin: 0;
    color: var(--danger);
    font-weight: 700;
    flex: none;
  }

  .base-stats {
    text-align: center;
  }

  .base-stats h4 {
    margin-bottom: 0;
  }

  ul {
    margin: 0;
    padding-left: 1.1rem;
  }
</style>
