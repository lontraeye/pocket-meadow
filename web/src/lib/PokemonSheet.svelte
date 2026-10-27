<script lang="ts">
  import { api, errorText, type ApiError, type GameState, type OwnedPokemon } from './api'
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

  async function feed() {
    const asked = Math.min(doses, maxDoses)
    if (asked < 1) return
    const ok = await send(`/api/pokemon/${mon.id}/feed`, { candies: asked, useGeneric })
    if (ok) message = 'Alimentado.'
  }

  async function evolve(toSpeciesId: number) {
    const ok = await send(`/api/pokemon/${mon.id}/evolve`, { toSpeciesId })
    if (ok) message = 'Evoluiu!'
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
</script>

<section class="panel sheet" class:fill aria-label="Detalhes">
  <div class="scroll">
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
