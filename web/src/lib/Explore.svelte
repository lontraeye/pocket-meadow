<script lang="ts">
  import Journey from './Journey.svelte'
  import { snapIconSize } from './pixelSnap.svelte'
  import { spriteLoading } from './spriteLoading'
  import { serverClock } from './serverClock.svelte'
  import { connection } from './connection.svelte'
  import { formatCountdown } from './time'
  import { onMount, untrack } from 'svelte'
  import {
    api,
    berryIconSrc,
    effectLabel,
    errorText,
    type ApiError,
    type BattleOutcome,
    type BattleStart,
    type CaptureBerryInfo,
    type GameState,
    type OwnedPokemon,
    type PendingEncounter,
    type RegionInfo,
    type ThrowOutcome,
    type ThrowQuality,
  } from './api'
  import { ballIconSrc, previewCatchChance } from './balls'
  import { percent } from './battle'
  import BattleLive from './BattleLive.svelte'
  import ThrowLab from './ThrowLab.svelte'
  import ThrowPad from './ThrowPad.svelte'
  import { agitationOffset, throwAimMult, type ThrowReading } from './throwPhysics'
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
  import { loadBattleFx } from './fx'
  import { gardenSprite, loadPmdBattle, pmdAnim, showdownSrc } from './sprites'
  import { simConfig, type BattleInput } from './sim'

  let {
    game,
    onClose,
    onState,
    onOpenPc,
  }: { game: GameState; onClose: () => void; onState: () => Promise<void>; onOpenPc: () => void } = $props()

  type Step = 'regions' | 'encounter' | 'fight' | 'decide' | 'highlights' | 'result' | 'practice'
  type Result =
    | { kind: 'fled' }
    | { kind: 'battle'; battle: BattleOutcome; team: OwnedPokemon[]; left?: boolean }

  let step = $state<Step>(
    untrack(() => (game.encounter?.wonAt ? 'decide' : game.encounter ? 'encounter' : 'regions')),
  )
  let encounter = $state<PendingEncounter | null>(untrack(() => game.encounter))
  let regions = $state<RegionInfo[]>([])
  /** O último /regions falhou por rede (tenta de novo quando a conexão voltar). */
  let regionsFailed = $state(false)
  /** Quem abre a luta (null = o primeiro do time). */
  let lead = $state<number | null>(null)
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
  let thrownBallSprite = $state('poke')
  let throwing = $state(false)
  /** Cena de hit/absorver/chão/chacoalhada na mesma tela da captura (não troca de step). */
  let captureAnim = $state(false)
  let notice = $state('')
  let appliedThrow = $state<number | null>(null)
  let battleAuto = $state(untrack(() => game.trainer.battleAuto))
  let prefsBusy = false
  const ballStorageKey = 'pocket-meadow-last-ball'
  let selectedBall = $state(
    untrack(() => {
      try {
        return localStorage.getItem(ballStorageKey) ?? 'poke'
      } catch {
        return 'poke'
      }
    }),
  )
  let selectedBerry = $state<string | null>(null)
  /** Berry já arremessada com sucesso; o slot volta a mostrar a bola. */
  let berryDelivered = $state(false)
  /** Painel aberto na captura: as bolas (equipar) ou a mochila (dar berry). */
  let capturePanel = $state<'balls' | 'bag' | null>(null)
  let capturePanelEl = $state<HTMLDivElement | null>(null)
  let wildStageEl = $state<HTMLElement | null>(null)
  /** Textos do efeito ao acertar a berry no selvagem. */
  let berryFloaters = $state<{ id: number; text: string; good: boolean }[]>([])
  let floaterSeq = 0
  let aimSpinning = $state(false)

  // O painel abre abaixo do card: em tela baixa ele nasceria fora da vista.
  $effect(() => {
    if (capturePanel && capturePanelEl) capturePanelEl.scrollIntoView({ block: 'nearest' })
  })

  function toggleCapturePanel(panel: 'balls' | 'bag') {
    play('tap')
    capturePanel = capturePanel === panel ? null : panel
  }

  /** Agitação depois da berry escolhida (o servidor aplica no lançamento). */
  function calmPreview(agitation: number, calm: number | 'all' | null | undefined): number {
    if (calm === 'all') return 0
    if (typeof calm === 'number') return Math.max(0, agitation - calm)
    return agitation
  }

  function multText(mult: number): string {
    return `×${String(mult).replace('.', ',')}`
  }

  /** Textos do efeito ao dar a berry: verde quando ajuda, vermelho quando não faz nada. */
  function berryEffectTexts(capture: CaptureBerryInfo, agitation: number): { text: string; good: boolean }[] {
    const texts: { text: string; good: boolean }[] = []
    if (capture.catchMult) texts.push({ text: `Chance ${multText(capture.catchMult)}`, good: true })
    if (capture.calm !== null) {
      const calmed = agitation - calmPreview(agitation, capture.calm)
      texts.push(calmed > 0 ? { text: calmed >= agitation ? 'Acalmou!' : `Acalmou −${calmed}`, good: true } : { text: 'Já está calmo', good: false })
    }
    if (capture.candyOnCatch) texts.push({ text: `+${capture.candyOnCatch} doces se capturar`, good: true })
    return texts
  }

  const clock = serverClock(() => game.now)

  const ownedBalls = $derived(
    game.balls.list
      .map((ball) => {
        const qty = game.inventory.find((row) => row.itemKey === ball.itemKey)?.quantity ?? 0
        return { ...ball, quantity: qty }
      })
      .filter((ball) => ball.quantity > 0),
  )
  const hasBalls = $derived(ownedBalls.length > 0)
  // Laboratório do arremesso (dev): treino sem gastar e leitura de cada lançamento.
  let throwPractice = $state(false)
  let throwReadings = $state.raw<ThrowReading[]>([])

  /** O que o palco do selvagem precisa para desenhar (encontro real ou treino). */
  type StageMon = Pick<PendingEncounter, 'speciesId' | 'isShiny' | 'displayName' | 'level' | 'regionName' | 'agitation'>

  // Treino livre de arremesso: um Pokémon de exemplo (sorteado entre as espécies
  // do jogador) e a Poké Ball básica. Não gasta nada, não captura, não chama o
  // servidor: é o modo treino do ThrowPad numa tela própria. Só o arremesso,
  // com o retorno de sempre (Nice!, Curto!...): sem laboratório nem estatística.
  let practiceMon = $state<StageMon | null>(null)
  let practiceAgitation = $state(0)
  const PRACTICE_AGITATION_MAX = 3

  function pickPracticeMon() {
    const pool = game.pokemon
    const others = pool.filter((mon) => mon.speciesId !== practiceMon?.speciesId)
    const from = others.length > 0 ? others : pool
    const pick = from[Math.floor(Math.random() * from.length)]
    if (!pick) return
    practiceMon = {
      speciesId: pick.speciesId,
      isShiny: false,
      displayName: pick.displayName,
      level: pick.level,
      regionName: 'Treino',
      agitation: 0,
    }
    const look = gardenSprite(pick.speciesId, false)
    if (look.kind === 'pmd') void loadPmdBattle(pick.speciesId, look.shinySheet)
  }

  function startPractice() {
    message = ''
    practiceAgitation = 0
    pickPracticeMon()
    if (practiceMon) step = 'practice'
  }

  const activeBall = $derived(
    ownedBalls.find((ball) => ball.key === selectedBall) ?? ownedBalls[0] ?? null,
  )
  const captureBerries = $derived(
    game.berries
      .filter((berry) => berry.capture)
      .map((berry) => {
        const quantity =
          game.inventory.find((row) => row.itemKey === `berry:${berry.key}`)?.quantity ?? 0
        return { ...berry, quantity, capture: berry.capture! }
      })
      .filter((berry) => berry.quantity > 0),
  )
  const activeCaptureBerry = $derived(
    selectedBerry ? captureBerries.find((berry) => berry.key === selectedBerry) ?? null : null,
  )
  const catchBerryBonus = $derived(
    (() => {
      const rows = game.effects.filter((e) => e.effectKey === 'catch_boost').sort((a, b) => a.id - b.id)
      const chosen = rows.find((row) => row.charges !== null) ?? rows[0]
      const bag = chosen?.multiplier ?? 1
      const thrown =
        berryDelivered && activeCaptureBerry ? (activeCaptureBerry.capture.catchMult ?? 1) : 1
      return bag * thrown
    })(),
  )
  const decideAgitation = $derived(
    berryDelivered
      ? calmPreview(encounter?.agitation ?? 0, activeCaptureBerry?.capture.calm)
      : (encounter?.agitation ?? 0),
  )

  function chanceForBall(ballKey: string, curve = aimSpinning): number {
    if (!encounter || encounter.wonAt == null) return 0
    const types = [encounter.type1, encounter.type2].filter((t): t is string => Boolean(t))
    const throwMult = throwAimMult(
      'normal',
      curve,
      game.balls.throwQualityMult,
      game.balls.throwCurveMult,
    )
    return previewCatchChance({
      captureRate: encounter.captureRate,
      catchMult: game.balls.catchMult,
      catchMin: game.balls.catchMin,
      ballKey,
      throwIndex: encounter.throwCount,
      wildLevel: encounter.level,
      types,
      berryBonus: catchBerryBonus,
      throwMult,
    })
  }

  /** Chance do anel: bola+berry, qualidade normal, sem curva. */
  const ringCatchChance = $derived(activeBall ? chanceForBall(activeBall.key, false) : 0)

  const throwMode = $derived(
    selectedBerry && !berryDelivered ? ('berry' as const) : ('ball' as const),
  )
  const throwSpriteSrc = $derived(
    throwMode === 'berry' && activeCaptureBerry
      ? berryIconSrc(activeCaptureBerry.key)
      : ballIconSrc(activeBall?.sprite ?? 'poke'),
  )
  const throwLabel = $derived(
    throwMode === 'berry' && activeCaptureBerry
      ? `Dar ${activeCaptureBerry.name}`
      : activeBall
        ? `Lançar · ×${activeBall.quantity}`
        : 'Sem pokébolas',
  )

  /** Escolhe a berry para o arremesso (efeito só quando acertar o gesto). */
  function pickCaptureBerry(key: string | null) {
    play('tap')
    selectedBerry = key
    berryDelivered = false
    berryFloaters = []
    capturePanel = null
  }

  function onBerryHit() {
    const berry = activeCaptureBerry
    if (!berry || !encounter) return
    berryDelivered = true
    const born = berryEffectTexts(berry.capture, encounter.agitation).map((row) => ({
      ...row,
      id: (floaterSeq += 1),
    }))
    berryFloaters = born
    window.setTimeout(() => {
      if (berryFloaters === born) berryFloaters = []
    }, 1200 + born.length * 350)
  }

  function onBerryMiss() {
    selectedBerry = null
    berryDelivered = false
    berryFloaters = []
  }

  function pickBall(key: string) {
    selectedBall = key
    // Equipar bola: se a berry ainda está no slot (não foi dada), sai.
    // Berry já dada continua para o próximo lançamento.
    if (!berryDelivered && selectedBerry) {
      selectedBerry = null
      berryFloaters = []
    }
    try {
      localStorage.setItem(ballStorageKey, key)
    } catch {
      // ignore
    }
  }

  $effect(() => {
    if (!hasBalls) return
    if (!ownedBalls.some((ball) => ball.key === selectedBall)) {
      selectedBall = ownedBalls[0]!.key
    }
  })

  $effect(() => {
    const server = game.trainer.battleAuto
    if (!prefsBusy) battleAuto = server
  })

  // Avisa o PWA: não recarregar no meio da luta ao vivo.
  $effect(() => {
    setLiveFight(step === 'fight')
    return () => setLiveFight(false)
  })

  /** Sem energia para um encontro (só quando a energia está ligada no servidor). */
  const noEnergy = $derived(game.trainer.energyEnabled && game.trainer.energy < 1)
  /** O time, na ordem das posições. Todos vão para a luta. */
  const roster = $derived(
    game.pokemon
      .filter((mon) => mon.teamSlot !== null && mon.location === 'garden')
      .sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0)),
  )
  const leadId = $derived(roster.some((mon) => mon.id === lead) ? lead : (roster[0]?.id ?? null))
  /** Quem abre primeiro; o resto segue a ordem do time. */
  const chosen = $derived([
    ...roster.filter((mon) => mon.id === leadId),
    ...roster.filter((mon) => mon.id !== leadId),
  ])

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
    if (captureAnim || step === 'fight' || step === 'highlights' || step === 'result' || step === 'practice') return
    encounter = found
    if (step !== 'decide') step = 'decide'
    const look = gardenSprite(found.speciesId, found.isShiny)
    if (look.kind === 'pmd') void loadPmdBattle(found.speciesId, look.shinySheet)
    void loadBattleFx()
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
    void loadBattleFx()
    step = 'fight'
  }

  async function setBattleAuto(on: boolean) {
    if (on === battleAuto) return
    const prev = battleAuto
    battleAuto = on
    message = ''
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
    const monAt = (id: number) =>
      teamSnapshot.find((entry) => entry.id === id) ?? game.pokemon.find((entry) => entry.id === id)
    return battleHighlightCards({
      battle,
      nameOf,
      canEvolve: (fighter) => {
        const mon = monAt(fighter.pokemonId)
        if (!mon) return false
        const before = fighter.level - fighter.levelsGained
        return mon.evolutions.some((option) => before < option.minLevel && fighter.level >= option.minLevel)
      },
      regions,
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
            balls: game.balls.list,
          })
        : []
    battleCards = mergeCaptureOutcome(battleCards, kind, bonus)
  }

  async function loadRegions() {
    let response: Response
    try {
      response = await api('/api/regions')
    } catch {
      regionsFailed = true
      return
    }
    if (!response.ok) {
      message = errorText(await readError(response))
      return
    }
    const body = (await response.json()) as { regions: RegionInfo[] }
    regions = body.regions
    regionsFailed = false
  }

  // O mapa não veio por falta de rede: busca de novo quando a conexão voltar.
  $effect(() => {
    if (regionsFailed && !connection.offline) void loadRegions()
  })

  async function search(slug: string, request = () => api('/api/encounters', { regionSlug: slug })) {
    play('tap')
    pending = true
    searching = slug
    message = ''
    notice = ''
    try {
      const response = await request()
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
      lead = null
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

  // Só em teste: encontro com espécie (nome ou nº) e nível escolhidos.
  let devSpecies = $state('')
  let devLevel = $state(20)

  function devEncounter() {
    const species = devSpecies.trim()
    if (!species) return
    void search('dev', () => api('/api/dev/encounter', { species, level: devLevel }))
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

  function pickLead(id: number) {
    play('tap')
    lead = id
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

  async function throwBall(quality: ThrowQuality, curve: boolean) {
    if (!encounter || !activeBall) return
    pending = true
    throwing = true
    message = ''
    notice = ''
    const ballKey = activeBall.key
    const berryKey = selectedBerry
    try {
      const response = await api(`/api/encounters/${encounter.id}/throw`, {
        ball: ballKey,
        quality,
        curve,
        ...(berryKey ? { berry: berryKey } : {}),
      })
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
      thrownBallSprite = activeBall?.sprite ?? game.balls.list.find((b) => b.key === ballKey)?.sprite ?? 'poke'
      selectedBerry = null
      berryDelivered = false
      capturePanel = null
      aimSpinning = false
      encounter = {
        ...encounter,
        catchChance: outcome.catchChance,
        throwCount: outcome.throwNumber,
        agitation: outcome.agitation,
      }
      if (prefersReducedMotion()) afterThrow()
      else captureAnim = true
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
      throwing = false
    }
  }

  async function missBallThrow() {
    if (!encounter || !activeBall) return
    pending = true
    throwing = true
    message = ''
    const ballKey = activeBall.key
    try {
      const response = await api(`/api/encounters/${encounter.id}/miss`, { ball: ballKey })
      if (!response.ok) {
        message = errorText(await readError(response))
        if (response.status === 404) {
          encounter = null
          step = 'regions'
        }
      }
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
      throwing = false
    }
  }

  async function grantBalls() {
    pending = true
    message = ''
    try {
      const response = await api('/api/dev/balls', {})
      if (!response.ok) message = errorText(await readError(response))
      await onState()
    } catch {
      message = 'Sem conexão com o servidor.'
    } finally {
      pending = false
    }
  }

  function afterThrow() {
    const outcome = lastThrow
    captureAnim = false
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

  async function flee(): Promise<boolean> {
    if (!encounter) return false
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
        return false
      }
      clearSavedBattle(encounter.id)
      fightStart = null
      result = { kind: 'fled' }
      step = 'result'
      void onState().catch(() => undefined)
      return true
    } catch {
      message = 'Sem conexão com o servidor.'
      return false
    } finally {
      pending = false
    }
  }

  function nameOf(id: number): string {
    const mon = game.pokemon.find((entry) => entry.id === id)
    return mon ? (mon.nickname ?? mon.displayName) : 'Pokémon'
  }

  async function readError(response: Response): Promise<ApiError> {
    return (await response.json().catch(() => ({ error: 'internal' }))) as ApiError
  }
</script>

<!--
  `compact`: sprite menor ao lado do nome, para sobrar tela para o time.
  `dizzy`: derrotado esperando a captura; balança tonto, com estrelas girando
  em cima da cabeça (a altura vem do ponto do chão no quadro da folha). Agitado,
  anda com o `agitationOffset` (throwPhysics.ts), o mesmo que o ThrowPad usa no
  acerto: o alvo que se vê é o alvo testado.
-->
{#snippet wild(mon: StageMon, variant: 'full' | 'compact' | 'dizzy' = 'full')}
  {@const look = gardenSprite(mon.speciesId, mon.isShiny)}
  {@const sheet = look.kind === 'pmd' ? pmdAnim(mon.speciesId, look.shinySheet, 'Idle') : null}
  {@const scale = variant === 'compact' ? 2 : 3}
  {@const head = sheet ? Math.round((sheet.ground[1] ?? sheet.h) * scale * 0.85) : 84}
  {@const unrest = Math.min(6, Math.max(0, mon.agitation))}
  {@const sway = variant === 'dizzy' && unrest > 0 ? agitationOffset(mon.agitation, time) : null}
  <div class="wild-card" class:compact={variant === 'compact'}>
    <!-- Na captura o palco tem a altura do sprite (+ estrelas): sem vazio acima da cabeça. -->
    <div
      class="stage"
      style:height={variant === 'dizzy' ? `${Math.min(160, Math.max(72, head + 36))}px` : undefined}
      bind:this={wildStageEl}
    >
      {#if variant === 'dizzy'}
        {#each berryFloaters as floater, i (floater.id)}
          <span class="berry-float" class:bad={!floater.good} style:--head="{head}px" style:--i={i} aria-hidden="true">
            {floater.text}
          </span>
        {/each}
      {/if}
      <div
        class="anchor"
        class:dizzy={variant === 'dizzy'}
        style:translate={sway ? `${sway.x}px ${sway.y}px` : undefined}
      >
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
      {#if variant === 'dizzy' && unrest > 0}
        <div class="agitation" aria-label="Inquieto" title="Inquieto">
          {#each Array(unrest) as _, i (i)}
            <span class="pip" aria-hidden="true"></span>
          {/each}
        </div>
      {/if}
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
    <Journey
      busy={pending}
      {searching}
      hasEncounter={game.encounter !== null}
      onEngage={(slug, slot) => search(slug, () => api(`/api/field/${slot}/engage`, {}))}
      onGarden={onClose}
      {onOpenPc}
    >
      {#snippet extras()}
        <section class="panel sheet">
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
            {#if game.trainer.energyEnabled}
              <button type="button" class="btn choice" disabled={pending} onclick={refillEnergy}>Encher energia (teste)</button>
            {/if}
            <button type="button" class="btn choice" disabled={pending} onclick={() => void grantBalls()}>
              Ganhar bolas (teste)
            </button>
            <form
              class="dev-encounter"
              onsubmit={(event) => {
                event.preventDefault()
                devEncounter()
              }}
            >
              <input
                type="text"
                placeholder="Espécie (nome ou nº)"
                aria-label="Espécie do encontro de teste"
                bind:value={devSpecies}
                autocomplete="off"
              />
              <input type="number" min="1" max="100" aria-label="Nível" bind:value={devLevel} />
              <button
                type="submit"
                class="btn"
                aria-busy={searching === 'dev'}
                disabled={pending || !devSpecies.trim() || noEnergy || game.encounter !== null}
              >
                Encontro de teste
              </button>
            </form>
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
          {:else}
            <button type="button" class="btn choice" disabled={pending} onclick={startPractice}>
              Treinar arremesso
              <small>{game.trainer.energyEnabled ? 'Não gasta bola nem energia' : 'Não gasta bola'}</small>
            </button>
          {/if}
        </section>
      {/snippet}
    </Journey>
  {:else if step === 'encounter' && encounter}
    <div class="scroll">
      <section class="panel sheet">
        {@render wild(encounter, 'compact')}
      </section>
      <section class="panel sheet">
        <h2>Time {roster.length}/{game.trainer.teamMax} <small class="pick">toque em quem abre</small></h2>
        {#if roster.length === 0}
          <p class="hint">Seu time está vazio. Monte o time na Coleção.</p>
        {:else}
          <div class="roster">
            {#each roster as mon (mon.id)}
              {@const on = mon.id === leadId}
              <button
                type="button"
                class="member"
                class:on
                aria-pressed={on}
                disabled={pending}
                onclick={() => pickLead(mon.id)}
              >
                <span>{mon.nickname ?? mon.displayName}{#if mon.isShiny} ★{/if}</span>
                <small>{#if on}<strong class="lead-tag">Abre</strong> · {/if}Nv {mon.level}</small>
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
          progression={game.progression}
          berries={game.berries}
          balls={game.balls.list}
          {battleAuto}
          initialInputs={fightInputs}
          resumeElapsedMs={fightResumeMs}
          onBattleAuto={(on) => void setBattleAuto(on)}
          onFinished={onFightFinished}
          onError={onFightError}
          onFlee={flee}
        />
      </section>
    </div>
  {:else if step === 'decide' && encounter && captureAnim && lastThrow}
    <!-- Continua na mesma tela: hit → absorver → chão → chacoalhada (skipThrow). -->
    <div class="scroll">
      <section class="panel sheet capture-scene">
        {#key lastThrow.throwNumber}
          <BattleScene
            {encounter}
            throwResult={{
              caught: lastThrow.caught,
              catchChance: lastThrow.catchChance,
              shakes: lastThrow.shakes,
            }}
            ballSrc={ballIconSrc(thrownBallSprite)}
            skipThrow
            {time}
            onDone={afterThrow}
          />
        {/key}
      </section>
    </div>
    <div class="dock">
      <button type="button" class="btn" onclick={afterThrow}>Pular cena</button>
    </div>
  {:else if step === 'decide' && encounter}
    <div class="scroll">
      <section class="panel sheet wild">
        {@render wild({ ...encounter, agitation: decideAgitation }, 'dizzy')}
        {#if activeBall}
          <p class="odds">Chance com {activeBall.displayName}: {percent(chanceForBall(activeBall.key))}</p>
        {:else}
          <p class="hint">Sem pokébolas.</p>
        {/if}
        {#if berryDelivered && activeCaptureBerry}
          <p class="hint berry-on">
            Com {activeCaptureBerry.name}: {activeCaptureBerry.capture.description}
          </p>
        {:else if throwMode === 'berry' && activeCaptureBerry}
          <p class="hint">Arremesse a {activeCaptureBerry.name} no selvagem.</p>
        {/if}
        {#if capturePanel === 'balls'}
          <div class="ball-row" role="listbox" aria-label="Pokébolas" bind:this={capturePanelEl}>
            {#each ownedBalls as ball (ball.key)}
              <button
                type="button"
                class="ball-pick"
                class:on={activeBall?.key === ball.key}
                role="option"
                aria-selected={activeBall?.key === ball.key}
                aria-label={`${ball.displayName}, ${ball.quantity}, ${percent(chanceForBall(ball.key))}`}
                title={ball.displayName}
                disabled={pending}
                onclick={() => {
                  pickBall(ball.key)
                  capturePanel = null
                }}
              >
                <img src={ballIconSrc(ball.sprite)} alt="" width="28" height="28" />
                <strong>×{ball.quantity}</strong>
                <small>{percent(chanceForBall(ball.key))}</small>
              </button>
            {/each}
          </div>
        {:else if capturePanel === 'bag'}
          <div class="berry-picker" role="listbox" aria-label="Mochila: berries para a captura" bind:this={capturePanelEl}>
            {#if captureBerries.length === 0}
              <p class="hint bag-empty">Nenhuma berry para usar na captura.</p>
            {:else}
              <button
                type="button"
                class="ball-pick"
                class:on={selectedBerry === null}
                role="option"
                aria-selected={selectedBerry === null}
                aria-label="Nenhuma berry"
                title="Nenhuma"
                disabled={pending}
                onclick={() => pickCaptureBerry(null)}
              >
                <span class="none-mark" aria-hidden="true">✕</span>
              </button>
              {#each captureBerries as berry (berry.key)}
                <button
                  type="button"
                  class="ball-pick"
                  class:on={selectedBerry === berry.key}
                  role="option"
                  aria-selected={selectedBerry === berry.key}
                  aria-label={`${berry.name}, ${berry.quantity}: ${berry.capture.description}`}
                  title={`${berry.name}: ${berry.capture.description}`}
                  disabled={pending}
                  onclick={() => pickCaptureBerry(berry.key)}
                >
                  <img src={berryIconSrc(berry.key)} alt="" width="28" height="28" />
                  <strong>×{berry.quantity}</strong>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </section>
      {#if game.devTools}
        <ThrowLab bind:practice={throwPractice} readings={throwReadings} />
      {/if}
    </div>
    <div class="dock">
      <!-- Mochila · bola equipada (lança) · bolas (equipar). -->
      <div class="throw-row">
        <button
          type="button"
          class="tool"
          class:on={capturePanel === 'bag' || activeCaptureBerry !== null}
          aria-expanded={capturePanel === 'bag'}
          disabled={pending}
          onclick={() => toggleCapturePanel('bag')}
        >
          <span class="icon-slot">
            {#if activeCaptureBerry}
              <img src={berryIconSrc(activeCaptureBerry.key)} alt="" width="28" height="28" />
            {:else}
              <svg class="bag-icon" viewBox="0 0 12 12" width={snapIconSize(24)} height={snapIconSize(24)} aria-hidden="true" shape-rendering="crispEdges">
                <path d="M4 1h4v1h1v2h2v7H1V4h2V2h1zm0 1v2h4V2zM2 5v5h8V5zm2 1h4v1H4z" />
              </svg>
            {/if}
          </span>
          <small>Mochila</small>
        </button>
        <ThrowPad
          mode={throwMode}
          spriteSrc={throwSpriteSrc}
          label={throwLabel}
          disabled={pending ||
            (!throwPractice && throwMode === 'ball' && !hasBalls) ||
            (throwMode === 'berry' && !activeCaptureBerry)}
          practice={throwPractice}
          onReading={(reading) => (throwReadings = [reading, ...throwReadings].slice(0, 30))}
          busy={throwing}
          agitation={decideAgitation}
          catchChance={ringCatchChance}
          stageEl={wildStageEl}
          onBallHit={(quality, curve) => {
            aimSpinning = false
            void throwBall(quality, curve)
          }}
          onBallMiss={() => {
            aimSpinning = false
            void missBallThrow()
          }}
          onBerryHit={onBerryHit}
          onBerryMiss={onBerryMiss}
          onSpinChange={(on) => (aimSpinning = on)}
        />
        <button
          type="button"
          class="tool"
          class:on={capturePanel === 'balls'}
          aria-expanded={capturePanel === 'balls'}
          disabled={pending || !hasBalls}
          onclick={() => toggleCapturePanel('balls')}
        >
          <span class="icon-slot">
            <span class="ball-stack" aria-hidden="true">
              <img src={ballIconSrc('great')} alt="" width="24" height="24" />
              <img src={ballIconSrc('ultra')} alt="" width="24" height="24" />
            </span>
          </span>
          <small>Bolas</small>
        </button>
      </div>
      <!-- Sair da captura é deixar ir: não fica encontro esperando no jardim. -->
      <button type="button" class="btn" disabled={pending} onclick={() => void leaveWild()}>Deixar ir</button>
    </div>
  {:else if step === 'practice' && practiceMon}
    <!-- Mesmo layout da captura (palco, uma linha, três botões e um embaixo):
         cabe onde a captura cabe. Nada abre ou fecha. A física não se mexe
         aqui: o laboratório de dev fica só na captura. -->
    <div class="scroll">
      <section class="panel sheet wild">
        {@render wild({ ...practiceMon, agitation: practiceAgitation }, 'dizzy')}
        <p class="hint">Treino: não gasta bola nem captura.</p>
      </section>
    </div>
    <div class="dock">
      <!-- Outro Pokémon · bola (lança) · agitação do alvo. -->
      <div class="throw-row">
        <button type="button" class="tool" aria-label="Outro Pokémon" onclick={pickPracticeMon}>
          <span class="icon-slot">
            <!-- Duas setas em roda (trocar), em pixels. -->
            <svg class="bag-icon" viewBox="0 0 12 12" width={snapIconSize(24)} height={snapIconSize(24)} aria-hidden="true" shape-rendering="crispEdges">
              <path d="M3 2h6v1h1v3H9V4H8V3H3zM1 6h1v2h1v1h6v1H3V9H2V8H1zM2 5h3v1H2zM7 6h3v1H7z" />
            </svg>
          </span>
          <small>Outro</small>
        </button>
        <ThrowPad
          mode="ball"
          spriteSrc={ballIconSrc('poke')}
          label="Lançar"
          practice
          agitation={practiceAgitation}
          catchChance={1}
          stageEl={wildStageEl}
          onBallHit={() => undefined}
          onBallMiss={() => undefined}
          onBerryHit={() => undefined}
          onBerryMiss={() => undefined}
        />
        <button
          type="button"
          class="tool"
          class:on={practiceAgitation > 0}
          aria-label={practiceAgitation === 0 ? 'Alvo parado' : `Alvo inquieto, nível ${practiceAgitation}`}
          onclick={() => (practiceAgitation = (practiceAgitation + 1) % (PRACTICE_AGITATION_MAX + 1))}
        >
          <span class="icon-slot agitation-icon" aria-hidden="true">
            {#each Array(PRACTICE_AGITATION_MAX) as _, i (i)}
              <span class="pip" class:lit={i < practiceAgitation}></span>
            {/each}
          </span>
          <small>{practiceAgitation === 0 ? 'Parado' : 'Inquieto'}</small>
        </button>
      </div>
      <button type="button" class="btn" onclick={() => (step = 'regions')}>Voltar</button>
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
          <p>O encontro acabou.{game.trainer.energyEnabled ? ' A energia não volta.' : ''}</p>
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
    padding-right: 10px;
    scrollbar-gutter: stable;
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

  /* 5 por linha: as 10 bolas cabem em duas, e o nome fica na linha da chance
     e no botão de lançar (os cartões só têm ícone, quantidade e chance). */
  .ball-row,
  .berry-picker {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.3rem;
    width: 100%;
    margin-top: 0.5rem;
  }

  /* Treino: os três pontinhos da agitação no lugar do ícone, lado a lado.
     `.tool` na frente: senão o `.tool .icon-slot` (grid) ganha e eles empilham. */
  .tool .icon-slot.agitation-icon {
    display: flex;
    gap: 3px;
    align-items: center;
    justify-content: center;
  }

  .agitation-icon .pip {
    flex: none;
    width: 6px;
    height: 14px;
    background: #00000022;
    box-shadow: inset 0 0 0 var(--px) #00000033;
  }

  .agitation-icon .pip.lit {
    background: var(--danger);
  }

  /* Captura: laterais menores, meio maior — quadrados, base alinhada. */
  .throw-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: end;
    justify-items: center;
    gap: 0.45rem;
  }

  .tool {
    box-sizing: border-box;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 0.12rem;
    width: 4.5rem;
    height: 4.5rem;
    min-width: 4.5rem;
    max-width: 4.5rem;
    min-height: 4.5rem;
    max-height: 4.5rem;
    padding: 0.2rem 0.15rem;
    border: 2px solid var(--panel-edge);
    background: var(--panel-face);
    box-shadow: inset 0 -2px 0 var(--panel-shade);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }

  .tool .icon-slot {
    display: grid;
    place-items: center;
    width: 34px;
    height: 28px;
  }

  .tool small {
    overflow: hidden;
    max-width: 100%;
    font-size: 0.68rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool.on {
    border-color: var(--selected);
    background: var(--selected-face);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -2px 0 var(--selected);
  }

  .tool:disabled {
    filter: grayscale(1) opacity(0.6);
    cursor: default;
  }

  .tool img {
    image-rendering: pixelated;
  }

  .bag-icon {
    fill: currentColor;
  }

  .ball-stack {
    position: relative;
    display: block;
    width: 34px;
    height: 28px;
  }

  .ball-stack img {
    position: absolute;
    top: 0;
  }

  .ball-stack img:first-child {
    left: 0;
  }

  .ball-stack img:last-child {
    left: 10px;
    top: 4px;
  }

  .bag-empty {
    grid-column: 1 / -1;
    margin: 0;
    text-align: center;
  }

  .berry-float {
    position: absolute;
    left: 50%;
    bottom: calc(0.75rem + var(--head) * 0.75);
    z-index: 3;
    font-size: 1rem;
    font-weight: 700;
    white-space: nowrap;
    color: #6ecf5a;
    text-shadow:
      0 var(--px) 0 var(--ink),
      0 calc(var(--px) * -1) 0 var(--ink),
      var(--px) 0 0 var(--ink),
      calc(var(--px) * -1) 0 0 var(--ink);
    transform: translate(-50%, 0);
    pointer-events: none;
    animation: berry-float-fade 0.9s ease-out both;
    animation-delay: calc(0.25s + var(--i) * 0.35s);
  }

  .berry-float.bad {
    color: #e05a4a;
  }

  @keyframes berry-float-fade {
    0%,
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .berry-float {
      animation-name: berry-float-rise;
    }
  }

  @keyframes berry-float-rise {
    0% {
      transform: translate(-50%, 0.4rem);
      opacity: 0;
    }
    15% {
      transform: translate(-50%, 0);
      opacity: 1;
    }
    70% {
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -1.6rem);
      opacity: 0;
    }
  }

  .none-mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    font-size: 1rem;
  }

  .ball-pick {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
    box-sizing: border-box;
    min-height: 44px;
    margin: 0;
    padding: 0.35rem 0.25rem;
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 2px 0 var(--inlay-shade);
    color: var(--ink);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1.15;
    cursor: pointer;
    touch-action: manipulation;
  }

  .ball-pick.on {
    border-color: var(--selected);
    background: var(--selected-face);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -2px 0 var(--selected);
  }

  .ball-pick img {
    image-rendering: pixelated;
  }

  .ball-pick small {
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
  }


  .berry-on {
    margin: 0;
    color: var(--grass-side);
    font-weight: 700;
  }

  .agitation {
    display: flex;
    justify-content: center;
    gap: 0.2rem;
    margin-top: 0.2rem;
  }

  .agitation .pip {
    width: 0.55rem;
    height: 0.55rem;
    border: 2px solid var(--danger);
    background: color-mix(in srgb, var(--danger) 55%, transparent);
    transform: rotate(45deg);
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

  /* Só em teste: a espécie numa linha; o nível e o botão embaixo. */
  .dev-encounter {
    display: grid;
    grid-template-columns: 5rem 1fr;
    gap: 0.35rem;
    margin: 0;
  }

  .dev-encounter input[type='text'] {
    grid-column: 1 / -1;
  }

  .dev-encounter input {
    min-width: 0;
    min-height: 44px;
    padding: 0 0.5rem;
    border: var(--px) solid var(--panel-edge);
    background: var(--panel-face);
    color: var(--ink);
    font: inherit;
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
    color: #ffffffcc;
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
    border: 2px solid var(--panel-edge);
    background: var(--inlay-face);
    box-shadow: inset 0 2px 0 var(--inlay-shade);
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
  }

  .lead-tag {
    color: var(--selected);
  }

  .member.on {
    border-color: var(--selected);
    background: var(--selected-face);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -2px 0 var(--selected);
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
    background: var(--primary);
    color: #fff;
    text-shadow: 0 var(--px) 0 var(--primary-shade);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -3px 0 var(--primary-shade);
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
