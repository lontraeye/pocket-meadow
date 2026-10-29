<script lang="ts">
  import { spriteLoading } from './spriteLoading'
  import {
    api,
    ballIconSrc,
    errorText,
    type ApiError,
    type GameState,
    type MoveView,
    type OwnedPokemon,
    type RegionInfo,
  } from './api'
  import Highlights from './Highlights.svelte'
  import {
    evolveHighlightCards,
    xpHighlightCards,
    type HighlightCard,
  } from './highlights'
  import { dosesToCap, previewFeed, releaseYield } from './progression'
  import { play } from './sound'
  import { showdownSrc } from './sprites'
  import StatTable from './StatTable.svelte'
  import { damageClassLabelPt, typeLabelPt } from './typesPt'

  let {
    game,
    mon,
    dev = null,
    onClose,
    onState,
  }: {
    game: GameState
    mon: OwnedPokemon
    dev?: { asleep: boolean; toggle: () => void } | null
    onClose: () => void
    onState: () => Promise<void>
  } = $props()

  let doses = $state(1)
  let useGeneric = $state(false)
  let nickname = $state('')
  let editingNick = $state(false)
  let nickInput = $state<HTMLInputElement | null>(null)
  let confirmRelease = $state(false)
  /** Espécie de destino esperando confirmação: evoluir sorteia os golpes de novo. */
  let confirmEvolve = $state<number | null>(null)
  let popping = $state(false)
  let message = $state('')
  let pending = $state(false)
  let seenSpecies = $state(0)
  let highlightCards = $state<HighlightCard[]>([])
  let regionsCache = $state<RegionInfo[] | null>(null)
  let swapping = $state<'fast' | 'charged' | null>(null)
  /** Troca livre de golpe: só com o servidor em DEV_TOOLS (a rota também exige). */
  const canSwapMoves = $derived(game.devTools)

  type SheetTab = 'perfil' | 'golpes' | 'treino'
  const sheetTabs: { key: SheetTab; label: string }[] = [
    { key: 'perfil', label: 'Perfil' },
    { key: 'golpes', label: 'Golpes' },
    { key: 'treino', label: 'Treino' },
  ]
  let tab = $state<SheetTab>('perfil')

  const rules = $derived(game.progression)
  const chainCandies = $derived(game.candies.find((row) => row.evolutionChainId === mon.evolutionChainId)?.amount ?? 0)
  const generic = $derived(game.trainer.genericCandies)
  const atCap = $derived(mon.level >= rules.levelCap || mon.xpToNext === null)
  const room = $derived(atCap ? 0 : Math.min(dosesToCap(mon.level, mon.xp, rules), rules.feedMax))
  const genericDoses = $derived(Math.floor(generic / rules.genericPerCandy))
  const affordable = $derived(useGeneric ? genericDoses : chainCandies)
  const maxDoses = $derived(Math.min(room, affordable))
  /** Tem doce de algum tipo (a troca linha↔genérico precisa ficar visível mesmo se o tipo atual zerou). */
  const anyCandy = $derived(chainCandies >= 1 || genericDoses >= 1)
  const preview = $derived(maxDoses > 0 ? previewFeed(mon.level, mon.xp, Math.min(doses, maxDoses), rules) : null)
  const yield_ = $derived(releaseYield(mon.level, mon.isShiny, rules))
  const lastOne = $derived(game.pokemon.length <= 1)
  const inDaycare = $derived(mon.location === 'daycare')
  const gardenCount = $derived(game.pokemon.filter((entry) => entry.location === 'garden').length)
  const daycareSlot = $derived(game.daycare.slots.find((slot) => slot.pokemonId === mon.id) ?? null)
  const freeSlot = $derived(
    [...Array(game.daycare.slotsUnlocked).keys()].find((index) => !game.daycare.slots.some((slot) => slot.slotIndex === index)) ??
      null,
  )
  const daycareReason = $derived(
    inDaycare
      ? ''
      : freeSlot === null
        ? game.daycare.nextSlotLevel
          ? `Abre no nível ${game.daycare.nextSlotLevel}`
          : 'Sem slot livre'
        : gardenCount <= 1
          ? 'Deixe alguém no jardim'
          : '',
  )
  const releaseReason = $derived(lastOne ? 'É o seu último Pokémon' : inDaycare ? 'Está no daycare' : '')

  $effect(() => {
    const current = mon.id
    nickname = mon.nickname ?? ''
    editingNick = false
    doses = 1
    useGeneric = false
    confirmRelease = false
    confirmEvolve = null
    swapping = null
    void current
  })

  $effect(() => {
    if (!editingNick || !nickInput) return
    nickInput.focus()
    nickInput.select()
  })

  $effect(() => {
    if (tab !== 'perfil' || regionsCache) return
    // Só o nome da região: sem rede, a ficha mostra a chave e segue.
    loadRegions().catch(() => undefined)
  })

  const natureHint = $derived(formatNature(mon.nature))
  const ivStars = $derived('★'.repeat(mon.ivRating.stars) + '☆'.repeat(5 - mon.ivRating.stars))
  const caughtBall = $derived(game.balls.list.find((ball) => ball.key === mon.caughtBall) ?? null)
  const caughtRegionName = $derived(
    regionsCache?.find((region) => region.slug === mon.caughtRegion)?.name ?? mon.caughtRegion,
  )

  $effect(() => {
    if (seenSpecies === 0) {
      seenSpecies = mon.speciesId
      return
    }
    if (mon.speciesId === seenSpecies) return
    seenSpecies = mon.speciesId
    popping = true
    const timer = window.setTimeout(() => (popping = false), 700)
    return () => window.clearTimeout(timer)
  })

  $effect(() => {
    if (doses > maxDoses) doses = Math.max(1, maxDoses)
  })

  async function send(path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<boolean> {
    pending = true
    message = ''
    try {
      const response = await api(path, body, method)
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

  async function loadRegions(): Promise<RegionInfo[]> {
    if (regionsCache) return regionsCache
    const response = await api('/api/regions')
    if (!response.ok) return []
    const body = (await response.json()) as { regions: RegionInfo[] }
    regionsCache = body.regions
    return body.regions
  }

  function crossedEvolve(beforeLevel: number, afterLevel: number, evolutions: OwnedPokemon['evolutions']): boolean {
    return evolutions.some((option) => beforeLevel < option.minLevel && afterLevel >= option.minLevel)
  }

  async function feed() {
    const asked = Math.min(doses, maxDoses)
    if (asked < 1) return
    const beforeLevel = mon.level
    const name = mon.nickname ?? mon.displayName
    const evolutions = mon.evolutions
    pending = true
    message = ''
    try {
      const response = await api(`/api/pokemon/${mon.id}/feed`, { candies: asked, useGeneric })
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & {
        doses?: number
        xpGained?: number
        levelsGained?: number
        level?: number
        learnedMove?: MoveView | null
      }
      if (!response.ok) {
        message = errorText(payload)
        return
      }
      await onState()
      const levels = Number(payload.levelsGained ?? 0)
      const level = Number(payload.level ?? beforeLevel)
      const xpGained = Number(payload.xpGained ?? 0)
      if (levels > 0) {
        highlightCards = xpHighlightCards({
          name,
          xpGained,
          levelsGained: levels,
          level,
          canEvolve: crossedEvolve(beforeLevel, level, evolutions),
          learnedMove: payload.learnedMove ?? null,
        })
      } else {
        message = 'Alimentado.'
      }
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  async function evolve(toSpeciesId: number) {
    const fromName = mon.nickname ?? mon.displayName
    const option = mon.evolutions.find((row) => row.toSpeciesId === toSpeciesId)
    pending = true
    message = ''
    try {
      const response = await api(`/api/pokemon/${mon.id}/evolve`, { toSpeciesId })
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & {
        displayName?: string
        trainerXpGained?: number
        trainer?: { level: number; levelsGained: number }
        levelRewards?: { itemKey: string; quantity: number }[]
        newMoves?: { fast: MoveView | null; charged: MoveView | null } | null
      }
      if (!response.ok) {
        message = errorText(payload)
        return
      }
      const regions = await loadRegions()
      await onState()
      highlightCards = evolveHighlightCards({
        fromName,
        toName: payload.displayName ?? option?.displayName ?? 'evolução',
        trainerXpGained: Number(payload.trainerXpGained ?? 0),
        trainer: {
          level: Number(payload.trainer?.level ?? game.trainer.level),
          levelsGained: Number(payload.trainer?.levelsGained ?? 0),
        },
        levelRewards: payload.levelRewards ?? [],
        regions,
        berries: game.berries,
        balls: game.balls.list,
        newMoves: payload.newMoves ?? null,
      })
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  async function release() {
    const ok = await send(`/api/pokemon/${mon.id}/release`, {})
    if (ok) {
      play('release')
      onClose()
    }
  }

  // Sempre confirma: o botão fica no dock, onde o polegar passa.
  function askRelease() {
    confirmRelease = true
  }

  function startNick() {
    nickname = mon.nickname ?? ''
    editingNick = true
  }

  function cancelNick() {
    nickname = mon.nickname ?? ''
    editingNick = false
  }

  async function saveNickname() {
    const ok = await send(`/api/pokemon/${mon.id}`, { nickname }, 'PATCH')
    if (ok) editingNick = false
  }

  async function toggleFavorite() {
    await send(`/api/pokemon/${mon.id}`, { isFavorite: !mon.isFavorite }, 'PATCH')
  }

  async function putInDaycare() {
    if (freeSlot === null) return
    const ok = await send(`/api/daycare/${freeSlot}`, { pokemonId: mon.id })
    if (ok) {
      message = 'No daycare.'
      onClose()
    }
  }

  async function takeFromDaycare() {
    if (daycareSlot === null) return
    const name = mon.nickname ?? mon.displayName
    const evolutions = mon.evolutions
    pending = true
    message = ''
    try {
      const response = await api(`/api/daycare/${daycareSlot.slotIndex}`, undefined, 'DELETE')
      const payload = (await response.json().catch(() => ({ error: 'internal' }))) as ApiError & {
        xpGained?: number
        levelsGained?: number
        level?: number
      }
      if (!response.ok) {
        message = errorText(payload)
        return
      }
      const levels = Number(payload.levelsGained ?? 0)
      const level = Number(payload.level ?? mon.level)
      const xpGained = Number(payload.xpGained ?? 0)
      const before = level - levels
      await onState()
      if (levels > 0) {
        highlightCards = xpHighlightCards({
          name,
          xpGained,
          levelsGained: levels,
          level,
          canEvolve: crossedEvolve(before, level, evolutions),
        })
      } else {
        message = `+${xpGained} XP`
      }
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  async function setMove(slot: 'fast' | 'charged', move: string) {
    const current = slot === 'fast' ? mon.fastMove.name : mon.chargedMove?.name
    if (move === current) {
      swapping = null
      return
    }
    const ok = await send(`/api/pokemon/${mon.id}/moves`, { slot, move })
    if (ok) {
      message = 'Golpe trocado.'
      swapping = null
    }
  }

  function formatNature(nature: OwnedPokemon['nature']): string {
    if (!nature.up || !nature.down) return 'Neutra'
    return `+${statLabel(nature.up)} / −${statLabel(nature.down)}`
  }

  function statLabel(key: string): string {
    switch (key) {
      case 'attack':
        return 'Atq'
      case 'defense':
        return 'Def'
      case 'spAttack':
        return 'AtqE'
      case 'spDefense':
        return 'DefE'
      case 'speed':
        return 'Vel'
      default:
        return key
    }
  }
</script>

<div class="overlay" role="presentation">
  <button type="button" class="backdrop" aria-label="Fechar" onclick={onClose}></button>
  <div class="panel sheet" role="dialog" aria-modal="true" aria-label="Detalhes">
    {#if highlightCards.length > 0}
      <Highlights cards={highlightCards} onDone={() => (highlightCards = [])} />
    {/if}
    <div class="head">
      <div class="title-row">
        {#if editingNick}
          <form
            class="name-edit"
            onsubmit={(event) => {
              event.preventDefault()
              void saveNickname()
            }}
          >
            <input
              class="field nick-input"
              bind:this={nickInput}
              bind:value={nickname}
              maxlength="12"
              autocomplete="off"
              aria-label="Apelido"
              placeholder={mon.displayName}
              disabled={pending}
            />
            <button type="submit" class="icon-btn" aria-label="Confirmar apelido" disabled={pending}>✓</button>
            <button type="button" class="icon-btn" aria-label="Cancelar" disabled={pending} onclick={cancelNick}>✕</button>
          </form>
        {:else}
          <h2>
            <span class="name-text">{mon.nickname ?? mon.displayName}</span>
            {#if mon.isShiny}<span class="shiny" title="Shiny">★</span>{/if}
            <button type="button" class="icon-btn" aria-label="Editar apelido" disabled={pending} onclick={startNick}>✎</button>
          </h2>
        {/if}
        <button
          type="button"
          class="icon-btn star"
          aria-label={mon.isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
          aria-pressed={mon.isFavorite}
          disabled={pending}
          onclick={() => void toggleFavorite()}
        >
          <!-- 24×24 nativo (Pixelarticons): escala só em múltiplo inteiro pra não amassar o pixel. -->
          <svg class="pixel-star" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" shape-rendering="crispEdges">
            {#if mon.isFavorite}
              <rect x="11" y="1" width="2" height="1" />
              <rect x="11" y="2" width="2" height="1" />
              <rect x="9" y="3" width="6" height="4" />
              <rect x="1" y="7" width="22" height="4" />
              <rect x="3" y="11" width="18" height="2" />
              <rect x="5" y="13" width="14" height="3" />
              <rect x="3" y="16" width="18" height="2" />
              <rect x="3" y="18" width="7" height="2" />
              <rect x="14" y="18" width="7" height="2" />
              <rect x="3" y="20" width="5" height="2" />
              <rect x="16" y="20" width="5" height="2" />
            {:else}
              <path
                d="M5 20H8V22H3V16H5V20ZM21 22H16V20H19V16H21V22ZM10 20H8V18H10V20ZM16 20H14V18H16V20ZM14 18H10V16H14V18ZM7 16H5V13H7V16ZM19 16H17V13H19V16ZM5 13H3V11H5V13ZM21 13H19V11H21V13ZM9 9H3V11H1V7H9V9ZM23 11H21V9H15V7H23V11ZM11 7H9V3H11V7ZM15 7H13V3H15V7ZM13 3H11V1H13V3Z"
              />
            {/if}
          </svg>
        </button>
        <button type="button" class="btn close" aria-label="Fechar" onclick={onClose}>✕</button>
      </div>
      <div class="body-row">
        <div class="portrait" class:popping>
          <img use:spriteLoading={showdownSrc(mon.speciesId, mon.isShiny)} src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" />
        </div>
        <div class="meta">
          <p class="lv">Nv {mon.level}</p>
          <div class="xp">
            {#if mon.xpToNext === null}
              <span>XP no máximo</span>
            {:else}
              <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={mon.xpToNext} aria-valuenow={mon.xp}>
                <span style:width="{Math.min(100, (mon.xp / mon.xpToNext) * 100)}%"></span>
              </div>
              <small>XP {mon.xp}/{mon.xpToNext}</small>
            {/if}
          </div>
          <div class="candies" aria-label="Doces">
            <span class="candy chain" title="Doces da linha evolutiva">
              <small>Lin</small>
              <strong>{chainCandies}</strong>
            </span>
            <span class="candy generic" title="Doces genéricos">
              <small>Gen</small>
              <strong>{generic}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>

    {#if message}<p class="alert" role="alert">{message}</p>{/if}

    <!-- Abas: a ficha inteira não cabia numa rolagem só no celular. -->
    <div class="tabs" role="tablist" aria-label="Seções da ficha">
      {#each sheetTabs as entry (entry.key)}
        <button
          type="button"
          role="tab"
          id="tab-{entry.key}"
          class="tab"
          aria-selected={tab === entry.key}
          aria-controls="panel-{entry.key}"
          onclick={() => (tab = entry.key)}
        >
          {entry.label}
        </button>
      {/each}
    </div>

  <div class="scroll" role="tabpanel" id="panel-{tab}" aria-labelledby="tab-{tab}">
    {#if tab === 'perfil'}
    <div class="block traits">
      <h3>Traços</h3>
      <p class="hint caught-with">
        {#if caughtBall}
          <img class="caught-ball" src={ballIconSrc(caughtBall.sprite)} alt="" width="20" height="20" />
          Capturado com {caughtBall.displayName}{#if caughtRegionName} · {caughtRegionName}{/if}
        {:else}
          Capturado com Poké Ball{#if caughtRegionName} · {caughtRegionName}{/if}
        {/if}
      </p>
      <p class="hint">IVs {ivStars} · {mon.ivRating.percent}%</p>
      <p class="hint">Natureza {mon.nature.displayName} ({natureHint})</p>
      <p class="hint">
        Habilidade {mon.ability.displayName}
        {#if !mon.ability.combat}
          <span class="muted"> · sem efeito em combate por enquanto</span>
        {/if}
      </p>
      <StatTable stats={mon.stats} />
    </div>

    {:else if tab === 'golpes'}
    <div class="block">
      <h3>Golpes</h3>
      <div class="move">
        <div>
          <p class="slot">Golpe rápido</p>
          <strong>{mon.fastMove.displayName}</strong>
          <p class="hint">
            {typeLabelPt(mon.fastMove.type)} · {mon.fastMove.power} · {damageClassLabelPt(mon.fastMove.damageClass)}
          </p>
          {#if mon.fastMove.effectText}
            <p class="hint effect">{mon.fastMove.effectText}</p>
          {/if}
        </div>
        {#if canSwapMoves}
          <button type="button" class="btn" disabled={pending} onclick={() => (swapping = swapping === 'fast' ? null : 'fast')}>
            Trocar
          </button>
        {/if}
      </div>
      {#if canSwapMoves && swapping === 'fast'}
        <div class="coins picks">
          {#each mon.availableMoves.fast as move (move.name)}
            <button
              type="button"
              class="btn"
              class:btn-primary={move.name === mon.fastMove.name}
              disabled={pending}
              onclick={() => void setMove('fast', move.name)}
            >
              {move.displayName}
            </button>
          {/each}
        </div>
      {/if}
      <div class="move">
        <div>
          <p class="slot">Golpe carregado</p>
          {#if mon.chargedMove}
            <strong>{mon.chargedMove.displayName}</strong>
            <p class="hint">
              {typeLabelPt(mon.chargedMove.type)} · {mon.chargedMove.power} · {damageClassLabelPt(mon.chargedMove.damageClass)}
            </p>
            {#if mon.chargedMove.effectText}
              <p class="hint effect">{mon.chargedMove.effectText}</p>
            {/if}
          {:else}
            <strong>Ainda não aprendeu um golpe carregado</strong>
            {#if mon.nextChargedMove}
              <p class="hint">Aprende {mon.nextChargedMove.displayName} no Nv {mon.nextChargedMove.level}</p>
            {/if}
          {/if}
        </div>
        {#if canSwapMoves}
          <button
            type="button"
            class="btn"
            disabled={pending || mon.availableMoves.charged.length === 0}
            onclick={() => (swapping = swapping === 'charged' ? null : 'charged')}
          >
            Trocar
          </button>
        {/if}
      </div>
      {#if canSwapMoves && swapping === 'charged'}
        <div class="coins picks">
          {#each mon.availableMoves.charged as move (move.name)}
            <button
              type="button"
              class="btn"
              class:btn-primary={move.name === mon.chargedMove?.name}
              disabled={pending}
              onclick={() => void setMove('charged', move.name)}
            >
              {move.displayName}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {:else}
    <div class="block">
      <h3>Alimentar</h3>
      {#if atCap}
        <p class="hint">Nível máximo.</p>
      {:else if !anyCandy}
        <p class="hint">Sem doces para isso.</p>
      {:else}
        <div class="coins">
          <button
            type="button"
            class="btn"
            class:btn-primary={!useGeneric}
            aria-pressed={!useGeneric}
            onclick={() => (useGeneric = false)}
          >
            Da linha
          </button>
          <button
            type="button"
            class="btn"
            class:btn-primary={useGeneric}
            aria-pressed={useGeneric}
            onclick={() => (useGeneric = true)}
          >
            Genérico
          </button>
        </div>
        {#if maxDoses < 1}
          <p class="hint">Sem doces desse tipo.</p>
        {:else}
          <div class="stepper">
            <button type="button" class="btn" disabled={pending || doses <= 1} onclick={() => (doses = Math.max(1, doses - 1))} aria-label="Menos uma dose">−</button>
            <span>{Math.min(doses, maxDoses)}</span>
            <button type="button" class="btn" disabled={pending || doses >= maxDoses} onclick={() => (doses = Math.min(maxDoses, doses + 1))} aria-label="Mais uma dose">+</button>
          </div>
          {#if preview}
            <p class="preview">+{Math.min(doses, maxDoses) * rules.candyXp} XP → Nv {preview.level}</p>
          {/if}
          <button type="button" class="btn btn-primary" disabled={pending} onclick={() => void feed()}>Alimentar</button>
        {/if}
      {/if}
    </div>

    {#if mon.evolutions.length > 0}
      <div class="block">
        <h3>Evoluir</h3>
        {#each mon.evolutions as option (option.toSpeciesId)}
          {#if mon.level >= option.minLevel && !inDaycare && confirmEvolve === option.toSpeciesId}
            <p class="hint">
              Ao evoluir, os golpes de {mon.nickname ?? mon.displayName} são sorteados de novo pela espécie nova. IVs,
              nature e habilidade continuam.
            </p>
            <button
              type="button"
              class="btn btn-primary"
              disabled={pending}
              onclick={() => {
                confirmEvolve = null
                void evolve(option.toSpeciesId)
              }}
            >
              Evoluir mesmo assim
            </button>
            <button type="button" class="btn" disabled={pending} onclick={() => (confirmEvolve = null)}>Cancelar</button>
          {:else if mon.level >= option.minLevel && !inDaycare}
            <button type="button" class="btn btn-primary" disabled={pending} onclick={() => (confirmEvolve = option.toSpeciesId)}>
              Evoluir para {option.displayName}
            </button>
          {:else}
            <button type="button" class="btn" disabled>
              {inDaycare ? 'Está no daycare' : `Evolui no Nv ${option.minLevel}`}
            </button>
          {/if}
        {/each}
      </div>
    {/if}

    <div class="block">
      <h3>Daycare</h3>
      {#if inDaycare}
        <button type="button" class="btn btn-primary" disabled={pending} onclick={() => void takeFromDaycare()}>Retirar</button>
      {:else}
        <button type="button" class="btn" disabled={pending || daycareReason !== ''} onclick={() => void putInDaycare()}>
          {daycareReason || 'Colocar no daycare'}
        </button>
      {/if}
    </div>

    {#if dev}
      <button type="button" class="btn" onclick={dev.toggle}>{dev.asleep ? 'Acordar (teste)' : 'Dormir (teste)'}</button>
    {/if}
    {/if}
  </div>

  <div class="dock">
    {#if confirmRelease}
      <p class="preview">
        Soltar rende {yield_.chain} doces da linha e {yield_.generic} genérico.
        {#if mon.isShiny}Ele é shiny.{/if}
        {#if mon.isFavorite}Ele é favorito.{/if}
      </p>
      <button type="button" class="btn danger" disabled={pending} onclick={() => void release()}>Confirmar soltura</button>
      <button type="button" class="btn" disabled={pending} onclick={() => (confirmRelease = false)}>Cancelar</button>
    {:else}
      <button type="button" class="btn" disabled={pending || releaseReason !== ''} onclick={askRelease}>
        {releaseReason || `Soltar · +${yield_.chain} doces`}
      </button>
    {/if}
  </div>
</div>
</div>

<style>
  .overlay {
    position: fixed;
    z-index: 40;
    inset: 0;
    display: grid;
    place-items: center;
    padding:
      calc(env(safe-area-inset-top) + 0.5rem)
      calc(env(safe-area-inset-right) + 0.5rem)
      calc(env(safe-area-inset-bottom) + 0.5rem)
      calc(env(safe-area-inset-left) + 0.5rem);
    box-sizing: border-box;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: #1a1208aa;
    cursor: pointer;
  }

  .sheet {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: min(100%, 28rem);
    /* Altura fixa: com fit-content a ficha mudava de tamanho a cada aba e
       pulava na tela. Só a área da aba varia por dentro. */
    height: min(100%, 46rem);
    max-height: 100%;
    min-width: 0;
    margin: 0;
    overflow: hidden;
  }

  .scroll {
    display: grid;
    gap: 0.6rem;
    flex: 1 1 auto;
    align-content: start;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .dock {
    flex: none;
  }

  /* Só o conteúdo da aba rola; topo, abas e rodapé ficam no lugar. */
  .sheet > :not(.scroll) {
    flex: none;
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.35rem;
    flex: none;
  }

  /* Mesmas molduras das escolhas de time: inlay solto, selected marcado. */
  .tab {
    box-sizing: border-box;
    min-width: 0;
    min-height: 44px;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 2px 0 var(--inlay-shade);
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }

  .tab[aria-selected='true'] {
    border-color: var(--selected);
    background: var(--selected-face);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -2px 0 var(--selected);
    font-weight: 700;
  }

  .head {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    min-width: 0;
  }

  .title-row h2,
  .title-row .name-edit {
    flex: 1 1 auto;
    min-width: 0;
  }

  .body-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    align-items: center;
    min-width: 0;
  }

  .portrait {
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 2px 0 var(--inlay-shade);
  }

  .portrait.popping img {
    animation: evolve 0.6s steps(2, end);
  }

  @keyframes evolve {
    0% {
      transform: scale(0.4);
      filter: brightness(2.4);
    }
    100% {
      transform: none;
      filter: none;
    }
  }

  .portrait img {
    max-width: 96px;
    max-height: 96px;
  }

  .meta {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  h2,
  h3 {
    margin: 0;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    min-width: 0;
    font-size: 1.15rem;
  }

  .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name-edit {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
  }

  .nick-input {
    flex: 1 1 auto;
    min-width: 0;
    width: auto;
    min-height: 36px;
    padding: 0.2rem 0.4rem;
    font-size: 1.05rem;
    font-weight: 700;
  }

  .icon-btn {
    flex: none;
    box-sizing: border-box;
    width: 44px;
    height: 44px;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    color: var(--ink);
    font: inherit;
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    touch-action: manipulation;
  }

  .icon-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .icon-btn.star {
    display: grid;
    place-items: center;
  }

  /* Contorno = Pixelarticons (MIT); cheia = mesmo traço. Sempre 24 CSS px (= grade). */
  .pixel-star {
    display: block;
    flex: none;
    width: 24px;
    height: 24px;
    fill: currentColor;
    overflow: visible;
  }

  h3 {
    font-size: 1.05rem;
  }

  .shiny {
    color: #e0a800;
  }

  p {
    margin: 0;
  }

  .lv,
  .hint,
  .preview {
    font-weight: 600;
  }

  .hint,
  .preview {
    font-size: 16px;
  }

  .candies {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.15rem;
  }

  .candy {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: baseline;
    gap: 0.25rem;
    box-sizing: border-box;
    width: calc(3ch + 3ch + 0.25rem + 0.8rem + 4px);
    min-height: 28px;
    padding: 0.15rem 0.4rem;
    border: 2px solid var(--panel-edge);
    font-size: 0.85rem;
    font-weight: 700;
    line-height: 1.1;
  }

  .candy small {
    width: 3ch;
    flex: none;
    font-size: 0.72rem;
    font-weight: 700;
    opacity: 0.9;
  }

  .candy strong {
    width: 3ch;
    flex: none;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .candy.chain {
    background: #f8d0e8;
    box-shadow: inset 0 -2px 0 #c878a0;
  }

  .candy.generic {
    background: #d0e0f8;
    box-shadow: inset 0 -2px 0 #7890c8;
  }

  .xp {
    display: grid;
    gap: 0.1rem;
  }

  .bar {
    height: 10px;
    background: #00000025;
    box-shadow: inset 0 0 0 var(--px) var(--ink);
  }

  .bar span {
    display: block;
    height: 100%;
    background: #4aa3e0;
    box-shadow: inset 0 calc(var(--px) * -2) 0 #2f7bb0, inset 0 0 0 var(--px) var(--ink);
  }

  .xp small {
    font-size: 15px;
  }

  .close {
    flex: none;
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
    padding: 0;
    font-size: 0.95rem;
  }

  .coins,
  .stepper,
  .block,
  .dock {
    display: grid;
    gap: 0.4rem;
    min-width: 0;
  }

  .coins,
  .stepper {
    grid-template-columns: 1fr auto 1fr;
  }

  .stepper span {
    display: grid;
    place-items: center;
    min-width: 48px;
    min-height: 48px;
    font-weight: 700;
  }

  .dock .btn,
  .block .btn {
    width: 100%;
  }

  .danger {
    color: var(--danger);
  }

  .alert {
    margin: 0;
    color: var(--danger);
    font-weight: 700;
  }

  .muted {
    font-weight: 600;
    opacity: 0.75;
  }

  .traits {
    text-align: center;
  }

  .traits .hint {
    justify-self: center;
  }

  .caught-with {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  .caught-ball {
    flex: none;
    image-rendering: pixelated;
  }

  .move {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.4rem;
    align-items: center;
  }

  .slot {
    font-size: 14px;
    font-weight: 700;
    opacity: 0.8;
  }

  .picks {
    grid-template-columns: 1fr;
  }
</style>
