<script lang="ts">
  import {
    api,
    errorText,
    type ApiError,
    type GameState,
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
  import { showdownSrc } from './sprites'

  let {
    game,
    mon,
    dev = null,
    fill = false,
    onClose,
    onState,
  }: {
    game: GameState
    mon: OwnedPokemon
    dev?: { asleep: boolean; toggle: () => void } | null
    fill?: boolean
    onClose: () => void
    onState: () => Promise<void>
  } = $props()

  let doses = $state(1)
  let useGeneric = $state(false)
  let nickname = $state('')
  let confirmRelease = $state(false)
  let popping = $state(false)
  let message = $state('')
  let pending = $state(false)
  let seenSpecies = $state(0)
  let highlightCards = $state<HighlightCard[]>([])
  let regionsCache = $state<RegionInfo[] | null>(null)

  const rules = $derived(game.progression)
  const chainCandies = $derived(game.candies.find((row) => row.evolutionChainId === mon.evolutionChainId)?.amount ?? 0)
  const generic = $derived(game.trainer.genericCandies)
  const atCap = $derived(mon.level >= rules.levelCap || mon.xpToNext === null)
  const room = $derived(atCap ? 0 : Math.min(dosesToCap(mon.level, mon.xp, rules), rules.feedMax))
  const affordable = $derived(useGeneric ? Math.floor(generic / rules.genericPerCandy) : chainCandies)
  const maxDoses = $derived(Math.min(room, affordable))
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
    doses = 1
    confirmRelease = false
    void current
  })

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
      })
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  async function release() {
    const ok = await send(`/api/pokemon/${mon.id}/release`, {})
    if (ok) onClose()
  }

  // Sempre confirma: o botão fica no dock, onde o polegar passa.
  function askRelease() {
    confirmRelease = true
  }

  async function saveNickname() {
    await send(`/api/pokemon/${mon.id}`, { nickname }, 'PATCH')
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
</script>

<section class="panel sheet" class:fill aria-label="Detalhes">
  <div class="scroll">
    {#if highlightCards.length > 0}
      <div class="highlights">
        <Highlights cards={highlightCards} onDone={() => (highlightCards = [])} />
      </div>
    {/if}
    <div class="head">
      <div class="portrait" class:popping>
        <img src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" />
      </div>
      <div class="info">
        <h2>
          {mon.nickname ?? mon.displayName}
          {#if mon.isShiny}<span class="shiny" title="Shiny">★</span>{/if}
        </h2>
        <p class="lv">Nv {mon.level} · poder {Math.round(mon.power)}</p>
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
        <p class="candy">Linha {chainCandies} · genérico {generic}</p>
      </div>
      <button type="button" class="btn close" aria-label="Fechar" onclick={onClose}>✕</button>
    </div>

    {#if message}<p class="alert" role="alert">{message}</p>{/if}

    <form
      class="nick"
      onsubmit={(event) => {
        event.preventDefault()
        void saveNickname()
      }}
    >
      <input class="field" bind:value={nickname} maxlength="12" autocomplete="off" aria-label="Apelido" placeholder="Apelido" />
      <button type="submit" class="btn" disabled={pending}>Salvar</button>
      <button type="button" class="btn" aria-pressed={mon.isFavorite} disabled={pending} onclick={() => void toggleFavorite()}>
        {mon.isFavorite ? '★ Favorito' : 'Favorito'}
      </button>
    </form>

    <div class="block">
      <h3>Alimentar</h3>
      {#if atCap}
        <p class="hint">Nível máximo.</p>
      {:else if maxDoses < 1}
        <p class="hint">Sem doces para isso.</p>
      {:else}
        <div class="coins">
          <button type="button" class="btn" class:btn-primary={!useGeneric} aria-pressed={!useGeneric} onclick={() => (useGeneric = false)}>
            Da linha
          </button>
          <button type="button" class="btn" class:btn-primary={useGeneric} aria-pressed={useGeneric} onclick={() => (useGeneric = true)}>
            Genérico
          </button>
        </div>
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
    </div>

    {#if mon.evolutions.length > 0}
      <div class="block">
        <h3>Evoluir</h3>
        {#each mon.evolutions as option (option.toSpeciesId)}
          {#if mon.level >= option.minLevel && !inDaycare}
            <button type="button" class="btn btn-primary" disabled={pending} onclick={() => void evolve(option.toSpeciesId)}>
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
</section>

<style>
  .highlights {
    margin-bottom: 0.5rem;
  }

  .sheet {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    min-height: 0;
  }

  .sheet.fill {
    flex: 1;
  }

  .sheet.fill .scroll {
    flex: 1;
  }

  .scroll {
    display: grid;
    gap: 0.6rem;
    min-width: 0;
    overflow: auto;
  }

  .head {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    align-items: center;
    padding-right: 3.25rem;
  }

  .portrait {
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    border: 8px solid transparent;
    border-image: url('/ui/inlay.png') 4 fill / 8px round;
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

  .info {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  h2,
  h3 {
    margin: 0;
  }

  h2 {
    font-size: 1.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .candy,
  .hint,
  .preview {
    font-weight: 600;
  }

  .candy,
  .hint,
  .preview {
    font-size: 16px;
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
    position: absolute;
    top: 0;
    right: 0;
    padding: 0;
  }

  .nick,
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
  .block .btn,
  .nick .btn {
    width: 100%;
  }

  .danger {
    border-image-source: url('/ui/panel.png');
    color: var(--danger);
  }

  .alert {
    margin: 0;
    color: var(--danger);
    font-weight: 700;
  }
</style>
