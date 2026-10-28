<script lang="ts">
  import { spriteLoading } from './spriteLoading'
  import { serverClock } from './serverClock.svelte'
  import { formatCountdown } from './time'
  import { onMount, untrack } from 'svelte'
  import {
    api,
    effectLabel,
    errorText,
    type ApiError,
    type BattleOutcome,
    type BattleStart,
    type GameState,
    type OwnedPokemon,
    type PendingEncounter,
    type RegionInfo,
    type ThrowOutcome,
  } from './api'
  import { percent } from './battle'
  import BattleLive from './BattleLive.svelte'
  import { setLiveFight } from './liveFight'
  import BattleScene from './BattleScene.svelte'
  import {
    clearSavedBattle,
    loadSavedBattle,
  } from './battlePersist'
  import Highlights from './Highlights.svelte'
  import { battleHighlightCards, mergeCaptureOutcome, prefersReducedMotion, throwRewardCards } from './highlights'
  import PmdSprite from './PmdSprite.svelte'
  import { battleSpritesReady, spriteReady } from './preload'
  import { play, playCry, warmCries } from './sound'
  import { gardenSprite, loadPmdBattle, pmdAnim, showdownSrc } from './sprites'
  import { simConfig, type BattleInput } from './sim'

  let { game, onClose, onState }: { game: GameState; onClose: () => void; onState: () => Promise<void> } = $props()

  type Step = 'regions' | 'encounter' | 'fight' | 'decide' | 'throw' | 'highlights' | 'result'
  type Result =
    | { kind: 'fled' }
    | { kind: 'battle'; battle: BattleOutcome; team: OwnedPokemon[]; left?: boolean }

  let step = $state<Step>(
    untrack(() => (game.encounter?.wonAt ? 'decide' : game.encounter ? 'encounter' : 'regions')),
  )
  let encounter = $state<PendingEncounter | null>(untrack(() => game.encounter))
  let regions = $state<RegionInfo[]>([])
  let selected = $state<number[]>([])
  let result = $state<Result | null>(null)
  let message = $state('')
  let pending = $state(false)
  // Região tocada, enquanto o encontro e o sprite do selvagem chegam.
  let searching = $state<string | null>(null)
  // "Batalhar" tocado, até a cena estar pronta para começar.
  let fighting = $state(false)
  let time = $state(0)
  let battleCards = $state<ReturnType<typeof battleHighlightCards>>([])
  let fightStart = $state<BattleStart | null>(null)
  let fightTeam = $state<OwnedPokemon[]>([])
  let fightInputs = $state<BattleInput[]>([])
  let fightResumeMs = $state(0)
  let lastThrow = $state<ThrowOutcome | null>(null)
  let throwing = $state(false)
  let notice = $state('')
  let appliedThrow = $state<number | null>(null)
  let battleAuto = $state(untrack(() => game.trainer.battleAuto))
  let prefsBusy = false

  const clock = serverClock(() => game.now)

  $effect(() => {
    const server = game.trainer.battleAuto
    if (!prefsBusy) battleAuto = server
  })

  // Avisa o PWA: não recarregar no meio da luta ao vivo.
  $effect(() => {
    setLiveFight(step === 'fight')
    return () => setLiveFight(false)
  })

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

  // Grito quando o selvagem aparece (busca nova ou encontro já pendente).
  let criedFor = $state<number | null>(null)
  $effect(() => {
    if (step !== 'encounter' || !encounter) return
    if (criedFor === encounter.id) return
    criedFor = encounter.id
    playCry(encounter.speciesId)
  })

  // Retomar luta interrompida (o app fechou ou recarregou no meio).
  let resumedFor: number | null = null
  $effect(() => {
    if (step !== 'encounter' || !encounter?.battleStartedAt || encounter.wonAt || pending || fightStart) return
    if (resumedFor === encounter.id) return
    resumedFor = encounter.id
    void resumeInterrupted(encounter)
  })

  // Vitória aguardando captura: reabre na decisão (encontro novo ou reload).
  $effect(() => {
    const found = game.encounter
    if (!found?.wonAt) return
    if (step === 'throw' || step === 'fight' || step === 'highlights' || step === 'result') return
    encounter = found
    if (step !== 'decide') step = 'decide'
    const look = gardenSprite(found.speciesId, found.isShiny)
    if (look.kind === 'pmd') void loadPmdBattle(found.speciesId, look.shinySheet)
  })

  /**
   * A luta já começou no servidor (battleStartedAt). Com o save do aparelho
   * (localStorage, ver battlePersist.ts) ela continua de onde parou, com o
   * tempo contado pelo relógio do servidor; passado o limite (mais a folga),
   * manda o que foi guardado e o servidor fecha o resultado.
   */
  async function resumeInterrupted(found: PendingEncounter) {
    const startedAt = found.battleStartedAt
    if (startedAt === null) return
    const saved = loadSavedBattle(found.id)
    if (!saved) {
      message = 'Luta interrompida sem dados neste aparelho. Você pode fugir do encontro.'
      return
    }
    pending = true
    message = ''
    try {
      const members = saved.setup.team.flatMap((fighter) => game.pokemon.filter((mon) => mon.id === fighter.id))
      const limit = saved.timeLimitMs || simConfig.timeLimitMs
      const late = clock.now() - startedAt > limit + simConfig.abandonSlackMs
      if (late) {
        const response = await api(`/api/encounters/${found.id}/battle/finish`, { inputs: saved.inputs })
        if (!response.ok) {
          const error = await readError(response)
          if (error.error === 'encounter_not_found') clearSavedBattle(found.id)
          if (error.error !== 'battle_already_won') message = errorText(error)
          await onState()
          return
        }
        clearSavedBattle(found.id)
        applyBattleResult((await response.json()) as BattleOutcome, members)
        return
      }
      await battleSpritesReady([
        { speciesId: found.speciesId, isShiny: found.isShiny },
        ...saved.setup.team.map((fighter) => ({
          speciesId: fighter.speciesId,
          isShiny: members.find((mon) => mon.id === fighter.id)?.isShiny ?? false,
        })),
      ])
      enterFight(
        { encounterId: found.id, seed: saved.seed, setup: saved.setup, timeLimitMs: limit },
        members,
        saved.inputs,
        clock.now() - startedAt,
      )
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  function enterFight(start: BattleStart, members: OwnedPokemon[], inputs: BattleInput[], elapsedMs: number) {
    fightStart = start
    fightTeam = members
    fightInputs = inputs
    fightResumeMs = Math.min(start.timeLimitMs, Math.max(0, Math.floor(elapsedMs)))
    step = 'fight'
  }

  async function setBattleAuto(on: boolean) {
    if (on === battleAuto) return
    const prev = battleAuto
    battleAuto = on
    prefsBusy = true
    try {
      const response = await api('/api/trainer/prefs', { battleAuto: on }, 'PUT')
      if (!response.ok) {
        battleAuto = prev
        message = errorText(await readError(response))
        return
      }
      void onState().catch(() => undefined)
    } catch {
      battleAuto = prev
      message = 'Sem conexão com o servidor.'
    } finally {
      prefsBusy = false
    }
  }
  function applyBattleResult(battle: BattleOutcome, teamSnapshot: OwnedPokemon[]) {
    result = { kind: 'battle', battle, team: teamSnapshot, left: false }
    battleCards = cardsForBattle(battle, teamSnapshot)
    if (!battle.won) {
      step = 'highlights'
    } else {
      if (encounter) {
        encounter = { ...encounter, wonAt: Date.now(), catchChance: battle.catchChance }
        const look = gardenSprite(encounter.speciesId, encounter.isShiny)
        if (look.kind === 'pmd') void loadPmdBattle(encounter.speciesId, look.shinySheet)
      }
      step = 'decide'
    }
    void onState().catch(() => undefined)
  }

  function cardsForBattle(battle: BattleOutcome, teamSnapshot: OwnedPokemon[]) {
    return battleHighlightCards({
      battle,
      nameOf,
      canEvolve: readyToEvolve,
      regions,
      berries: game.berries,
    })
  }

  function ensureBattleResult(): Extract<Result, { kind: 'battle' }> {
    if (result?.kind === 'battle') return result
    const pendingEncounter = encounter
    const created = {
      kind: 'battle' as const,
      battle: {
        encounterId: pendingEncounter?.id ?? 0,
        winChance: null,
        won: true,
        catchChance: pendingEncounter?.catchChance ?? null,
        caught: false,
        status: 'pending' as const,
        fighters: [],
        trainerXpGained: 0,
        trainer: { level: game.trainer.level, xp: game.trainer.xp, levelsGained: 0 },
        seedDrop: null,
        levelRewards: [],
      },
      team: [] as OwnedPokemon[],
      left: false,
    }
    result = created
    return created
  }

  function applyCaptureCards(kind: 'caught' | 'escaped' | 'left', extra?: ThrowOutcome) {
    const bonus =
      extra?.caught
        ? throwRewardCards({
            trainerXpGained: extra.trainerXpGained,
            trainer: extra.trainer,
            levelRewards: extra.levelRewards,
            regions,
            berries: game.berries,
          })
        : []
    battleCards = mergeCaptureOutcome(battleCards, kind, bonus)
  }

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
    play('tap')
    pending = true
    searching = slug
    message = ''
    notice = ''
    try {
      const response = await api('/api/encounters', { regionSlug: slug })
      if (!response.ok) {
        message = errorText(await readError(response))
        await onState()
        return
      }
      const found = (await response.json()) as PendingEncounter
      // O grito baixa junto com o sprite, para tocar assim que ele aparecer.
      warmCries([found.speciesId])
      await spriteReady(found.speciesId, found.isShiny)
      encounter = found
      selected = []
      step = 'encounter'
      // A tela já tem o que precisa; o HUD (energia) se atualiza em segundo
      // plano, sem segurar a escolha do time por mais uma ida ao servidor.
      void onState().catch(() => undefined)
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
      searching = null
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
    play('tap')
    pending = true
    fighting = true
    message = ''
    notice = ''
    const teamSnapshot = [...chosen]
    const wild = encounter
    try {
      const response = await api(`/api/encounters/${encounter.id}/battle/start`, {
        pokemonIds: chosen.map((mon) => mon.id),
      })
      if (!response.ok) {
        message = errorText(await readError(response))
        if (response.status === 404) {
          encounter = null
          step = 'regions'
        }
        await onState()
        return
      }
      const start = (await response.json()) as BattleStart
      // Marca na hora: se o finish falhar e voltarmos ao encontro, o Batalhar
      // fica desligado (evita battle_already_started) até o onState confirmar.
      encounter = { ...wild, battleStartedAt: Date.now() }
      const startedAt = performance.now()
      // O relógio da luta já corre no servidor: a espera pelos sprites (no
      // máximo 2,5 s) conta, senão o fim passaria do limite de abandono.
      await battleSpritesReady([
        { speciesId: wild.speciesId, isShiny: wild.isShiny },
        ...teamSnapshot.map((mon) => ({ speciesId: mon.speciesId, isShiny: mon.isShiny })),
      ])
      enterFight(start, teamSnapshot, [], performance.now() - startedAt)
      // Atualiza o encontro (battleStartedAt) em segundo plano: se o jogador sair
      // e voltar, a luta é retomada em vez de pedir um novo start.
      void onState().catch(() => undefined)
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
      fighting = false
    }
  }

  function onFightFinished(battle: BattleOutcome, teamSnapshot: OwnedPokemon[]) {
    fightStart = null
    applyBattleResult(battle, teamSnapshot)
  }

  function onFightError(code: string) {
    message = errorText({ error: code })
    fightStart = null
    if (code === 'encounter_not_found') {
      encounter = null
      step = 'regions'
      void onState().catch(() => undefined)
      return
    }
    step = 'encounter'
    // Sincroniza battleStartedAt: o resume (ou o Batalhar desligado) toma conta.
    void onState().catch(() => undefined)
  }

  function afterHighlights() {
    step = 'result'
  }

  async function throwBall() {
    if (!encounter) return
    play('tap')
    pending = true
    throwing = true
    message = ''
    notice = ''
    try {
      const response = await api(`/api/encounters/${encounter.id}/throw`, {})
      if (!response.ok) {
        const error = await readError(response)
        message = errorText(error)
        if (response.status === 404) {
          encounter = null
          step = 'regions'
        }
        await onState()
        return
      }
      const outcome = (await response.json()) as ThrowOutcome
      lastThrow = outcome
      encounter = { ...encounter, catchChance: outcome.catchChance }
      if (prefersReducedMotion()) afterThrow()
      else step = 'throw'
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
      throwing = false
    }
  }

  function afterThrow() {
    const outcome = lastThrow
    if (!outcome) {
      step = 'decide'
      return
    }
    if (appliedThrow === outcome.throwNumber) return
    appliedThrow = outcome.throwNumber
    if (outcome.status === 'pending') {
      notice = 'Escapou da bola! Tentar de novo?'
      const current = ensureBattleResult()
      result = { ...current, battle: { ...current.battle, catchChance: outcome.catchChance } }
      step = 'decide'
      void onState().catch(() => undefined)
      return
    }
    notice = ''
    const current = ensureBattleResult()
    result = {
      ...current,
      left: false,
      battle: {
        ...current.battle,
        caught: outcome.caught,
        catchChance: outcome.catchChance,
        status: outcome.status,
      },
    }
    applyCaptureCards(outcome.caught ? 'caught' : 'escaped', outcome)
    step = 'highlights'
    void onState().catch(() => undefined)
  }

  async function leaveWild() {
    if (!encounter) return
    play('tap')
    pending = true
    message = ''
    notice = ''
    try {
      const response = await api(`/api/encounters/${encounter.id}/release`, {})
      if (!response.ok) {
        const error = await readError(response)
        message = errorText(error)
        if (response.status === 404) {
          encounter = null
          step = 'regions'
        }
        await onState()
        return
      }
      play('release')
      const current = ensureBattleResult()
      result = {
        ...current,
        left: true,
        battle: { ...current.battle, caught: false, status: 'escaped' },
      }
      applyCaptureCards('left')
      step = 'highlights'
      void onState().catch(() => undefined)
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
    notice = ''
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
      void onState().catch(() => undefined)
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

<!--
  `compact`: sprite menor ao lado do nome, para sobrar tela para o time.
  `dizzy`: derrotado esperando a captura; balança tonto, com estrelas girando
  em cima da cabeça (a altura vem do ponto do chão no quadro da folha).
-->
{#snippet wild(mon: PendingEncounter, variant: 'full' | 'compact' | 'dizzy' = 'full')}
  {@const look = gardenSprite(mon.speciesId, mon.isShiny)}
  {@const sheet = look.kind === 'pmd' ? pmdAnim(mon.speciesId, look.shinySheet, 'Idle') : null}
  {@const scale = variant === 'compact' ? 2 : 3}
  {@const head = sheet ? Math.round((sheet.ground[1] ?? sheet.h) * scale * 0.85) : 84}
  <div class="wild-card" class:compact={variant === 'compact'}>
    <div class="stage">
      <div class="anchor" class:dizzy={variant === 'dizzy'}>
        {#if look.kind === 'pmd' && sheet}
          <PmdSprite
            speciesId={mon.speciesId}
            shiny={look.shinySheet}
            anim="Idle"
            dir={0}
            {scale}
            {time}
            shadow={look.shadow}
          />
        {:else}
          <img class="fallback" use:spriteLoading={showdownSrc(mon.speciesId, mon.isShiny)} src={showdownSrc(mon.speciesId, mon.isShiny)} alt="" />
        {/if}
        {#if variant === 'dizzy'}
          <div class="halo" style:--head="{head}px" aria-hidden="true">
            {#each [0, 1, 2] as n (n)}
              <span class="orbit" style:--i={n}>
                <svg viewBox="0 0 12 12" width="10" height="10"><path fill="#ffe66d" d="M6 0l1.5 4.2H12L8.2 6.8 9.7 11 6 8.4 2.3 11l1.5-4.2L0 4.2h4.5z" /></svg>
              </span>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    <div class="info">
      <h2>
        {mon.displayName}
        {#if mon.isShiny}<span class="star" title="Shiny">★</span>{/if}
      </h2>
      <p class="lv">Nv {mon.level} · {mon.regionName}</p>
    </div>
  </div>
{/snippet}

<div class="flow">
  {#if message}
    <p class="alert" role="alert">{message}</p>
  {/if}
  {#if notice}
    <p class="hint" role="status">{notice}</p>
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
              step = game.encounter?.wonAt ? 'decide' : 'encounter'
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
                aria-busy={searching === region.slug}
                disabled={pending || !region.unlocked || game.trainer.energy < 1 || game.encounter !== null}
                onclick={() => search(region.slug)}
              >
                <span>{region.name}</span>
                {#if searching === region.slug}
                  <small class="waiting"><span class="ball sprite-wait" aria-hidden="true"></span>Procurando…</small>
                {:else}
                  <small>Nv {region.wildLevelRange[0]}–{region.wildLevelRange[1]}</small>
                {/if}
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
      <section class="panel sheet">
        {@render wild(encounter, 'compact')}
      </section>
      <section class="panel sheet">
        <h2>Time {chosen.length}/3 <small class="pick">{chosen.length === 0 ? 'escolha de 1 a 3' : ''}</small></h2>
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
      <div class="pair">
        <button
          type="button"
          class="btn auto-pref"
          class:on={battleAuto}
          aria-pressed={battleAuto}
          disabled={pending}
          onclick={() => {
            play('tap')
            void setBattleAuto(!battleAuto)
          }}
        >
          <strong>Luta automática</strong>
          <small>{battleAuto ? 'Ligada' : 'Desligada'}</small>
        </button>
        <button type="button" class="btn" disabled={pending} onclick={flee}>Fugir</button>
      </div>
      <button
        type="button"
        class="btn btn-primary"
        aria-busy={fighting}
        disabled={pending || chosen.length === 0 || encounter.battleStartedAt !== null || encounter.wonAt !== null}
        onclick={battle}
      >
        {#if fighting}
          <span class="ball sprite-wait" aria-hidden="true"></span>Batalhando…
        {:else}
          Batalhar
        {/if}
      </button>
      <button type="button" class="btn-link" onclick={onClose}>Voltar ao jardim</button>
    </div>
  {:else if step === 'fight' && encounter && fightStart}
    <div class="scroll">
      <section class="panel sheet fight">
        <BattleLive
          start={fightStart}
          {encounter}
          team={fightTeam}
          {battleAuto}
          initialInputs={fightInputs}
          resumeElapsedMs={fightResumeMs}
          onBattleAuto={(on) => void setBattleAuto(on)}
          onFinished={onFightFinished}
          onError={onFightError}
        />
      </section>
    </div>
  {:else if step === 'decide' && encounter}
    <div class="scroll">
      <section class="panel sheet wild">
        {@render wild(encounter, 'dizzy')}
        {#if encounter.catchChance !== null}
          <p class="odds">Chance de captura {percent(encounter.catchChance)}</p>
        {/if}
      </section>
    </div>
    <div class="dock">
      <button
        type="button"
        class="btn btn-primary big"
        aria-busy={throwing}
        disabled={pending}
        onclick={() => void throwBall()}
      >
        {#if throwing}
          <span class="ball sprite-wait" aria-hidden="true"></span>Lançando…
        {:else}
          Lançar Poké Ball
        {/if}
      </button>
      <button type="button" class="btn big" disabled={pending} onclick={() => void leaveWild()}>Deixar ir</button>
      <button type="button" class="btn-link" onclick={onClose}>Voltar ao jardim</button>
    </div>
  {:else if step === 'throw' && encounter && lastThrow}
    <div class="scroll">
      <section class="panel sheet">
        {#key lastThrow.throwNumber}
          <BattleScene
            {encounter}
            throwResult={{ caught: lastThrow.caught, catchChance: lastThrow.catchChance }}
            {time}
            onDone={afterThrow}
          />
        {/key}
      </section>
    </div>
    <div class="dock">
      <button type="button" class="btn" onclick={afterThrow}>Pular cena</button>
    </div>
  {:else if step === 'highlights' && result?.kind === 'battle'}
    <div class="scroll">
      <section class="panel sheet">
        <h2>Resultado</h2>
        <Highlights cards={battleCards} onDone={afterHighlights} />
      </section>
    </div>
    <div class="dock">
      <button type="button" class="btn" onclick={afterHighlights}>Continuar</button>
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
          {:else if result.left}
            <p>Você venceu e deixou ele ir.</p>
          {:else if result.battle.won}
            <p>Você venceu, mas ele fugiu.</p>
          {:else}
            <p class="bad">Derrota. Seus Pokémon não se machucaram.</p>
          {/if}
          {#if result.battle.catchChance !== null}
            <p class="hint">Chance de captura {percent(result.battle.catchChance)}</p>
          {/if}
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

  .big {
    min-height: 64px;
    font-size: 1.15rem;
    touch-action: manipulation;
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

  .wild-card {
    display: grid;
    justify-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: center;
  }

  .wild-card.compact {
    grid-template-columns: 6rem 1fr;
    align-items: center;
    justify-items: start;
    gap: 0.75rem;
    text-align: left;
  }

  .info {
    display: grid;
    gap: 0.25rem;
  }

  .stage {
    position: relative;
    width: 100%;
    height: 10rem;
  }

  .compact .stage {
    height: 5.5rem;
  }

  .anchor {
    position: absolute;
    left: 50%;
    bottom: 0.75rem;
    width: 0;
    height: 0;
  }

  .compact .anchor {
    bottom: 0.4rem;
  }

  .fallback {
    position: absolute;
    left: -48px;
    bottom: 0;
    width: 96px;
    height: 96px;
    object-fit: contain;
  }

  .compact .fallback {
    left: -32px;
    width: 64px;
    height: 64px;
  }

  /* Tonto: balança em volta do ponto do chão (a âncora tem tamanho zero). */
  .anchor.dizzy {
    animation: dizzy-sway 1.8s ease-in-out infinite alternate;
  }

  /* Estrelas em órbita achatada: o scaleY do .halo vira a elipse. */
  .halo {
    position: absolute;
    left: 0;
    top: calc(var(--head) * -1);
    width: 0;
    height: 0;
    transform: scaleY(0.4);
  }

  .orbit {
    position: absolute;
    left: -5px;
    top: -5px;
    animation: orbit 1.2s linear infinite;
    animation-delay: calc(var(--i) * -0.4s);
  }

  .orbit svg {
    display: block;
    transform: scaleY(2.5);
  }

  .pick {
    font-size: 0.85rem;
    font-weight: 600;
    opacity: 0.75;
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }

  @keyframes dizzy-sway {
    from {
      transform: rotate(-4deg);
    }
    to {
      transform: rotate(4deg);
    }
  }

  @keyframes orbit {
    from {
      transform: rotate(0deg) translateX(22px) rotate(0deg);
    }
    to {
      transform: rotate(360deg) translateX(22px) rotate(-360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .anchor.dizzy,
    .orbit {
      animation: none;
    }
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

  .auto-pref {
    flex-direction: column;
    gap: 0.1rem;
    min-height: 52px;
  }

  .auto-pref strong {
    font-size: 0.9rem;
    white-space: nowrap;
  }

  .auto-pref small {
    font-weight: 600;
    opacity: 0.85;
  }

  .auto-pref.on {
    border-image-source: url('/ui/button-primary.png');
    color: #f3ffe8;
    text-shadow: 0 var(--px) 0 #3f7a2a;
  }

  /* Poké Ball quicando dentro do botão enquanto espera (sprite-wait, app.css). */
  .ball {
    display: inline-block;
    width: 28px;
    height: 28px;
    margin-right: 0.35rem;
    vertical-align: middle;
    background-size: 18px 18px;
  }

  .waiting {
    display: inline-flex;
    align-items: center;
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
