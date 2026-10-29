<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import { api, errorText, type ApiError, type PlacesResponse, type PlaceView } from './api'
  import { connection } from './connection.svelte'
  import PlaceMap from './PlaceMap.svelte'
  import { play } from './sound'
  import { showdownSrc } from './sprites'

  /**
   * Exploração como jornada (JORNADA.md, seção 11): o lugar onde você está,
   * as espécies dele, o botão de procurar e os caminhos para os vizinhos. O
   * mapa abre num botão. Volta sempre ao último lugar visitado.
   */
  let {
    busy,
    searching,
    hasEncounter,
    onSearch,
    onGarden,
    extras,
  }: {
    /** Outra ação em andamento na exploração (procura, luta). */
    busy: boolean
    /** Slug da área sendo procurada agora (spinner no botão). */
    searching: string | null
    hasEncounter: boolean
    onSearch: (regionSlug: string) => void
    onGarden: () => void
    /** O que a exploração põe embaixo do lugar (efeitos, treino, testes). */
    extras?: Snippet
  } = $props()

  let data = $state<PlacesResponse | null>(null)
  let failed = $state(false)
  let traveling = $state(false)
  let message = $state('')
  let arrival = $state('')
  let mapOpen = $state(false)
  let arrivalTimer = 0

  const here = $derived(data ? (data.places.find((place) => place.slug === data!.current) ?? null) : null)
  const bySlug = $derived(new Map((data?.places ?? []).map((place) => [place.slug, place])))
  const caughtHere = $derived(data?.here.species.filter((entry) => entry.status === 'caught').length ?? 0)
  const chapterPct = $derived(data && data.chapter.total > 0 ? Math.round((data.chapter.caught / data.chapter.total) * 100) : 0)
  const pending = $derived(busy || traveling)

  async function load() {
    try {
      const response = await api('/api/places')
      if (!response.ok) {
        failed = true
        return
      }
      data = (await response.json()) as PlacesResponse
      failed = false
    } catch {
      failed = true
    }
  }

  onMount(() => {
    void load()
    return () => window.clearTimeout(arrivalTimer)
  })

  // Sem rede na primeira tentativa: tenta de novo quando a conexão volta.
  $effect(() => {
    if (failed && !connection.offline) void load()
  })

  function kindLabel(place: PlaceView): string {
    return place.kind === 'town' ? 'cidade' : place.kind === 'water' ? 'água' : ''
  }

  async function travel(slug: string) {
    if (pending) return
    const target = bySlug.get(slug)
    play('tap')
    traveling = true
    message = ''
    try {
      const response = await api('/api/places/travel', { to: slug })
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & { firstVisit?: boolean }
      if (!response.ok) {
        message = errorText(payload)
        return
      }
      mapOpen = false
      await load()
      if (payload.firstVisit && target) {
        arrival =
          target.kind === 'area' && target.speciesTotal > 0
            ? `${target.name} · ${target.speciesTotal} espécie${target.speciesTotal === 1 ? '' : 's'} aqui · novo!`
            : `${target.name} · primeira visita`
        window.clearTimeout(arrivalTimer)
        arrivalTimer = window.setTimeout(() => (arrival = ''), 3500)
      } else {
        arrival = ''
      }
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      traveling = false
    }
  }
</script>

