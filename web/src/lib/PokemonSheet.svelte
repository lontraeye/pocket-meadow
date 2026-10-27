<script lang="ts">
  import { spriteLoading } from './spriteLoading'
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
  import { play } from './sound'
  import { showdownSrc } from './sprites'
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
  let confirmRelease = $state(false)
  let popping = $state(false)
  let message = $state('')
  let pending = $state(false)
  let seenSpecies = $state(0)
  let highlightCards = $state<HighlightCard[]>([])
  let regionsCache = $state<RegionInfo[] | null>(null)
  let swapping = $state<'fast' | 'charged' | null>(null)

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
    swapping = null
    void current
  })

  const natureHint = $derived(formatNature(mon.nature))
  const ivStars = $derived('★'.repeat(mon.ivRating.stars) + '☆'.repeat(5 - mon.ivRating.stars))

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
        moveOffers?: OwnedPokemon['learnset']
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
          moveOffers: payload.moveOffers,
          learnset: mon.learnset,
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
        moveOffers?: OwnedPokemon['learnset']
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
        moveOffers: payload.moveOffers,
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
        moveOffers?: OwnedPokemon['learnset']
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
          moveOffers: payload.moveOffers,
          learnset: mon.learnset,
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
      <div class="highlights">
        <Highlights cards={highlightCards} onDone={() => (highlightCards = [])} />
      </div>
    {/if}
    <div class="head">
      <div class="portrait" class:popping>
        <img use:spriteLoading={showdownSrc(mon.speciesId, mon.isShiny)} src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" />
      </div>
      <div class="info">
        <h2>
          {mon.nickname ?? mon.displayName}
          {#if mon.isShiny}<span class="shiny" title="Shiny">★</span>{/if}
        </h2>
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
        <p class="candy">Linha {chainCandies} · genérico {generic}</p>
      </div>
      <button type="button" class="btn close" aria-label="Fechar" onclick={onClose}>✕</button>
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

    <div class="block traits">
      <h3>Traços</h3>
      <p class="hint">IVs {ivStars} · {mon.ivRating.percent}%</p>
      <p class="hint">Natureza {mon.nature.displayName} ({natureHint})</p>
      <p class="hint">
        Habilidade {mon.ability.displayName}
        {#if !mon.ability.combat}
          <span class="muted"> · sem efeito em combate por enquanto</span>
        {/if}
      </p>
      <ul class="stats">
        <li><span>HP</span><strong>{mon.stats.hp}</strong></li>
        <li><span>Atq</span><strong>{mon.stats.attack}</strong></li>
        <li><span>Def</span><strong>{mon.stats.defense}</strong></li>
        <li><span>AtqE</span><strong>{mon.stats.spAttack}</strong></li>
        <li><span>DefE</span><strong>{mon.stats.spDefense}</strong></li>
        <li><span>Vel</span><strong>{mon.stats.speed}</strong></li>
      </ul>
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
        </div>
        <button type="button" class="btn" disabled={pending} onclick={() => (swapping = swapping === 'fast' ? null : 'fast')}>
          Trocar
        </button>
      </div>
      {#if swapping === 'fast'}
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
          {:else}
            <strong>Ainda não aprendeu um golpe carregado</strong>
            {#if mon.nextChargedMove}
              <p class="hint">Aprende {mon.nextChargedMove.displayName} no Nv {mon.nextChargedMove.level}</p>
            {/if}
          {/if}
        </div>
        <button
          type="button"
          class="btn"
          disabled={pending || mon.availableMoves.charged.length === 0}
          onclick={() => (swapping = swapping === 'charged' ? null : 'charged')}
        >
          Trocar
        </button>
      </div>
      {#if swapping === 'charged'}
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

  .highlights {
    margin-bottom: 0.5rem;
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
    border: 8px solid transparent;
    border-image: url('/ui/inlay.png') 4 fill / 8px round;
    background: none;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
  }

  .tab[aria-selected='true'] {
    border-image: url('/ui/selected.png') 6 fill / 8px round;
    font-weight: 700;
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

  .muted {
    font-weight: 600;
    opacity: 0.75;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .stats li {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .stats span {
    font-size: 14px;
    font-weight: 700;
    opacity: 0.8;
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
