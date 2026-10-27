<script lang="ts">
  import { serverClock } from './serverClock.svelte'
  import { formatCountdown } from './time'
  import { onMount, untrack } from 'svelte'
  import {
    api,
    berryIconSrc,
    effectLabel,
    errorText,
    itemLabel,
    type ApiError,
    type BattleOutcome,
    type GameState,
    type PendingEncounter,
    type RegionInfo,
  } from './api'
  import { percent, previewWinChance } from './battle'
  import PmdSprite from './PmdSprite.svelte'
  import { gardenSprite, pmdAnim, showdownSrc } from './sprites'

  let { game, onClose, onState }: { game: GameState; onClose: () => void; onState: () => Promise<void> } = $props()

  type Step = 'regions' | 'encounter' | 'result'
  type Result = { kind: 'fled' } | { kind: 'battle'; battle: BattleOutcome }

  let step = $state<Step>(untrack(() => (game.encounter ? 'encounter' : 'regions')))
  let encounter = $state<PendingEncounter | null>(untrack(() => game.encounter))
  let regions = $state<RegionInfo[]>([])
  let selected = $state<number[]>([])
  let result = $state<Result | null>(null)
  let message = $state('')
  let pending = $state(false)
  let time = $state(0)

  const clock = serverClock(() => game.now)

  const groups = $derived([
    { id: 'kanto', title: 'Kanto', regions: regions.filter((region) => region.gameRegion === 'kanto') },
    { id: 'johto', title: 'Johto', regions: regions.filter((region) => region.gameRegion === 'johto') },
  ])
  const roster = $derived(
    game.pokemon
      .filter((mon) => mon.location === 'garden')
      .sort((a, b) => b.level - a.level || a.id - b.id),
  )
  const chosen = $derived(selected.flatMap((id) => roster.filter((mon) => mon.id === id)))
  const chance = $derived(
    encounter && chosen.length > 0 ? previewWinChance(chosen.map((mon) => mon.power), encounter.wildPower, game.battle) : null,
  )

  onMount(() => {
    void loadRegions()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const loop = (now: number) => {
      time = now
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  })

  async function loadRegions() {
    const response = await api('/api/regions')
    if (!response.ok) {
      message = errorText(await readError(response))
      return
    }
    const body = (await response.json()) as { regions: RegionInfo[] }
    regions = body.regions
  }

  async function search(slug: string) {
    pending = true
    message = ''
    try {
      const response = await api('/api/encounters', { regionSlug: slug })
      if (!response.ok) {
        message = errorText(await readError(response))
        await onState()
        return
      }
      encounter = (await response.json()) as PendingEncounter
      selected = []
      step = 'encounter'
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  async function refillEnergy() {
    pending = true
    message = ''
    try {
      const response = await api('/api/dev/energy', {})
      if (!response.ok) message = errorText(await readError(response))
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  function toggle(id: number) {
    if (selected.includes(id)) {
      selected = selected.filter((entry) => entry !== id)
      return
    }
    if (selected.length >= 3) return
    selected = [...selected, id]
  }

  async function battle() {
    if (!encounter || chosen.length === 0) return
    pending = true
    message = ''
    try {
      const response = await api(`/api/encounters/${encounter.id}/battle`, { pokemonIds: chosen.map((mon) => mon.id) })
      if (!response.ok) {
        message = errorText(await readError(response))
        if (response.status === 404) {
          encounter = null
          step = 'regions'
        }
        await onState()
        return
      }
      result = { kind: 'battle', battle: (await response.json()) as BattleOutcome }
      step = 'result'
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  async function flee() {
    if (!encounter) return
    pending = true
    message = ''
    try {
      const response = await api(`/api/encounters/${encounter.id}/flee`, {})
      if (!response.ok) {
        message = errorText(await readError(response))
        if (response.status === 404) {
          encounter = null
          step = 'regions'
        }
        await onState()
        return
      }
      result = { kind: 'fled' }
      step = 'result'
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  function nameOf(id: number): string {
    const mon = game.pokemon.find((entry) => entry.id === id)
    return mon ? (mon.nickname ?? mon.displayName) : 'Pokémon'
  }

  function readyToEvolve(fighter: BattleOutcome['fighters'][number]): boolean {
    const mon = game.pokemon.find((entry) => entry.id === fighter.pokemonId)
    if (!mon) return false
    const before = fighter.level - fighter.levelsGained
    return mon.evolutions.some((option) => before < option.minLevel && fighter.level >= option.minLevel)
  }

  async function readError(response: Response): Promise<ApiError> {
    return (await response.json().catch(() => ({ error: 'internal' }))) as ApiError
  }
</script>

{#snippet wild(mon: PendingEncounter)}
  {@const look = gardenSprite(mon.speciesId, mon.isShiny)}
  {@const idle = look.kind === 'pmd' ? pmdAnim(mon.speciesId, look.shinySheet, 'Idle') : null}
  <div class="stage">
    {#if look.kind === 'pmd' && idle}
      <div class="anchor">
        <PmdSprite
          speciesId={mon.speciesId}
          shiny={look.shinySheet}
          anim="Idle"
          dir={0}
          scale={3}
          {time}
          shadow={look.shadow}
        />
      </div>
    {:else}
      <img class="fallback" src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" />
    {/if}
  </div>
  <h2>
    {mon.displayName}
    {#if mon.isShiny}<span class="star" title="Shiny">★</span>{/if}
  </h2>
  <p class="lv">Nv {mon.level} · {mon.regionName}</p>
{/snippet}

<div class="flow">
  {#if message}
    <p class="alert" role="alert">{message}</p>
  {/if}

  {#if step === 'regions'}
    <div class="scroll">
      <section class="panel sheet">
        <h2>Para onde?</h2>
        <p class="hint">
          Cada encontro gasta 1 de energia. Energia {game.trainer.energy}/{game.trainer.energyMax}.
          {#if game.trainer.energy < 1}Sem energia no momento.{/if}
        </p>
        {#if game.effects.length > 0}
          <div class="chips" aria-label="Efeitos ativos">
            {#each game.effects as effect (effect.id)}
              <span class="chip">
                {effectLabel(effect.effectKey)}{effect.multiplier}
                {#if effect.charges !== null}
                  · {effect.charges} carga{effect.charges === 1 ? '' : 's'}
                {:else if effect.expiresAt !== null}
                  · {formatCountdown(Math.max(0, effect.expiresAt - clock.now()))}
                {/if}
              </span>
            {/each}
          </div>
        {/if}
        {#if game.devTools}
          <button type="button" class="btn choice" disabled={pending} onclick={refillEnergy}>Encher energia (teste)</button>
        {/if}
        {#if game.encounter}
          <button
            type="button"
            class="btn btn-primary choice"
            onclick={() => {
              encounter = game.encounter
              step = 'encounter'
            }}
          >
            Continuar encontro
          </button>
        {/if}
        {#each groups as group (group.id)}
          {#if group.regions.length > 0}
            <h3>{group.title}</h3>
            {#each group.regions as region (region.slug)}
              <button
                type="button"
                class="btn choice"
                class:btn-primary={region.unlocked && !game.encounter}
                disabled={pending || !region.unlocked || game.trainer.energy < 1 || game.encounter !== null}
                onclick={() => search(region.slug)}
              >
                <span>{region.name}</span>
                <small>Nv {region.wildLevelRange[0]}–{region.wildLevelRange[1]}</small>
                {#if !region.unlocked}<small>Abre no nível {region.minTrainerLevel}</small>{/if}
              </button>
            {/each}
          {/if}
        {/each}
        {#if regions.length === 0 && !message}
          <p class="hint">Olhando o mapa…</p>
        {/if}
      </section>
    </div>
    <div class="dock">
      <button type="button" class="btn" onclick={onClose}>Jardim</button>
    </div>
  {:else if step === 'encounter' && encounter}
    <div class="scroll">
      <section class="panel sheet wild">
        {@render wild(encounter)}
      </section>
      <section class="panel sheet">
        <h2>Time {chosen.length}/3</h2>
        {#if roster.length === 0}
          <p class="hint">Nenhum Pokémon no jardim.</p>
        {:else}
          <div class="roster">
            {#each roster as mon (mon.id)}
              {@const on = selected.includes(mon.id)}
              <button
                type="button"
                class="member"
                class:on
                aria-pressed={on}
                disabled={pending || (!on && selected.length >= 3)}
                onclick={() => toggle(mon.id)}
              >
                <span>{mon.nickname ?? mon.displayName}{#if mon.isShiny} ★{/if}</span>
                <small>Nv {mon.level}</small>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    </div>
    <div class="dock">
      <p class="odds">{chance === null ? 'Escolha de 1 a 3 Pokémon.' : `Chance de vitória ${percent(chance)}`}</p>
      <button type="button" class="btn btn-primary" disabled={pending || chosen.length === 0} onclick={battle}>Batalhar</button>
      <button type="button" class="btn" disabled={pending} onclick={flee}>Fugir</button>
      <button type="button" class="btn-link" onclick={onClose}>Voltar ao jardim</button>
    </div>
  {:else if step === 'result' && result}
    <div class="scroll">
      <section class="panel sheet wild">
        {#if result.kind === 'fled'}
          <h2>Fugiu</h2>
          <p>O encontro acabou. A energia não volta.</p>
        {:else if encounter}
          {@render wild(encounter)}
          {#if result.battle.caught}
            <p class="good">Capturado! Entrou no jardim.</p>
          {:else if result.battle.won}
            <p>Você venceu, mas ele fugiu.</p>
          {:else}
            <p class="bad">Derrota. Seus Pokémon não se machucaram.</p>
          {/if}
          <p class="hint">Chance de vitória {percent(result.battle.winChance)}</p>
          {#if result.battle.catchChance !== null}
            <p class="hint">Chance de captura {percent(result.battle.catchChance)}</p>
          {/if}
          <ul class="gains">
            {#each result.battle.fighters as fighter (fighter.pokemonId)}
              <li class:ready={readyToEvolve(fighter)}>
                {nameOf(fighter.pokemonId)} +{fighter.xpGained} XP
                {#if fighter.levelsGained > 0}<strong> · nível {fighter.level}</strong>{/if}
                {#if readyToEvolve(fighter)}<strong> · pode evoluir</strong>{/if}
              </li>
            {/each}
            {#if result.battle.trainerXpGained > 0}
              <li>
                Você +{result.battle.trainerXpGained} XP
                {#if result.battle.trainer.levelsGained > 0}
                  <strong> · treinador nível {result.battle.trainer.level}</strong>
                {/if}
              </li>
            {/if}
            {#if result.battle.seedDrop}
              <li class="loot">
                <img src={berryIconSrc(result.battle.seedDrop.berryKey)} alt="" width="24" height="24" />
                Semente {itemLabel(result.battle.seedDrop.itemKey, game.berries)}
              </li>
            {/if}
            {#each result.battle.levelRewards ?? [] as reward (reward.itemKey)}
              <li class="loot">
                {#if reward.itemKey.startsWith('seed:')}
                  <img src={berryIconSrc(reward.itemKey.slice(5))} alt="" width="24" height="24" />
                {/if}
                Nível: {itemLabel(reward.itemKey, game.berries)} ×{reward.quantity}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
    <div class="dock">
      <button type="button" class="btn btn-primary" onclick={onClose}>Ver no jardim</button>
    </div>
  {/if}
</div>

<style>
  .flow {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
  }

  .scroll {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
    overflow: auto;
  }

  .sheet {
    display: grid;
    gap: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.35rem;
  }

  h3 {
    margin: 0;
    font-size: 1.15rem;
  }

  .hint,
  .lv,
  .odds {
    margin: 0;
    font-weight: 600;
  }

  .odds {
    text-align: center;
  }

  .alert {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
  }

  .good {
    margin: 0;
    color: var(--grass-side);
    font-weight: 700;
  }

  .bad {
    margin: 0;
    color: var(--danger);
    font-weight: 700;
  }

  .star {
    color: var(--accent);
  }

  .choice,
  .dock .btn {
    width: 100%;
  }

  .choice {
    flex-direction: column;
    gap: 0.1rem;
    height: auto;
  }

  .choice small,
  .member small {
    font-size: 15px;
    font-weight: 600;
  }

  .btn-primary small {
    color: #f3ffe8;
  }

  .stage {
    position: relative;
    height: 10rem;
  }

  .anchor {
    position: absolute;
    left: 50%;
    bottom: 0.75rem;
    width: 0;
    height: 0;
  }

  .fallback {
    position: absolute;
    left: 50%;
    bottom: 0.75rem;
    width: 96px;
    height: 96px;
    transform: translateX(-50%);
    object-fit: contain;
  }

  .wild {
    justify-items: center;
    text-align: center;
  }

  .roster {
    display: grid;
    gap: 0.4rem;
  }

  .member {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    box-sizing: border-box;
    width: 100%;
    min-height: 48px;
    padding: 0 0.6rem;
    border: 8px solid transparent;
    border-image: url('/ui/inlay.png') 4 fill / 8px round;
    background: none;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
  }

  .member.on {
    border-image: url('/ui/selected.png') 6 fill / 8px round;
  }

  .member:disabled {
    filter: grayscale(1) opacity(0.6);
    cursor: default;
  }

  .dock {
    display: grid;
    flex: none;
    gap: 0.35rem;
  }

  .dock .btn-link {
    justify-self: center;
  }

  .gains {
    margin: 0;
    padding: 0;
    list-style: none;
    font-weight: 600;
  }

  .gains li {
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    text-align: center;
  }

  .gains li.ready {
    color: var(--grass-side);
  }

  .gains li.loot {
    gap: 0.35rem;
  }

  .gains li.loot img {
    image-rendering: pixelated;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 0.2rem 0.55rem;
    background: #00000014;
    box-shadow: inset 0 0 0 var(--px) #00000022;
    font-size: 0.85rem;
    font-weight: 700;
  }
</style>
