<script lang="ts">
  import { onMount, type Snippet, untrack } from 'svelte'
  import { api, errorText, type ApiError, type FieldResponse, type PlacesResponse, type PlaceView } from './api'
  import { connection } from './connection.svelte'
  import FieldView from './FieldView.svelte'
  import JourneyMap from './JourneyMap.svelte'
  import TypeIcon from './TypeIcon.svelte'
  import { typeColor, typeInk } from './typeStyle'
  import { typeLabelPt } from './typesPt'
  import { play } from './sound'
  import { showdownSrc } from './sprites'

  /**
   * Exploração como jornada (JORNADA.md, seção 11). Abre no mapa: tocar num
   * lugar mostra ele no painel de baixo, e num vizinho aberto dá para ir. Numa
   * rota, "Abrir o campo" mostra os Pokémon da área andando, e você escolhe
   * quem enfrentar; depois da luta, volta para o campo. Volta sempre ao último
   * lugar visitado.
   */
  let {
    busy,
    searching,
    hasEncounter,
    onEngage,
    onGarden,
    onOpenPc,
    extras,
    startOnField = false,
  }: {
    /** Outra ação em andamento na exploração (procura, luta). */
    busy: boolean
    /** Slug da área sendo procurada agora (texto no botão). */
    searching: string | null
    hasEncounter: boolean
    /** Enfrenta o Pokémon da vaga do campo. */
    onEngage: (regionSlug: string, slot: number) => void
    onGarden: () => void
    /** Abre o PC (nas cidades, como um Centro Pokémon). */
    onOpenPc: () => void
    /** Efeitos, treino de arremesso e testes: ficam no painel "Mais". */
    extras?: Snippet
    /** Voltando de uma luta do campo: abre no campo em vez do mapa. */
    startOnField?: boolean
  } = $props()

  let data = $state<PlacesResponse | null>(null)
  let failed = $state(false)
  let traveling = $state(false)
  let message = $state('')
  let arrival = $state('')
  let picked = $state<string | null>(null)
  let moreOpen = $state(false)
  let arrivalTimer = 0
  /** Caminhada em andamento: pontos feitos / total, e o pedido de parar. */
  let walk = $state<{ to: string; done: number; total: number } | null>(null)
  let stopWalk = false
  let unmounted = false
  /** Tempo de caminhada em cada ponto do caminho. */
  const WALK_STEP_MS = 900
  /** Numa rota: o mapa (ao abrir e ao chegar) ou o campo (pelo botão, ou de volta da luta). */
  let view = $state<'field' | 'map'>(untrack(() => startOnField) ? 'field' : 'map')
  let field = $state<FieldResponse | null>(null)
  let spawnSlot = $state<number | null>(null)

  const bySlug = $derived(new Map((data?.places ?? []).map((place) => [place.slug, place])))
  const here = $derived(data ? (bySlug.get(data.current) ?? null) : null)
  const selected = $derived<PlaceView | null>((picked ? bySlug.get(picked) : null) ?? here)
  const isHere = $derived(selected !== null && selected.slug === data?.current)
  const link = $derived(selected && here ? (here.links.find((entry) => entry.to === selected.slug) ?? null) : null)
  /** Caminho a pé até o lugar escolhido (pelos caminhos abertos); null = não dá. */
  const route = $derived(selected && data && !isHere ? routeTo(selected.slug) : null)
  const caughtHere = $derived(data?.here.species.filter((entry) => entry.status === 'caught').length ?? 0)
  const goal = $derived(data?.goal ?? null)
  const mark = $derived(goal?.milestone ?? null)
  // Por enquanto o marco pede só o nível (as missões entram depois).
  const goalPct = $derived(
    mark ? Math.min(100, Math.round((mark.level / mark.needLevel) * 100)) : goal && goal.total > 0 ? Math.round((goal.caught / goal.total) * 100) : 100,
  )
  let claiming = $state(false)
  let celebrate = $state('')
  const pending = $derived(busy || traveling)
  const hasField = $derived(here !== null && here.kind === 'area' && here.open)
  const showField = $derived(hasField && view === 'field')
  const spawn = $derived(field?.spawns.find((entry) => entry.slot === spawnSlot) ?? null)

  async function loadField() {
    if (!hasField) {
      field = null
      return
    }
    try {
      const response = await api('/api/field')
      if (!response.ok) {
        field = null
        return
      }
      field = (await response.json()) as FieldResponse
      if (spawnSlot !== null && !field.spawns.some((entry) => entry.slot === spawnSlot)) spawnSlot = null
    } catch {
      field = null
    }
  }

  let exploring = $state(false)

  /** Campo vazio: sorteia Pokémon novos para ele. */
  async function exploreAgain() {
    if (!field?.canExplore || pending || exploring) return
    play('tap')
    exploring = true
    message = ''
    try {
      const response = await api('/api/field/explore', {})
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError | FieldResponse
      if (!response.ok) {
        message = errorText(payload as ApiError)
        await loadField()
        return
      }
      field = payload as FieldResponse
      spawnSlot = null
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      exploring = false
    }
  }

  function engage() {
    if (!spawn || !field || pending || hasEncounter) return
    onEngage(field.regionSlug, spawn.slot)
  }

  async function load() {
    try {
      const response = await api('/api/places')
      if (!response.ok) {
        failed = true
        return
      }
      data = (await response.json()) as PlacesResponse
      failed = false
      await loadField()
    } catch {
      failed = true
    }
  }

  onMount(() => {
    void load()
    return () => {
      unmounted = true
      stopWalk = true
      window.clearTimeout(arrivalTimer)
    }
  })

  /**
   * Menor caminho a pé (busca em largura), só por ligações abertas: as mesmas
   * que o servidor aceita em cada passo. Devolve os pontos depois de você.
   */
  function routeTo(slug: string): string[] | null {
    if (!data || slug === data.current) return null
    const from = new Map<string, string>([[data.current, '']])
    const queue = [data.current]
    while (queue.length > 0) {
      const at = queue.shift()!
      if (at === slug) break
      for (const next of bySlug.get(at)?.links ?? []) {
        if (!next.open || from.has(next.to) || !bySlug.has(next.to)) continue
        from.set(next.to, at)
        queue.push(next.to)
      }
    }
    if (!from.has(slug)) return null
    const path: string[] = []
    for (let at = slug; at !== data.current; at = from.get(at)!) path.unshift(at)
    return path
  }

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  /**
   * Anda sozinho até o lugar, ponto a ponto: cada passo é uma viagem ao
   * vizinho (o servidor confere cada uma) e leva um tempinho no mapa.
   * "Parar" termina no ponto em que estiver.
   */
  async function walkTo(slug: string) {
    if (pending || !data) return
    const path = routeTo(slug)
    if (!path || path.length === 0) return
    play('tap')
    traveling = true
    stopWalk = false
    message = ''
    arrival = ''
    picked = slug
    spawnSlot = null
    view = 'map'
    walk = { to: slug, done: 0, total: path.length }
    let firstVisit = false
    try {
      for (const [index, step] of path.entries()) {
        if (stopWalk) break
        const response = await api('/api/places/travel', { to: step })
        const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & { firstVisit?: boolean }
        if (!response.ok) {
          message = errorText(payload)
          break
        }
        if (unmounted || !data) return
        data.current = step
        walk = { to: slug, done: index + 1, total: path.length }
        firstVisit = step === slug && payload.firstVisit === true
        await sleep(WALK_STEP_MS)
      }
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      if (!unmounted) {
        const target = bySlug.get(slug)
        const reached = data?.current === slug
        walk = null
        traveling = false
        picked = reached ? null : picked
        await load()
        if (reached && firstVisit && target) showArrival(target)
      }
    }
  }

  function showArrival(target: PlaceView) {
    arrival =
      target.kind === 'area' && target.speciesTotal > 0
        ? `${target.name} · ${target.speciesTotal} espécie${target.speciesTotal === 1 ? '' : 's'} aqui · novo!`
        : `${target.name} · primeira visita`
    window.clearTimeout(arrivalTimer)
    arrivalTimer = window.setTimeout(() => (arrival = ''), 3500)
  }

  // Sem rede na primeira tentativa: tenta de novo quando a conexão volta.
  $effect(() => {
    if (failed && !connection.offline) void load()
  })

  function select(slug: string) {
    play('tap')
    message = ''
    picked = slug === data?.current ? null : slug
  }

  /** Toque duplo: onde dá para chegar a pé, vai andando; no resto, só seleciona. */
  function activate(slug: string) {
    if (!hasEncounter && !pending && routeTo(slug)) void walkTo(slug)
    else select(slug)
  }

  /** Resgata o marco na cidade dele: abre o próximo capítulo. */
  async function claim() {
    if (!mark || claiming) return
    claiming = true
    message = ''
    const name = mark.name
    try {
      const response = await api(`/api/places/milestones/${mark.key}/claim`, {})
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & {
        opens?: number
        grants?: string[]
      }
      if (!response.ok) {
        message = errorText(payload)
        return
      }
      play('catch')
      await load()
      const opened = data && data.goal.chapter === payload.opens ? data.goal.title : null
      const grants = payload.grants && payload.grants.length > 0 ? ` Ganhou: ${payload.grants.join(', ')}.` : ''
      celebrate = `${name} conquistado!${opened ? ` Capítulo ${payload.opens} aberto: ${opened}.` : ''}${grants}`
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      claiming = false
    }
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
      spawnSlot = null
      // Chegou: fica no mapa, olhando o lugar; o campo abre pelo botão.
      view = 'map'
      await load()
      if (payload.firstVisit && target) {
        showArrival(target)
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
    <!-- Objetivo do momento: o marco do capítulo (na cidade dele). -->
    <div class="goal panel" class:ready={mark?.ready} aria-label="Objetivo">
      {#if mark && goal}
        <p class="goal-title">
          <span class="goal-name">{mark.name} · {mark.typeLabel}</span>
          {#if mark.ready && mark.here}
            <button type="button" class="btn btn-primary challenge" disabled={claiming || pending} onclick={() => void claim()}>
              {claiming ? '…' : 'Desafiar'}
            </button>
          {:else if mark.ready}
            <button type="button" class="btn go" onclick={() => select(mark.town)}>Vá até {mark.townName}</button>
          {/if}
        </p>
        <div class="bar" aria-hidden="true"><span style:width="{goalPct}%"></span></div>
        <p class="goal-meta">
          <span class:done={mark.ready}>Nível de treinador {Math.min(mark.level, mark.needLevel)}/{mark.needLevel}</span>
        </p>
      {:else if goal}
        <p class="goal-title">
          <span class="goal-name">Cap. {goal.chapter} · {goal.title}</span>
          <span>{goal.caught}/{goal.total}</span>
        </p>
        <div class="bar" aria-hidden="true"><span style:width="{goalPct}%"></span></div>
      {/if}
    </div>

    {#if showField}
      <div class="field-head">
        <strong>{here.name}</strong>
        {#if here.wildLevelRange}<small>Nv {here.wildLevelRange[0]}–{here.wildLevelRange[1]}</small>{/if}
        <small class="field-count" title="Espécies daqui capturadas">{caughtHere}/{data.here.species.length} espécies</small>
      </div>
    {/if}
    <div class="map-wrap" class:hidden={showField}>
      <JourneyMap
        places={data.places}
        current={data.current}
        goalTown={mark?.town ?? null}
        selected={selected.slug}
        onSelect={select}
        onActivate={activate}
        walking={walk !== null}
        visible={!showField}
      />
      {#if arrival && !showField}<p class="arrival" role="status">{arrival}</p>{/if}
      {#if celebrate}
        <button type="button" class="celebrate" onclick={() => (celebrate = '')}>
          <strong>{celebrate}</strong>
          <small>Toque para fechar</small>
        </button>
      {/if}
    </div>

    {#if showField}
      <div class="map-wrap">
        {#if field}
          <FieldView spawns={field.spawns} selected={spawnSlot} onSelect={(slot) => (spawnSlot = slot)} />
        {:else}
          <p class="hint field-wait">Olhando o mato…</p>
        {/if}
        {#if arrival}<p class="arrival" role="status">{arrival}</p>{/if}
      </div>
      <!-- Altura fixa: sem seleção, a mesma estrutura fica invisível por baixo
           da dica, para o campo não mudar de tamanho ao tocar num Pokémon. -->
      <section class="panel sheet place field-panel" aria-live="polite">
        {#if spawn}
          <div class="place-head">
            <h2>
              {spawn.displayName}
              {#if spawn.isShiny}<small class="shiny">shiny ✦</small>{/if}
            </h2>
            <small>Nv {spawn.level}</small>
          </div>
          <div class="types">
            {#each [spawn.type1, spawn.type2].filter((type): type is string => Boolean(type)) as type (type)}
              <span class="type" style:--type={typeColor(type)} style:--type-ink={typeInk(type)}><TypeIcon {type} size={12} />{typeLabelPt(type)}</span>
            {/each}
          </div>
          <button
            type="button"
            class="btn btn-primary"
            aria-busy={searching === field?.regionSlug}
            disabled={pending || hasEncounter}
            onclick={engage}
          >
            {searching === field?.regionSlug ? 'Indo…' : 'Batalhar'}
          </button>
        {:else}
          <div class="place-head ghost" aria-hidden="true"><h2>—</h2><small>Nv</small></div>
          <div class="types ghost" aria-hidden="true"><span class="type">—</span></div>
          {#if field?.canExplore}
            <p class="hint">O campo ficou vazio.</p>
            <button
              type="button"
              class="btn btn-primary"
              aria-busy={exploring}
              disabled={pending || exploring || hasEncounter}
              onclick={exploreAgain}
            >
              {exploring ? 'Procurando…' : 'Explorar de novo'}
            </button>
          {:else}
            <button type="button" class="btn btn-primary ghost" tabindex="-1" aria-hidden="true">Batalhar</button>
            <p class="hint pick-hint">Toque num Pokémon do campo para ver e batalhar.</p>
          {/if}
        {/if}
        {#if hasEncounter}<p class="hint">Você tem um encontro em andamento.</p>{/if}
        {#if message}<p class="alert" role="alert">{message}</p>{/if}
      </section>
    {:else}
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
          <button type="button" class="btn btn-primary" onclick={() => (view = 'field')}>Abrir o campo</button>
        {:else if selected.kind === 'water'}
          <p class="hint">Aqui só dá para pescar ou surfar. Em breve.</p>
        {:else}
          <button type="button" class="btn" onclick={onOpenPc}>Usar o PC</button>
        {/if}
      {:else}
        <p class="blurb">{selected.blurb}</p>
        {#if selected.speciesTotal > 0 && selected.visited}
          <p class="hint">{selected.speciesCaught}/{selected.speciesTotal} espécies capturadas</p>
        {/if}
        {#if walk}
          <p class="hint walking" role="status">Caminhando… {walk.done}/{walk.total}</p>
          <button type="button" class="btn" onclick={() => (stopWalk = true)}>Parar</button>
        {:else if link?.open || (route && !selected.flyable)}
          <button type="button" class="btn btn-primary" disabled={pending || hasEncounter} onclick={() => void walkTo(selected.slug)}>
            {link?.open ? `Ir para ${selected.name}` : `Caminhar até ${selected.name} · ${route?.length} pontos`}
          </button>
        {:else if link}
          <p class="hint locked">{link.reason}</p>
        {:else if selected.flyable}
          <button type="button" class="btn btn-primary" disabled={pending || hasEncounter} onclick={() => void travel(selected.slug)}>
            {traveling ? 'Voando…' : `Voar para ${selected.name}`}
          </button>
          {#if route}
            <button type="button" class="btn" disabled={pending || hasEncounter} onclick={() => void walkTo(selected.slug)}>
              Caminhar · {route.length} pontos
            </button>
          {/if}
        {:else if !selected.open}
          <p class="hint locked">{selected.reason}</p>
        {:else if data.flyReason && selected.kind === 'town' && selected.visited}
          <p class="hint locked">{data.flyReason}</p>
        {:else}
          <p class="hint">Não há caminho aberto até aqui.</p>
        {/if}
      {/if}
      {#if hasEncounter}<p class="hint">Você tem um encontro em andamento.</p>{/if}
      {#if message}<p class="alert" role="alert">{message}</p>{/if}
    </section>
    {/if}
  {:else}
    <section class="panel sheet">
      <p class="hint">{failed ? 'Sem conexão: o mapa abre quando voltar.' : 'Olhando o mapa…'}</p>
    </section>
  {/if}

  <div class="dock">
    <div class="pair" class:three={hasField}>
      {#if hasField}
        <button type="button" class="btn" onclick={() => (view = view === 'field' ? 'map' : 'field')}>
          {view === 'field' ? 'Mapa' : 'Campo'}
        </button>
      {/if}
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
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-weight: 700;
    font-size: 0.95rem;
  }

  .goal.ready {
    border-color: var(--selected);
    box-shadow: inset 0 0 0 2px var(--selected-ring);
  }

  .goal-title .btn {
    flex: none;
    min-height: 36px;
    padding: 0 0.7rem;
    font-size: 0.9rem;
  }

  .challenge {
    animation: pulse 0.8s steps(2, jump-none) infinite alternate;
  }

  @keyframes pulse {
    to {
      filter: brightness(1.15);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .challenge {
      animation: none;
    }
  }

  .goal-meta {
    font-size: 0.78rem;
    color: var(--ink-soft);
  }

  .goal-meta .done {
    color: var(--primary);
    font-weight: 700;
  }

  .celebrate {
    position: absolute;
    inset: 0.5rem;
    display: grid;
    place-content: center;
    gap: 0.4rem;
    padding: 0.8rem;
    border: 3px solid var(--selected);
    background: var(--selected-face);
    color: var(--ink);
    font: inherit;
    text-align: center;
    cursor: pointer;
  }

  .celebrate strong {
    font-size: 1.05rem;
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

  .pair.three {
    grid-template-columns: 1fr 1fr 1fr;
  }

  .map-wrap.hidden {
    display: none;
  }

  .field-head {
    display: flex;
    flex: none;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0 0.15rem;
  }

  .field-head strong {
    font-size: 1.15rem;
  }

  .field-count {
    margin-left: auto;
    color: var(--ink-soft);
  }

  .field-panel {
    position: relative;
  }

  .ghost {
    visibility: hidden;
  }

  .pick-hint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 0 1rem;
    text-align: center;
  }

  .field-wait {
    margin: auto;
  }

  .shiny {
    color: var(--accent-shade);
    font-size: 0.8rem;
  }

  .types {
    display: flex;
    gap: 0.3rem;
  }

  .type {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 2px 6px;
    background: var(--type);
    color: var(--type-ink);
    font-size: 0.75rem;
    font-weight: 700;
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