<div class="scroll">
  {#if data && here}
    <!-- Objetivo do momento: até os marcos (parte 3), o capítulo aberto. -->
    <section class="panel sheet goal" aria-label="Objetivo">
      <p class="goal-title">Capítulo {data.chapter.number} · {data.chapter.title}</p>
      <div class="bar" aria-hidden="true"><span style:width="{chapterPct}%"></span></div>
      <p class="goal-meta">
        Espécies do capítulo {data.chapter.caught}/{data.chapter.total}
        {#if data.chapter.nextLevel !== null}
          · próximo capítulo no Nv {data.chapter.nextLevel}
        {/if}
      </p>
    </section>

    <section class="panel sheet place">
      {#if arrival}<p class="arrival" role="status">{arrival}</p>{/if}
      <div class="place-head">
        <h2>{here.name}</h2>
        {#if here.wildLevelRange}<small>Nv {here.wildLevelRange[0]}–{here.wildLevelRange[1]}</small>{/if}
      </div>
      <p class="blurb">{here.blurb}</p>

      {#if here.kind === 'area'}
        <p class="species-head">Espécies daqui <strong>{caughtHere}/{data.here.species.length}</strong></p>
        <ul class="species" aria-label="Espécies daqui">
          {#each data.here.species as entry, index (entry.speciesId ?? `unknown-${index}`)}
            <li class={entry.status} title={entry.displayName ?? 'Ainda não vista'}>
              {#if entry.speciesId !== null}
                <img src={showdownSrc(entry.speciesId, false)} alt={entry.displayName ?? ''} loading="lazy" />
                {#if entry.status === 'caught'}<span class="tick" aria-label="capturada">✓</span>{/if}
              {:else}
                <span class="unknown" aria-label="Ainda não vista">?</span>
              {/if}
            </li>
          {/each}
        </ul>
        <button
          type="button"
          class="btn btn-primary search"
          aria-busy={searching === here.slug}
          disabled={pending || hasEncounter}
          onclick={() => onSearch(here.slug)}
        >
          {searching === here.slug ? 'Procurando…' : 'Procurar no mato'}
        </button>
      {:else if here.kind === 'water'}
        <p class="hint">Aqui só dá para pescar ou surfar. Em breve.</p>
      {:else}
        <p class="hint">Cidade: nada para procurar aqui por enquanto.</p>
      {/if}
      {#if message}<p class="alert" role="alert">{message}</p>{/if}
    </section>

    <section class="panel sheet ways" aria-label="Caminhos">
      <h3>Caminhos</h3>
      {#each here.links as link (link.to)}
        {@const target = bySlug.get(link.to)}
        {#if target}
          <button
            type="button"
            class="btn way"
            disabled={pending || !link.open || hasEncounter}
            aria-busy={traveling}
            onclick={() => void travel(link.to)}
          >
            <span class="way-name">
              → {target.name}
              {#if kindLabel(target)}<small class="kind">{kindLabel(target)}</small>{/if}
            </span>
            {#if !link.open}
              <small class="why">{link.reason}</small>
            {:else if link.isNew}
              <small class="new">novo</small>
            {:else if target.speciesTotal > 0}
              <small>{target.speciesCaught}/{target.speciesTotal}</small>
            {/if}
          </button>
        {/if}
      {/each}
      {#if hasEncounter}<p class="hint">Termine o encontro antes de sair daqui.</p>{/if}
    </section>

    {@render extras?.()}
  {:else}
    <section class="panel sheet">
      <p class="hint">{failed ? 'Sem conexão: o mapa abre quando voltar.' : 'Olhando o mapa…'}</p>
    </section>
  {/if}
</div>

<div class="dock">
  <div class="pair">
    <button type="button" class="btn" disabled={!data} onclick={() => (mapOpen = true)}>Mapa</button>
    <button type="button" class="btn" onclick={onGarden}>Jardim</button>
  </div>
</div>

{#if mapOpen && data}
  <PlaceMap
    places={data.places}
    current={data.current}
    pending={pending || hasEncounter}
    onTravel={(slug) => void travel(slug)}
    onClose={() => (mapOpen = false)}
  />
{/if}

<style>
  /* Mesmo layout da exploração (o CSS da Explore é escopado). */
  .scroll {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
    overflow: auto;
    padding-right: 10px;
    scrollbar-gutter: stable;
  }

  .goal {
    display: grid;
    gap: 0.3rem;
  }

  .goal p {
    margin: 0;
  }

  .goal-title {
    font-weight: 700;
  }

  .goal-meta {
    font-size: 0.85rem;
    color: var(--ink-soft);
  }

  .bar {
    height: 10px;
    background: #00000022;
    box-shadow: inset 0 0 0 var(--px) #00000033;
  }

  .bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
    box-shadow: inset 0 calc(var(--px) * -2) 0 var(--accent-shade);
  }

  .place {
    display: grid;
    gap: 0.45rem;
  }

  .place-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .place-head h2 {
    margin: 0;
    font-size: 1.3rem;
  }

  .blurb,
  .species-head {
    margin: 0;
  }

  .blurb {
    color: var(--ink-soft);
  }

  .arrival {
    margin: 0;
    padding: 0.35rem 0.5rem;
    background: var(--selected-face);
    border: 2px solid var(--selected);
    font-weight: 700;
    font-size: 0.9rem;
  }

  .species {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .species li {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 2px 0 var(--inlay-shade);
    overflow: hidden;
  }

  .species img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    image-rendering: pixelated;
  }

  /* Vista mas não capturada: a forma aparece, apagada. */
  .species li.seen img {
    filter: grayscale(1) opacity(0.45);
  }

  .tick {
    position: absolute;
    right: 2px;
    bottom: 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--primary);
  }

  .unknown {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .search {
    width: 100%;
  }

  .ways {
    display: grid;
    gap: 0.35rem;
  }

  .ways h3 {
    margin: 0;
    font-size: 1rem;
  }

  .way {
    justify-content: space-between;
    width: 100%;
    text-align: left;
  }

  .way-name {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
  }

  .kind,
  .why {
    color: var(--ink-soft);
    font-size: 0.8rem;
  }

  .new {
    padding: 1px 5px;
    background: var(--primary);
    color: #fff;
    font-size: 0.75rem;
  }

  .hint {
    margin: 0;
    color: var(--ink-soft);
  }

  .alert {
    margin: 0;
  }

  .dock {
    display: grid;
    flex: none;
    gap: 0.35rem;
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }

  .dock .btn {
    width: 100%;
  }
</style>
