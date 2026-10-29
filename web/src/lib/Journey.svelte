<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import { api, errorText, type ApiError, type PlacesResponse, type PlaceView } from './api'
  import { connection } from './connection.svelte'
  import JourneyMap from './JourneyMap.svelte'
  import { play } from './sound'
  import { showdownSrc } from './sprites'

  /**
   * Exploração como jornada (JORNADA.md, seção 11): o mapa é a tela. Tocar
   * num lugar mostra ele no painel de baixo; onde você está, dá para procurar;
   * num vizinho aberto, dá para ir. Volta sempre ao último lugar visitado.
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
    /** Slug da área sendo procurada agora (texto no botão). */
    searching: string | null
    hasEncounter: boolean
    onSearch: (regionSlug: string) => void
    onGarden: () => void
    /** Efeitos, treino de arremesso e testes: ficam no painel "Mais". */
    extras?: Snippet
  } = $props()

  let data = $state<PlacesResponse | null>(null)
  let failed = $state(false)
  let traveling = $state(false)
  let message = $state('')
  let arrival = $state('')
  let picked = $state<string | null>(null)
  let moreOpen = $state(false)
  let arrivalTimer = 0

  const bySlug = $derived(new Map((data?.places ?? []).map((place) => [place.slug, place])))
  const here = $derived(data ? (bySlug.get(data.current) ?? null) : null)
  const selected = $derived<PlaceView | null>((picked ? bySlug.get(picked) : null) ?? here)
  const isHere = $derived(selected !== null && selected.slug === data?.current)
  const link = $derived(selected && here ? (here.links.find((entry) => entry.to === selected.slug) ?? null) : null)
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

  function select(slug: string) {
    play('tap')
    message = ''
    picked = slug === data?.current ? null : slug
  }

  function kindLabel(place: PlaceView): string {
    return place.kind === 'town' ? 'Cidade' : place.kind === 'water' ? 'Água' : ''
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
      picked = null
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

<div class="journey">
  {#if data && here && selected}
    <!-- Objetivo do momento: até os marcos (parte 3), o capítulo aberto. -->
    <div class="goal panel" aria-label="Objetivo">
      <p class="goal-title">
        <span class="goal-name">Cap. {data.chapter.number} · {data.chapter.title}</span>
        <span title="Espécies do capítulo capturadas">{data.chapter.caught}/{data.chapter.total}</span>
      </p>
      <div class="bar" aria-hidden="true"><span style:width="{chapterPct}%"></span></div>
    </div>

    <div class="map-wrap">
      <JourneyMap places={data.places} current={data.current} selected={selected.slug} onSelect={select} />
      {#if arrival}<p class="arrival" role="status">{arrival}</p>{/if}
    </div>

    <section class="panel sheet place" aria-live="polite">
      <div class="place-head">
        <h2>
          {selected.name}
          {#if kindLabel(selected)}<small class="kind">{kindLabel(selected)}</small>{/if}
        </h2>
        {#if selected.wildLevelRange}<small>Nv {selected.wildLevelRange[0]}–{selected.wildLevelRange[1]}</small>{/if}
      </div>

      {#if isHere}
        <p class="blurb">{selected.blurb}</p>
        {#if selected.kind === 'area'}
          <div class="species-row">
            <span class="count">{caughtHere}/{data.here.species.length}</span>
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
          </div>
          <button
            type="button"
            class="btn btn-primary"
            aria-busy={searching === selected.slug}
            disabled={pending || hasEncounter}
            onclick={() => onSearch(selected.slug)}
          >
            {searching === selected.slug ? 'Procurando…' : 'Procurar no mato'}
          </button>
        {:else if selected.kind === 'water'}
          <p class="hint">Aqui só dá para pescar ou surfar. Em breve.</p>
        {:else}
          <p class="hint">Nada para procurar na cidade por enquanto. Toque num lugar do mapa.</p>
        {/if}
      {:else}
        <p class="blurb">{selected.blurb}</p>
        {#if selected.speciesTotal > 0 && selected.visited}
          <p class="hint">{selected.speciesCaught}/{selected.speciesTotal} espécies capturadas</p>
        {/if}
        {#if link?.open}
          <button type="button" class="btn btn-primary" disabled={pending || hasEncounter} onclick={() => void travel(selected.slug)}>
            {traveling ? 'Indo…' : `Ir para ${selected.name}`}
          </button>
        {:else if link}
          <p class="hint locked">{link.reason}</p>
        {:else if !selected.open}
          <p class="hint locked">{selected.reason}</p>
        {:else}
          <p class="hint">Longe daqui: vá pelos lugares vizinhos (ligados ao seu).</p>
        {/if}
      {/if}
      {#if hasEncounter}<p class="hint">Você tem um encontro em andamento.</p>{/if}
      {#if message}<p class="alert" role="alert">{message}</p>{/if}
    </section>
  {:else}
    <section class="panel sheet">
      <p class="hint">{failed ? 'Sem conexão: o mapa abre quando voltar.' : 'Olhando o mapa…'}</p>
    </section>
  {/if}

  <div class="dock">
    <div class="pair">
      <button type="button" class="btn" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}>Mais</button>
      <button type="button" class="btn" onclick={onGarden}>Jardim</button>
    </div>
  </div>
</div>

{#if moreOpen}
  <div class="more" role="dialog" aria-modal="true" aria-label="Mais">
    <button type="button" class="more-dismiss" aria-label="Fechar" onclick={() => (moreOpen = false)}></button>
    <div class="more-panel">
      {@render extras?.()}
      <button type="button" class="btn" onclick={() => (moreOpen = false)}>Fechar</button>
    </div>
  </div>
{/if}

<style>
  .journey {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.45rem;
    min-height: 0;
  }

  .goal {
    display: grid;
    flex: none;
    gap: 0.2rem;
    padding: 0.35rem 0.55rem;
  }

  .goal p {
    margin: 0;
  }

  .goal-title {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-weight: 700;
    font-size: 0.95rem;
  }

  .goal-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    height: 8px;
    background: #00000022;
    box-shadow: inset 0 0 0 var(--px) #00000033;
  }

  .bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
    box-shadow: inset 0 calc(var(--px) * -2) 0 var(--accent-shade);
  }

  .map-wrap {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 96px;
  }

  .arrival {
    position: absolute;
    top: 0.5rem;
    left: 50%;
    max-width: calc(100% - 1rem);
    margin: 0;
    padding: 0.35rem 0.6rem;
    transform: translateX(-50%);
    background: var(--selected-face);
    border: 2px solid var(--selected);
    font-weight: 700;
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  .place {
    display: grid;
    flex: none;
    gap: 0.35rem;
  }

  .place-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .place-head h2 {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin: 0;
    font-size: 1.2rem;
  }

  .kind {
    color: var(--ink-soft);
    font-size: 0.8rem;
  }

  /* Uma linha só: o mapa precisa do espaço no celular. */
  .blurb {
    margin: 0;
    overflow: hidden;
    color: var(--ink-soft);
    font-size: 0.85rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .species-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .count {
    flex: none;
    font-weight: 700;
  }

  .species {
    display: flex;
    gap: 0.3rem;
    margin: 0;
    padding: 0 0 2px;
    overflow-x: auto;
    list-style: none;
    scrollbar-width: thin;
  }

  .species li {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 38px;
    height: 38px;
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
    font-size: 11px;
    font-weight: 700;
    color: var(--primary);
  }

  .unknown {
    font-weight: 700;
    color: var(--ink-soft);
  }

  .place .btn {
    width: 100%;
  }

  .hint {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }

  .locked {
    font-weight: 700;
  }

  .alert {
    margin: 0;
  }

  .dock {
    display: grid;
    flex: none;
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }

  .pair .btn {
    width: 100%;
  }

  .more {
    position: fixed;
    z-index: 45;
    inset: 0;
    display: grid;
    align-items: end;
    padding: 0.5rem calc(env(safe-area-inset-right) + 0.5rem) calc(env(safe-area-inset-bottom) + 0.5rem)
      calc(env(safe-area-inset-left) + 0.5rem);
  }

  .more-dismiss {
    position: absolute;
    inset: 0;
    border: 0;
    background: #00000055;
    cursor: default;
  }

  .more-panel {
    position: relative;
    display: grid;
    gap: 0.45rem;
    max-height: 80dvh;
    overflow: auto;
    justify-self: center;
    width: min(100%, 520px);
  }

  .more-panel .btn {
    width: 100%;
  }
</style>
