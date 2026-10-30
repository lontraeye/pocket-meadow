<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import {
    api,
    type BattleOutcome,
    type BattleStart,
    type OwnedPokemon,
    itemLabel,
    type BallInfo,
    type BerryInfo,
    type PendingEncounter,
    type ProgressionRules,
  } from './api'
  import { clearSavedBattle, loadBattleSpeed, saveBattleProgress, saveBattleSpeed } from './battlePersist'
  import {
    FX_FLYING_RATE,
    FX_FRAME_SIZE,
    FX_MAX_ON_SCREEN,
    FX_SCALE_CHARGED,
    FX_SCALE_FAST,
    FX_SCALE_STATUS,
    FX_STATUS_PULSE_MS,
    fxContactMs,
    fxForMove,
    fxHitFrameCap,
    fxMeta,
    loadBattleFx,
    type FxId,
  } from './fx'
  import FxSprite from './FxSprite.svelte'
  import { prefersReducedMotion } from './highlights'
  import PmdSprite from './PmdSprite.svelte'
  import {
    autoReactionSeed,
    chargedEnergyCost,
    moveCooldownMs,
    mulberry32,
    runBattle,
    simConfig,
    type BattleEvent,
    type BattleInput,
    type BattleResult,
    type BattleSnapshotSide,
    type SimFighter,
  } from './sim'
  import { play } from './sound'
  import {
    battleAnimChoice,
    gardenSprite,
    groundAt,
    loadPmd,
    pmdAnim,
    pmdBody,
    pmdHasAnim,
    preloadPmd,
    showdownSrc,
    type PmdAnimName,
    type SpriteBody,
  } from './sprites'
  import { formatCountdown } from './time'
  import { snapPixelScale } from './pixelSnap.svelte'
  import TypeIcon from './TypeIcon.svelte'
  import { TYPE_COLORS, typeColor, typeInk } from './typeStyle'
  import { xpToNext } from './progression'

  // Luta ao vivo (8.3). A tela re-simula `runBattle({ untilMs })` com os inputs
  // do jogador, mas só quando algo pode ter mudado: um toque (input novo) ou o
  // próximo instante em que o selvagem pode agir. Entre dois eventos o
  // snapshot continua valendo (HP e energia só mudam em eventos); o
  // requestAnimationFrame cuida só do relógio da interface (cooldowns, anims).

  // Juice visual (parte 1 + 2): só transform/opacity/background-position;
  // não atrasa a simulação.
  const HIT_FLASH_MS = 120
  const SHAKE_FAST_MS = 150
  const SHAKE_CHARGED_MS = 220
  const SHAKE_PX_FAST = 2
  const SHAKE_PX_CHARGED = 4
  const CHARGED_BANNER_MS = 550
  const FAINT_SLOW_MS = 1100
  const FAINT_LINGER_MS = 900
  // Pós-vitória: a barra azul enche antes de sair da luta.
  const XP_FILL_MS = 850
  const XP_LEVEL_PAUSE_MS = 420
  // Troca: volta pra pokébola e o próximo aparece.
  const SWITCH_OUT_MS = 280
  const SWITCH_IN_MS = 320
  const HP_TRAIL_HOLD_MS = 90
  const HP_TRAIL_MS = 280
  const FLOAT_MS = 1000
  /** Golpe que não afeta: o aviso aparece quando o golpe chegaria. */
  const IMMUNE_NOTE_DELAY_MS = 280
  // Voo da bola dos golpes especiais (o impacto espera ela chegar).
  const PROJ_FAST_MS = 260
  const PROJ_CHARGED_MS = 380
  const PROJ_TRAIL_MS = 35
  // Choque da paralisia: quanto dura cada pulso (3 piscadas).
  const ZAP_MS = 360
  // Evento mais velho que isso (em ms de luta) aparece sem efeito: a tela só
  // estava atrasada (aba em segundo plano), não vale repetir a rajada toda.
  const FX_STALE_MS = 700
  // Pivot do efeito (y no quadro de 96) a partir do qual ele é "de chão".
  const FX_GROUND_PIVOT_MIN = 54
  // Raiozinho em pixel art 5×8 (X = aceso).
  const BOLT_PIXELS = ['..XXX', '.XXX.', '.XX..', 'XXXX.', '..XX.', '.XX..', '.X...', 'X....'].flatMap(
    (line, y) => [...line].flatMap((cell, x) => (cell === 'X' ? [{ x, y }] : [])),
  )
  // Bola em pixel art 8×8: d = contorno escuro, m = cor do tipo, l = clara,
  // w = brilho branco. As cores saem de --c (TYPE_GLOW) no CSS.
  const ORB_PIXELS = [
    '..dddd..',
    '.dmmmmd.',
    'dmmllmmd',
    'dmlwwlmd',
    'dmlwwlmd',
    'dmmllmmd',
    '.dmmmmd.',
    '..dddd..',
  ].flatMap((line, y) =>
    [...line].flatMap((tone, x) => (tone === '.' ? [] : [{ x, y, tone }])),
  )

  const TYPE_GLOW = TYPE_COLORS

  let {
    start,
    encounter,
    team,
    progression,
    berries,
    balls,
    battleAuto = false,
    initialInputs = [],
    resumeElapsedMs = 0,
    onBattleAuto,
    onFinished,
    onError,
    onFlee,
  }: {
    start: BattleStart
    encounter: PendingEncounter
    /** Pokémon do time (para nome, apelido e shiny); a ordem não importa. */
    team: OwnedPokemon[]
    /** Regras de XP (enchimento pós-vitória e teto de nível). */
    progression: ProgressionRules
    /** Nomes das sementes/itens no painel pós-luta. */
    berries: BerryInfo[]
    balls: BallInfo[]
    /** Preferência do treinador (servidor); a tela só espelha e pede troca. */
    battleAuto?: boolean
    initialInputs?: BattleInput[]
    /** Tempo de relógio que já passou ao retomar uma luta interrompida. */
    resumeElapsedMs?: number
    onBattleAuto: (on: boolean) => void
    onFinished: (outcome: BattleOutcome, team: OwnedPokemon[]) => void
    onError: (message: string) => void
    /** Encerra o encontro no meio da luta. Devolve false se o servidor recusou. */
    onFlee: () => Promise<boolean>
  } = $props()

  type Pose = { id: number; start: number; steps: Step[] }
  type Step = { anim: PmdAnimName | null; css: 'lunge' | 'hurt' | 'faint' | null; ms: number }
  type FloaterTone = 'hit' | 'burn' | 'poison' | 'recoil' | 'confusion' | 'heal'
  type Floater = {
    id: number
    side: 'player' | 'wild'
    text: string
    heal: boolean
    born: number
    charged?: boolean
    effectiveness?: number
    note?: string
    tone?: FloaterTone
  }
  type ChargedFx = { name: string; color: string; side: 'player' | 'wild'; until: number }
  type LiveFx = {
    key: string
    uid: number
    fxId: FxId
    side: 'player' | 'wild'
    place: 'body' | 'head' | 'attacker'
    scale: 1 | 2
    loop: boolean
    sticky: boolean
    rate: number
    maxFrames: number | null
    born: number
  }
  type PendingHit = {
    at: number
    side: 'player' | 'wild'
    damage: number
    effectiveness: number
    charged: boolean
    critical: boolean
  }
  /** Efeito de impacto que só aparece quando o projétil chega. */
  type PendingFx = {
    at: number
    side: 'player' | 'wild'
    fxId: FxId
    scale: 1 | 2
    rate: number
    maxFrames: number | null
  }
  /** Bola na cor do tipo, do atacante até o alvo (golpes especiais). */
  type Projectile = {
    uid: number
    from: { x: number; y: number }
    to: { x: number; y: number }
    ms: number
    color: string
    big: boolean
  }
  type Status = 'live' | 'finishing' | 'celebrating' | 'offline'
  type XpHud = {
    level: number
    xp: number
    need: number | null
  }
  /** Segura o sprite antigo no recall; depois some e o novo faz send-out. */
  type SwitchFx = {
    phase: 'out' | 'in'
    holdSpeciesId: number
    holdShiny: boolean
    token: number
  }
  type RecapStep =
    | { kind: 'text'; line: string }
    | {
        kind: 'xp'
        line: string
        pokemonId: number
        xpGained: number
        endLevel: number
        endXp: number
        levelsGained: number
        /** Só anima a barra se for o que está em campo. */
        animate: boolean
      }
    | { kind: 'level'; line: string }

  const { setup, seed, timeLimit, encounterId } = untrack(() => ({
    setup: start.setup,
    seed: start.seed,
    timeLimit: start.timeLimitMs,
    encounterId: encounter.id,
  }))
  const reduced = prefersReducedMotion()

  // Relógio da luta: tempo da simulação = base + tempo real desde a última
  // troca de velocidade × velocidade (botão 2x; o servidor aceita até maxSpeed).
  let speed = $state<1 | 2>(loadBattleSpeed())
  let simBase = untrack(() => resumeElapsedMs)
  let wallBase = performance.now()
  const startedWall = Date.now() - untrack(() => resumeElapsedMs)
  let inputs: BattleInput[] = untrack(() => [...initialInputs])

  let status = $state<Status>('live')
  let fleeing = $state(false)
  let alive = true
  let clock = $state(performance.now())
  let floaters = $state.raw<Floater[]>([])
  let liveFx = $state.raw<LiveFx[]>([])
  let allyPose = $state.raw<Pose | null>(null)
  let wildPose = $state.raw<Pose | null>(null)
  /** Durante o brinde de XP, sobrescreve a barra azul do plate. */
  let xpOverride = $state.raw<XpHud | null>(null)
  let recapLine = $state('')
  let recapHint = $state(false)
  let recapBusy = $state(false)
  let recapAdvance: (() => void) | null = null
  let switchFx = $state.raw<SwitchFx | null>(null)
  let switchToken = 0
  let switchTimers: number[] = []
  /** Lista de troca: um botão abre; some e mostra os candidatos. */
  let partyOpen = $state(false)
  // Instante (ms de luta) do último golpe/entrada do jogador: base da barra de espera.
  let cdFrom = $state(0)
  let shakeToken = $state(0)
  let shakeHard = $state(false)
  let flashSide = $state<'player' | 'wild' | null>(null)
  let chargedFx = $state.raw<ChargedFx | null>(null)
  let endingFaint = $state(false)
  let wildTrail = $state(100)
  let allyTrail = $state(100)
  let allyTrailSlot = -1

  let seen = 0
  let primed = false
  let nextEventAt = 0
  let poseId = 0
  let floaterId = 0
  let fxUid = 0
  let pendingHits: PendingHit[] = []
  let pendingFx: PendingFx[] = []
  let projectiles = $state.raw<Projectile[]>([])
  let arenaEl = $state<HTMLDivElement | null>(null)
  let wildSlotEl = $state<HTMLDivElement | null>(null)
  let allySlotEl = $state<HTMLDivElement | null>(null)
  let lastBurnPulse = { player: 0, wild: 0 }
  let lastParaPulse = { player: 0, wild: 0 }
  let zapUntil = $state({ player: 0, wild: 0 })
  let autoAt: number | null = null
  let autoFor = -1
  let frame = 0
  let flashClear = 0
  // Mesma sequência da simulação: mulberry32(autoReactionSeed(seed)).
  let autoRoll = mulberry32(autoReactionSeed(seed))
  function nextAutoDelay(): number {
    const span = simConfig.autoReactionMaxMs - simConfig.autoReactionMinMs + 1
    return simConfig.autoReactionMinMs + Math.floor(autoRoll() * span)
  }

  function elapsedAt(now: number): number {
    return Math.min(timeLimit, Math.max(0, Math.floor(simBase + (now - wallBase) * speed)))
  }

  function simulate(untilMs: number): BattleResult {
    return runBattle({ setup, seed, inputs, untilMs })
  }

  let sim = $state.raw<BattleResult>(
    (() => {
      const until = elapsedAt(performance.now())
      try {
        return simulate(until)
      } catch {
        // Save corrompido: recomeça sem os toques guardados.
        inputs = []
        return simulate(until)
      }
    })(),
  )

  const elapsed = $derived(elapsedAt(clock))
  const snap = $derived(sim.snapshot)
  // No desmaio (win/lose/timeout) o timer congela na duração da luta — não segue
  // durante o linger/recap (senão o relógio de parede podia marcar abandon).
  const displayElapsed = $derived(
    snap.result !== null || status !== 'live' ? Math.min(timeLimit, sim.durationMs) : elapsed,
  )
  const active = $derived(snap.team[snap.activeSlot] ?? snap.team[0]!)
  const activeFighter = $derived(setup.team[snap.activeSlot] ?? setup.team[0]!)
  const wildFighter = setup.wild

  const chargedCost = $derived(activeFighter.chargedMove ? chargedEnergyCost(activeFighter.chargedMove.power) : null)
  const waitMs = $derived(Math.max(0, active.readyAt - elapsed, snap.switchReadyAt - elapsed))
  const waitTotal = $derived(Math.max(1, active.readyAt - cdFrom, snap.switchReadyAt - cdFrom))
  const cdFill = $derived(waitMs <= 0 ? 1 : Math.max(0, Math.min(1, 1 - waitMs / waitTotal)))
  const allyLocked =
    $derived(active.status === 'sleep' || active.status === 'freeze')
  const lockLabel = $derived(
    active.status === 'sleep' ? 'Dormindo' : active.status === 'freeze' ? 'Congelado' : null,
  )
  const switchWait = $derived(Math.max(0, snap.switchReadyAt - elapsed))
  const canAct = $derived(
    status === 'live' && !battleAuto && !active.fainted && !snap.wild.fainted && waitMs <= 0 && !allyLocked,
  )
  // Troca: o servidor só exige o cooldown de switch (não o do golpe nem sleep/freeze).
  const canSwitch = $derived(
    status === 'live' && !active.fainted && !snap.wild.fainted && switchWait <= 0,
  )
  const fastText = $derived(lockLabel ?? moveLabel(activeFighter.fastMove.name))
  const chargedText = $derived(
    lockLabel ?? (activeFighter.chargedMove ? moveLabel(activeFighter.chargedMove.name) : ''),
  )

  // Ao ligar/desligar o Auto, zera o atraso de reação pendente.
  $effect(() => {
    void battleAuto
    autoAt = null
  })
  const canCharged = $derived(
    canAct && chargedCost !== null && active.energy >= chargedCost && activeFighter.chargedMove !== null,
  )
  const remaining = $derived(Math.max(0, timeLimit - displayElapsed))

  const allyMon = $derived(monOf(active.fighterId))
  const allyShiny = $derived(allyMon?.isShiny ?? false)
  // No recall, segura o sprite que está saindo; no send-out, o ativo novo.
  const allyShowSpecies = $derived(
    switchFx?.phase === 'out' ? switchFx.holdSpeciesId : active.speciesId,
  )
  const allyShowShiny = $derived(switchFx?.phase === 'out' ? switchFx.holdShiny : allyShiny)
  const allyLook = $derived(gardenSprite(allyShowSpecies, allyShowShiny))
  const wildLook = $derived(gardenSprite(encounter.speciesId, encounter.isShiny))
  const switchCss = $derived(
    !switchFx
      ? ''
      : switchFx.phase === 'out'
        ? `recall-${switchFx.token % 2}`
        : `sendout-${switchFx.token % 2}`,
  )

  // Corpo medido de cada lado (escala 1), para alinhar os efeitos ao sprite.
  // O seu Pokémon olha ↗ (linha 3) e o selvagem ↙ (linha 7), como nos PmdSprite.
  // Escala do sprite em pixels inteiros da tela (escala do Windows, zoom):
  // senão o desenho sai com pixels de tamanhos diferentes.
  const spriteScale = $derived(snapPixelScale(2))
  const chipScale = $derived(snapPixelScale(1))
  let wildBody = $state<SpriteBody | null>(null)
  let allyBody = $state<SpriteBody | null>(null)
  $effect(() => {
    const look = wildLook
    const speciesId = encounter.speciesId
    wildBody = null
    if (look.kind !== 'pmd') return
    let alive = true
    void pmdBody(speciesId, look.shinySheet, 7).then((body) => {
      if (alive) wildBody = body
    })
    return () => {
      alive = false
    }
  })
  $effect(() => {
    const look = allyLook
    const speciesId = active.speciesId
    allyBody = null
    if (look.kind !== 'pmd') return
    let alive = true
    void pmdBody(speciesId, look.shinySheet, 3).then((body) => {
      if (alive) allyBody = body
    })
    return () => {
      alive = false
    }
  })

  const idleTime = $derived(reduced ? 0 : clock)
  const allyView = $derived(poseView(allyPose, clock, idleTime))
  const wildView = $derived(poseView(wildPose, clock, idleTime))

  function monOf(id: number | null): OwnedPokemon | undefined {
    return id === null ? undefined : team.find((mon) => mon.id === id)
  }

  function nameOf(fighter: SimFighter): string {
    const mon = monOf(fighter.id)
    return mon ? (mon.nickname ?? mon.displayName) : `#${fighter.speciesId}`
  }

  function moveLabel(name: string): string {
    const text = name.replace(/[-_]/g, ' ')
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  /**
   * Tamanho do nome no botão pela maior palavra (as outras quebram linha):
   * "Thunderbolt" não cabe inteiro na fonte cheia num botão de 360px.
   */
  function nameFit(text: string): 'full' | 'small' | 'tiny' {
    const longest = Math.max(...text.split(' ').map((word) => word.length))
    return longest > 11 ? 'tiny' : longest > 8 ? 'small' : 'full'
  }

  // ---- Simulação ao vivo -------------------------------------------------

  function commit(next: BattleResult, e: number) {
    // Primeira foto (retomada) ou log menor que o visto: só sincroniza, sem efeitos.
    const resync = !primed || next.log.length < seen
    if (resync) {
      allyPose = null
      wildPose = null
      clearSwitchTimers()
      switchFx = null
    }
    const startAt = resync ? next.log.length : seen
    const prevActive = primed ? sim.snapshot.activeSlot : null
    let slot = 0
    let from = 0
    let switchStarted = false
    for (let i = 0; i < next.log.length; i += 1) {
      const event = next.log[i]!
      if (event.kind === 'enter' && event.side === 'player') {
        const changed = prevActive !== null && prevActive !== event.slot && !switchStarted
        if (i >= startAt && changed && event.t >= e - FX_STALE_MS) {
          const fromFaint = sim.snapshot.team[prevActive]?.fainted === true
          beginSwitchFx(prevActive, fromFaint)
          switchStarted = true
        }
        slot = event.slot
        from = event.t
        if (i >= startAt && !switchStarted) allyPose = null
      }
      if (event.kind === 'move' && event.side === 'player') from = event.t
      // Só pula o efeito de evento velho de verdade (a aba ficou em segundo
      // plano, por exemplo). Antes pulava tudo quando a última re-simulação
      // tinha mais de 700 ms, e isso acontecia no meio da luta, entre um golpe
      // e outro: a vida descia, mas o efeito, o número e o flash não saíam.
      if (i >= startAt && event.t >= e - FX_STALE_MS) {
        react(event, slot, next.snapshot.result === 'win' || next.snapshot.result === 'lose')
      }
    }
    seen = next.log.length
    primed = true
    cdFrom = from
    sim = next
    nextEventAt = nextEventFor(next, e)
    // Fim por desmaio: dispara o finish na hora (não espera o próximo quadro),
    // e o timer já congela via displayElapsed.
    if (next.snapshot.result !== null && status === 'live' && !fleeing) void finish()
  }

  /**
   * Quando re-simular de novo sem toque novo. O selvagem age entre 80 e 320 ms
   * depois do cooldown liberar (sorteio da luta): até lá nada muda; dentro
   * dessa janela, olha a cada quadro. Aliado caído: a troca é por tempo.
   */
  function nextEventFor(result: BattleResult, e: number): number {
    const state = result.snapshot
    if (state.result !== null) return Number.POSITIVE_INFINITY
    let next = timeLimit
    if (!state.wild.fainted) next = Math.min(next, Math.max(state.wild.readyAt + simConfig.aiFastDelayMinMs, e + 1))
    if (state.team[state.activeSlot]?.fainted) next = Math.min(next, e + 1)
    // Com status em campo, o tempo sozinho muda a luta (dano por segundo,
    // acordar, descongelar, a confusão passar): re-simula a cada 100 ms.
    const ally = state.team[state.activeSlot]
    if (ally?.status || ally?.confused || state.wild.status || state.wild.confused) {
      next = Math.min(next, e + 100)
    }
    return next
  }

  function resim(e: number) {
    try {
      commit(simulate(e), e)
    } catch {
      fail('invalid_input')
    }
  }

  function push(action: BattleInput['action'], slot?: number) {
    if (status !== 'live') return
    const last = inputs.length > 0 ? inputs[inputs.length - 1]!.t : 0
    const t = Math.max(last, elapsedAt(performance.now()))
    inputs = [...inputs, slot === undefined ? { t, action } : { t, action, slot }]
    persist()
    resim(t)
  }

  function manual(action: 'fast' | 'charged') {
    if (action === 'charged' ? !canCharged : !canAct) return
    push(action)
  }

  function openParty() {
    if (!canSwitch || status !== 'live') return
    play('tap')
    // Garante Idle na abertura da lista (rede lenta / time que ainda não baixou).
    for (const fighter of setup.team) {
      const mon = monOf(fighter.id)
      const look = gardenSprite(fighter.speciesId, mon?.isShiny ?? false)
      if (look.kind === 'pmd') preloadPmd(fighter.speciesId, look.shinySheet)
    }
    partyOpen = true
  }

  function closeParty() {
    partyOpen = false
  }

  function swap(slot: number) {
    const side = snap.team[slot]
    if (!canSwitch || !side || side.fainted || slot === snap.activeSlot) return
    play('tap')
    partyOpen = false
    push('switch', slot)
  }

  // Fecha a lista se a troca deixar de estar disponível (CD, fim, etc.).
  $effect(() => {
    if (!canSwitch && partyOpen) partyOpen = false
  })

  function clearSwitchTimers() {
    for (const id of switchTimers) window.clearTimeout(id)
    switchTimers = []
  }

  function beginSwitchFx(prevSlot: number, fromFaint: boolean) {
    if (reduced) {
      switchFx = null
      return
    }
    clearSwitchTimers()
    switchToken += 1
    const token = switchToken
    const prev = setup.team[prevSlot]!
    const mon = monOf(prev.id)
    if (fromFaint) {
      // Desmaio já tirou o anterior: só a entrada do próximo.
      allyPose = null
      switchFx = { phase: 'in', holdSpeciesId: 0, holdShiny: false, token }
      switchTimers.push(
        window.setTimeout(() => {
          if (switchFx?.token === token) switchFx = null
        }, SWITCH_IN_MS),
      )
      return
    }
    switchFx = {
      phase: 'out',
      holdSpeciesId: prev.speciesId,
      holdShiny: mon?.isShiny ?? false,
      token,
    }
    allyPose = null
    switchTimers.push(
      window.setTimeout(() => {
        if (switchFx?.token !== token) return
        switchFx = { phase: 'in', holdSpeciesId: 0, holdShiny: false, token }
        switchTimers.push(
          window.setTimeout(() => {
            if (switchFx?.token === token) switchFx = null
          }, SWITCH_IN_MS),
        )
      }, SWITCH_OUT_MS),
    )
  }

  function toggleSpeed() {
    if (status !== 'live' || fleeing) return
    play('tap')
    const now = performance.now()
    simBase = elapsedAt(now)
    wallBase = now
    speed = speed === 2 ? 1 : 2
    saveBattleSpeed(speed)
  }

  function toggleAuto() {
    if (status !== 'live' || fleeing) return
    play('tap')
    onBattleAuto(!battleAuto)
    persist()
  }

  async function fleeFight() {
    if (status !== 'live' || fleeing) return
    fleeing = true
    play('tap')
    const ok = await onFlee()
    if (!ok && alive) fleeing = false
  }

  // Automático: toca quando o cooldown libera mais uma reação curta, com a
  // mesma escolha da simulação (carregado se a energia basta, senão rápido).
  // Gera inputs de verdade, então o servidor valida a luta como qualquer outra.
  function autoStep(e: number) {
    if (!battleAuto) return
    const state = sim.snapshot
    const side = state.team[state.activeSlot]
    // Dormindo ou congelado: espera, senão mandaria um toque recusado por quadro.
    if (
      !side ||
      side.fainted ||
      side.status === 'sleep' ||
      side.status === 'freeze' ||
      state.wild.fainted ||
      state.result !== null
    ) {
      autoAt = null
      return
    }
    const ready = Math.max(side.readyAt, state.switchReadyAt)
    if (autoAt === null || autoFor !== ready) {
      autoFor = ready
      autoAt = ready + nextAutoDelay()
    }
    if (e < autoAt) return
    const fighter = setup.team[state.activeSlot]!
    const charged = fighter.chargedMove
    const action = charged && side.energy >= chargedEnergyCost(charged.power) ? 'charged' : 'fast'
    autoAt = null
    push(action)
  }

  function persist() {
    saveBattleProgress(encounterId, {
      startedAtWall: startedWall,
      seed,
      setup,
      inputs,
      auto: battleAuto,
      timeLimitMs: timeLimit,
    })
  }

  function tick(now: number) {
    frame = requestAnimationFrame(tick)
    clock = now
    if (floaters.length > 0 && floaters.some((f) => now - f.born > FLOAT_MS)) {
      floaters = floaters.filter((f) => now - f.born <= FLOAT_MS)
    }
    if (pendingHits.length > 0) {
      const due = pendingHits.filter((hit) => now >= hit.at)
      if (due.length > 0) {
        for (const hit of due) applyHitJuice(hit)
        pendingHits = pendingHits.filter((hit) => now < hit.at)
      }
    }
    if (pendingFx.length > 0) {
      const due = pendingFx.filter((item) => now >= item.at)
      if (due.length > 0) {
        for (const item of due) spawnBurstFx(item.side, item.fxId, item)
        pendingFx = pendingFx.filter((item) => now < item.at)
      }
    }
    if (chargedFx && now >= chargedFx.until) chargedFx = null
    pulseStatusFx(now)
    if (status !== 'live' || fleeing) return
    const e = elapsedAt(now)
    if (e >= nextEventAt) resim(e)
    autoStep(e)
    if (sim.snapshot.result !== null || e >= timeLimit) void finish()
  }

  onMount(() => {
    persist()
    void loadBattleFx()
    // Preview da lista de troca: Idle de frente de todo o time (não só o ativo).
    for (const fighter of setup.team) {
      const mon = monOf(fighter.id)
      const look = gardenSprite(fighter.speciesId, mon?.isShiny ?? false)
      if (look.kind === 'pmd') void loadPmd(fighter.speciesId, look.shinySheet)
      else {
        const img = new Image()
        img.src = showdownSrc(fighter.speciesId, mon?.isShiny ?? false)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      window.clearTimeout(flashClear)
      clearSwitchTimers()
    }
  })

  $effect(() => {
    // Só depende dos status do snapshot; bursts ficam de fora do tracking.
    const want: { key: string; side: 'player' | 'wild'; fxId: FxId; place: 'body' | 'head' }[] = []
    if (!reduced) {
      if (!snap.wild.fainted && snap.wild.status === 'poison') {
        want.push({ key: 'status-poison-wild', side: 'wild', fxId: 'venom-ward', place: 'body' })
      }
      if (!snap.wild.fainted && snap.wild.confused) {
        want.push({ key: 'status-conf-wild', side: 'wild', fxId: 'choir-moths', place: 'head' })
      }
      if (!active.fainted && active.status === 'poison') {
        want.push({ key: 'status-poison-player', side: 'player', fxId: 'venom-ward', place: 'body' })
      }
      if (!active.fainted && active.confused) {
        want.push({ key: 'status-conf-player', side: 'player', fxId: 'choir-moths', place: 'head' })
      }
    }
    const bursts = untrack(() => liveFx.filter((fx) => !fx.sticky))
    const prevSticky = untrack(() => liveFx.filter((fx) => fx.sticky))
    const stickies: LiveFx[] = want.map((item) => {
      const kept = prevSticky.find((fx) => fx.key === item.key)
      if (kept) return kept
      fxUid += 1
      return {
        key: item.key,
        uid: fxUid,
        fxId: item.fxId,
        side: item.side,
        place: item.place,
        scale: FX_SCALE_STATUS,
        loop: true,
        sticky: true,
        rate: 1,
        maxFrames: null,
        born: performance.now(),
      }
    })
    liveFx = [...bursts, ...stickies].slice(-FX_MAX_ON_SCREEN)
  })

  // ---- Fim da luta -------------------------------------------------------

  function fail(code: string) {
    status = 'finishing'
    onError(code)
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function needAt(level: number): number | null {
    if (level >= progression.levelCap) return null
    return xpToNext(level, progression)
  }

  function easeOut(t: number): number {
    return t * (2 - t)
  }

  function tweenXp(fromXp: number, toXp: number, need: number, level: number): Promise<void> {
    if (reduced || fromXp === toXp) {
      xpOverride = { level, xp: toXp, need }
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const born = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - born) / XP_FILL_MS)
        const xp = fromXp + (toXp - fromXp) * easeOut(t)
        xpOverride = { level, xp, need }
        if (t < 1) {
          requestAnimationFrame(tick)
          return
        }
        xpOverride = { level, xp: toXp, need }
        resolve()
      }
      requestAnimationFrame(tick)
    })
  }

  /** Avança só com toque — sem auto-passar. */
  function waitRecap(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      recapAdvance = () => {
        if (settled) return
        settled = true
        recapAdvance = null
        recapHint = false
        resolve()
      }
      recapHint = true
    })
  }

  function onRecapTap() {
    if (status !== 'celebrating' || recapBusy) return
    recapAdvance?.()
  }

  function buildRecapSteps(outcome: BattleOutcome): RecapStep[] {
    const steps: RecapStep[] = []
    const onFieldId = activeFighter.id
    if (outcome.won) {
      steps.push({ kind: 'text', line: `${encounter.displayName} desmaiou!` })
    } else {
      steps.push({ kind: 'text', line: 'Seu time foi derrotado…' })
    }
    if (outcome.won) {
      for (const fighter of outcome.fighters) {
        if (fighter.xpGained <= 0 && fighter.levelsGained <= 0) continue
        const mon = monOf(fighter.pokemonId)
        const name = mon ? (mon.nickname ?? mon.displayName) : 'Pokémon'
        steps.push({
          kind: 'xp',
          line: `${name} ganhou ${fighter.xpGained} de XP!`,
          pokemonId: fighter.pokemonId,
          xpGained: fighter.xpGained,
          endLevel: fighter.level,
          endXp: fighter.xp,
          levelsGained: fighter.levelsGained,
          animate: fighter.pokemonId === onFieldId,
        })
        if (fighter.levelsGained > 0) {
          steps.push({
            kind: 'level',
            line: `${name} subiu para o Nv. ${fighter.level}!`,
          })
        }
      }
      // Reserva do “dinheiro” / itens (semente e recompensas de nível por enquanto).
      if (outcome.seedDrop) {
        steps.push({ kind: 'text', line: `Encontrou ${itemLabel(outcome.seedDrop.itemKey, berries, balls)}!` })
      }
      for (const reward of outcome.levelRewards ?? []) {
        const label = itemLabel(reward.itemKey, berries, balls)
        steps.push({
          kind: 'text',
          line:
            reward.quantity > 1 ? `Recebeu ${reward.quantity}× ${label}!` : `Recebeu ${label}!`,
        })
      }
    }
    return steps
  }

  async function playXpBar(step: Extract<RecapStep, { kind: 'xp' }>) {
    const mon = monOf(step.pokemonId)
    if (!mon || !step.animate) return
    let level = mon.level
    let xp = mon.xp
    xpOverride = { level, xp, need: needAt(level) }
    while (level < step.endLevel) {
      const need = needAt(level)
      if (need === null) break
      await tweenXp(xp, need, need, level)
      level += 1
      xp = 0
      xpOverride = { level, xp: 0, need: needAt(level) }
      await sleep(reduced ? 80 : XP_LEVEL_PAUSE_MS)
    }
    const need = needAt(step.endLevel)
    if (need !== null) await tweenXp(xp, step.endXp, need, step.endLevel)
    else xpOverride = { level: step.endLevel, xp: step.endXp, need: null }
  }

  /** Painel pós-luta no lugar dos botões: desmaio → XP → itens. */
  async function runRecap(outcome: BattleOutcome) {
    status = 'celebrating'
    const steps = buildRecapSteps(outcome)
    if (steps.length === 0) return
    for (const step of steps) {
      recapLine = step.line
      if (step.kind === 'xp') {
        recapBusy = true
        recapHint = false
        await playXpBar(step)
        recapBusy = false
      } else if (step.kind === 'level') {
        play('levelup')
      }
      // Só avança no toque; durante a barra o toque fica bloqueado.
      await waitRecap()
    }
  }

  async function finish() {
    if (status !== 'live' || fleeing) return
    status = 'finishing'
    recapLine = '…'
    recapHint = false
    // Deixa a animação de desmaio aparecer antes de trocar de tela (só visual).
    const lingerMs =
      !reduced && sim.snapshot.result !== null && sim.snapshot.result !== 'timeout'
        ? endingFaint
          ? FAINT_SLOW_MS
          : FAINT_LINGER_MS
        : 0
    const linger = lingerMs > 0 ? sleep(lingerMs) : Promise.resolve()
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let response: Response
      try {
        response = await api(`/api/encounters/${encounterId}/battle/finish`, { inputs })
      } catch {
        status = 'offline'
        return
      }
      if (response.ok) {
        const outcome = (await response.json()) as BattleOutcome
        // O servidor já fechou a luta: o save sai agora, não depois do painel
        // (que espera toque e pode ficar aberto até o F5).
        clearSavedBattle(encounterId)
        await linger
        await runRecap(outcome)
        onFinished(outcome, team)
        return
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      // O relógio do servidor pode estar poucos ms à frente do nosso.
      if (body.error === 'finish_too_early' && attempt < 7) {
        await sleep(450)
        continue
      }
      const code = body.error ?? 'internal'
      if (code === 'encounter_not_found') clearSavedBattle(encounterId)
      onError(code)
      return
    }
  }

  function retryFinish() {
    status = 'live'
  }

  // ---- Reações aos eventos (som, número, animação) ------------------------

  /** `ended`: a luta acabou por desmaio nesta re-simulação (`sim` ainda é a anterior). */
  function react(event: BattleEvent, allySlot: number, ended: boolean) {
    if (event.kind === 'move') {
      const attacker = event.side === 'player' ? setup.team[allySlot]! : wildFighter
      const defenderSide = event.side === 'player' ? 'wild' : 'player'
      const charged = event.move === 'charged'
      const crit = event.critical === true
      const move = charged ? attacker.chargedMove : attacker.fastMove
      if (event.side === 'player') play(charged ? 'charged' : 'fast')
      if (charged) showCharged(attacker, event.side, event.moveName)
      poseFor(event.side, attackSteps(attacker, event.side, event.move))
      if (event.damage > 0 && move) {
        const fxId = fxForMove(move.type, move.damageClass, event.move)
        const rate = move.type === 'flying' ? FX_FLYING_RATE : 1
        // Golpe especial: a bola voa até o alvo e o impacto (efeito, número,
        // flash) espera ela chegar. O resultado da luta não muda: é só visual.
        const flight = move.damageClass === 'special' ? launchProjectile(event.side, move.type, charged) : 0
        const impact = {
          side: defenderSide,
          fxId,
          scale: charged ? FX_SCALE_CHARGED : FX_SCALE_FAST,
          rate,
          maxFrames: fxHitFrameCap(fxId),
        } as const
        if (flight > 0) pendingFx = [...pendingFx, { at: performance.now() + flight, ...impact }]
        else spawnBurstFx(defenderSide, fxId, impact)
        scheduleHit({
          side: defenderSide,
          damage: event.damage,
          effectiveness: event.effectiveness,
          charged: charged || crit,
          critical: crit,
          delayMs: reduced ? 0 : flight + fxContactMs(fxId),
        })
        if (!event.fainted) {
          poseFor(
            defenderSide,
            hurtSteps(defenderSide === 'player' ? setup.team[allySlot]! : wildFighter, defenderSide),
          )
        }
      } else if (move) {
        // Dano 0: o alvo é imune (tipo ou habilidade). Sem impacto nem tremor,
        // só o aviso, no tempo em que o golpe chegaria.
        scheduleHit({
          side: defenderSide,
          damage: 0,
          effectiveness: event.effectiveness,
          charged,
          critical: false,
          delayMs: reduced ? 0 : IMMUNE_NOTE_DELAY_MS,
        })
      }
      if (event.fainted && ended) endingFaint = true
    } else if (event.kind === 'heal' || event.kind === 'drain') {
      spawnHeal(event.side, event.amount)
      spawnBurstFx(event.side, 'radiant-heal', { scale: FX_SCALE_FAST })
    } else if (event.kind === 'status_damage') {
      spawnSoftDamage(event.side, event.damage, event.status === 'burn' ? 'burn' : 'poison')
      if (event.fainted && ended) endingFaint = true
    } else if (event.kind === 'recoil') {
      spawnSoftDamage(event.side, event.damage, 'recoil')
      if (event.fainted && ended) endingFaint = true
    } else if (event.kind === 'confusion_hit') {
      spawnSoftDamage(event.side, event.damage, 'confusion')
      if (event.fainted && ended) endingFaint = true
    } else if (event.kind === 'status') {
      if (event.status === 'freeze') {
        spawnBurstFx(event.side, 'frost-nova', {
          scale: FX_SCALE_STATUS,
          maxFrames: (fxMeta('frost-nova')?.peak ?? 5) + 1,
        })
      }
    } else if (event.kind === 'stat_change') {
      spawnStatArrow(event.side, event.stat, event.stages)
    } else if (event.kind === 'faint') {
      play('faint')
      const fighter = event.side === 'player' ? setup.team[event.slot]! : wildFighter
      poseFor(event.side, faintSteps(fighter, event.side, endingFaint))
    }
  }

  function showCharged(attacker: SimFighter, side: 'player' | 'wild', moveName: string) {
    if (reduced) return
    const move = attacker.chargedMove ?? attacker.fastMove
    chargedFx = {
      name: moveLabel(moveName),
      color: TYPE_GLOW[move.type] ?? '#fff',
      side,
      until: performance.now() + CHARGED_BANNER_MS,
    }
    spawnBurstFx(side, 'focus-charge', { scale: FX_SCALE_FAST, place: 'attacker' })
  }

  function scheduleHit(input: {
    side: 'player' | 'wild'
    damage: number
    effectiveness: number
    charged: boolean
    critical: boolean
    delayMs: number
  }) {
    const hit: PendingHit = {
      at: performance.now() + Math.max(0, input.delayMs),
      side: input.side,
      damage: input.damage,
      effectiveness: input.effectiveness,
      charged: input.charged,
      critical: input.critical,
    }
    if (input.delayMs <= 0) applyHitJuice(hit)
    else pendingHits = [...pendingHits, hit]
  }

  function applyHitJuice(hit: PendingHit) {
    // Imune: sem tremor, flash nem som de acerto, só o aviso.
    if (hit.damage > 0) {
      play('hit')
      bumpJuice(hit.side, hit.charged)
    }
    spawnDamage(hit.side, hit.damage, hit.effectiveness, hit.charged, hit.critical)
  }

  function bumpJuice(side: 'player' | 'wild', charged: boolean) {
    if (reduced) return
    flashSide = side
    window.clearTimeout(flashClear)
    flashClear = window.setTimeout(() => {
      flashSide = null
    }, HIT_FLASH_MS)
    shakeHard = charged
    shakeToken += 1
  }

  function spawnBurstFx(
    side: 'player' | 'wild',
    fxId: FxId,
    opts: {
      scale?: 1 | 2
      rate?: number
      maxFrames?: number | null
      place?: 'body' | 'head' | 'attacker'
    } = {},
  ) {
    if (reduced) return
    fxUid += 1
    const next: LiveFx = {
      key: `burst-${fxUid}`,
      uid: fxUid,
      fxId,
      side,
      place: opts.place ?? 'body',
      scale: opts.scale ?? FX_SCALE_FAST,
      loop: false,
      sticky: false,
      rate: opts.rate ?? 1,
      maxFrames: opts.maxFrames ?? null,
      born: performance.now(),
    }
    let list = [...liveFx, next]
    while (list.length > FX_MAX_ON_SCREEN) {
      const drop = list.findIndex((fx) => !fx.sticky)
      if (drop < 0) break
      list = list.filter((_, i) => i !== drop)
    }
    liveFx = list
  }

  /**
   * Onde fica o pivot do efeito, em px da arena: o meio do corpo (ou o alto da
   * cabeça). A arena corta o que passa da borda, e um efeito 2× perto do canto
   * (o seu Pokémon fica embaixo à esquerda, o selvagem no alto) perderia um
   * pedaço: o quadro inteiro é empurrado para dentro, por todos os lados.
   */
  function fxPoint(fx: LiveFx): { x: number; y: number } | null {
    const meta = fxMeta(fx.fxId)
    // O pivot do PVFX diz como o efeito foi desenhado: abaixo do meio do quadro
    // é um efeito de chão (explosão, anel, respingo saindo do solo) e vai no pé
    // do Pokémon; no meio é um impacto e vai no meio do corpo. Pôr um efeito de
    // chão no meio do corpo deixava a base reta dele cortando o Pokémon.
    const grounded = (meta?.pivot[1] ?? 0) >= FX_GROUND_PIVOT_MIN
    const point = bodyPoint(fx.side, fx.place === 'head' ? 'head' : grounded ? 'ground' : 'body')
    if (!point || !arenaEl) return point
    const pivotX = (meta?.pivot[0] ?? FX_FRAME_SIZE / 2) * fx.scale
    const pivotY = (meta?.pivot[1] ?? FX_FRAME_SIZE / 2) * fx.scale
    const size = FX_FRAME_SIZE * fx.scale
    const fit = (at: number, pivot: number, room: number) =>
      size >= room ? at : Math.min(room - size + pivot, Math.max(pivot, at))
    return {
      x: fit(point.x, pivotX, arenaEl.clientWidth),
      y: fit(point.y, pivotY, arenaEl.clientHeight),
    }
  }

  /** Meio do corpo (ou alto da cabeça) de um lado, em px da arena (ou null sem medir). */
  function bodyPoint(
    side: 'player' | 'wild',
    place: 'body' | 'head' | 'ground' = 'body',
  ): { x: number; y: number } | null {
    const slot = side === 'wild' ? wildSlotEl : allySlotEl
    if (!arenaEl || !slot) return null
    const arena = arenaEl.getBoundingClientRect()
    const box = slot.getBoundingClientRect()
    const body = side === 'wild' ? wildBody : allyBody
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const groundX = box.left + box.width / 2 - arena.left
    const groundY = box.bottom - 0.75 * rem - arena.top
    if (place === 'ground') return { x: groundX + (body?.centerX ?? 0) * spriteScale, y: groundY }
    if (!body) {
      return { x: groundX, y: box.top + box.height * (place === 'head' ? 0.18 : 0.42) - arena.top }
    }
    const lift = place === 'head' ? body.top + 4 : body.centerY
    return { x: groundX + body.centerX * spriteScale, y: groundY + lift * spriteScale }
  }

  /** Solta a bola do atacante até o alvo; devolve quanto ela leva (0 = sem bola). */
  function launchProjectile(attackerSide: 'player' | 'wild', type: string, charged: boolean): number {
    if (reduced) return 0
    const from = bodyPoint(attackerSide)
    const to = bodyPoint(attackerSide === 'player' ? 'wild' : 'player')
    if (!from || !to) return 0
    const ms = charged ? PROJ_CHARGED_MS : PROJ_FAST_MS
    fxUid += 1
    const uid = fxUid
    projectiles = [...projectiles, { uid, from, to, ms, color: TYPE_GLOW[type] ?? '#fff', big: charged }]
    window.setTimeout(() => {
      projectiles = projectiles.filter((item) => item.uid !== uid)
    }, ms)
    return ms
  }

  function dropFx(uid: number) {
    liveFx = liveFx.filter((fx) => fx.uid !== uid)
  }

  function pulseStatusFx(now: number) {
    if (reduced || status !== 'live') return
    pulseSide(now, 'wild', snap.wild)
    pulseSide(now, 'player', active)
  }

  function pulseSide(now: number, side: 'player' | 'wild', state: BattleSnapshotSide) {
    if (state.fainted) return
    if (state.status === 'burn' && now - lastBurnPulse[side] >= FX_STATUS_PULSE_MS) {
      lastBurnPulse[side] = now
      const peak = fxMeta('ember-jet')?.peak ?? 4
      spawnBurstFx(side, 'ember-jet', { scale: FX_SCALE_STATUS, maxFrames: peak + 1 })
    }
    // Paralisia não é golpe: em vez do impacto elétrico, um choque próprio a
    // cada segundo (o sprite pisca amarelo e saem dois raiozinhos).
    if (state.status === 'paralysis' && now - lastParaPulse[side] >= FX_STATUS_PULSE_MS) {
      lastParaPulse[side] = now
      zapUntil = { ...zapUntil, [side]: now + ZAP_MS }
    }
  }

  function spawnDamage(
    side: 'player' | 'wild',
    damage: number,
    effectiveness: number,
    charged: boolean,
    critical = false,
  ) {
    floaterId += 1
    // Acertou e não tirou nada: imunidade de tipo (Normal em Fantasma) ou de
    // habilidade (Levitate, Flash Fire...). Avisa em vez de mostrar "-0".
    const immune = damage === 0
    let note: string | undefined
    if (immune) note = 'Não afeta!'
    else if (critical) note = 'Crítico!'
    else if (effectiveness > 1) note = 'Super eficaz!'
    else if (effectiveness > 0 && effectiveness < 1) note = 'Pouco eficaz'
    floaters = [
      ...floaters,
      {
        id: floaterId,
        side,
        text: immune ? 'Imune' : `-${damage}`,
        heal: false,
        born: performance.now(),
        charged,
        effectiveness,
        note,
        tone: 'hit',
      },
    ]
  }

  function spawnSoftDamage(side: 'player' | 'wild', damage: number, tone: FloaterTone) {
    floaterId += 1
    floaters = [
      ...floaters,
      { id: floaterId, side, text: `-${damage}`, heal: false, born: performance.now(), tone },
    ]
  }

  function spawnHeal(side: 'player' | 'wild', amount: number) {
    floaterId += 1
    floaters = [
      ...floaters,
      { id: floaterId, side, text: `+${amount}`, heal: true, born: performance.now(), tone: 'heal' },
    ]
  }

  function spawnStatArrow(side: 'player' | 'wild', stat: string, stages: number) {
    floaterId += 1
    const arrow = stages > 0 ? '↑' : '↓'
    floaters = [
      ...floaters,
      {
        id: floaterId,
        side,
        text: `${arrow}${statShort(stat)}`,
        heal: stages > 0,
        born: performance.now(),
      },
    ]
  }

  function statShort(stat: string): string {
    switch (stat) {
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
        return stat
    }
  }

  function statusSeal(status: string | null | undefined): { code: string; tone: string } | null {
    if (!status) return null
    switch (status) {
      case 'burn':
        return { code: 'QMD', tone: 'burn' }
      case 'poison':
        return { code: 'ENV', tone: 'poison' }
      case 'paralysis':
        return { code: 'PAR', tone: 'para' }
      case 'sleep':
        return { code: 'DRM', tone: 'sleep' }
      case 'freeze':
        return { code: 'CGL', tone: 'freeze' }
      default:
        return null
    }
  }

  function shinySheet(fighter: SimFighter, side: 'player' | 'wild'): boolean {
    if (side === 'wild') return wildLook.kind === 'pmd' && wildLook.shinySheet
    const mon = monOf(fighter.id)
    const look = gardenSprite(fighter.speciesId, mon?.isShiny ?? false)
    return look.kind === 'pmd' && look.shinySheet
  }

  function sheetStep(fighter: SimFighter, side: 'player' | 'wild', anim: PmdAnimName | null): Step | null {
    if (!anim) return null
    const sheet = pmdAnim(fighter.speciesId, shinySheet(fighter, side), anim)
    if (!sheet) return null
    const ticks = sheet.durations.reduce((sum, value) => sum + value, 0)
    return { anim, css: null, ms: Math.max(120, (ticks * 1000) / 60) }
  }

  // Golpe rápido: Attack (ou Shoot se especial e existir). Carregado: Charge e
  // depois o mesmo. Sem as folhas PMD (Ditto, GIF…), recua para o "lunge" em CSS.
  function attackSteps(fighter: SimFighter, side: 'player' | 'wild', kind: 'fast' | 'charged'): Step[] {
    const move = kind === 'charged' ? fighter.chargedMove : fighter.fastMove
    const hasShoot = pmdHasAnim(fighter.speciesId, shinySheet(fighter, side), 'Shoot')
    const steps: Step[] = []
    if (kind === 'charged') {
      const charge = sheetStep(fighter, side, battleAnimChoice({ kind: 'charged' }).anim)
      if (charge) steps.push(charge)
    }
    const hit = sheetStep(
      fighter,
      side,
      battleAnimChoice({ kind: 'fast', damageClass: move?.damageClass, hasShoot }).anim,
    )
    // A folha de ataque do PMD mexe pouco e se confunde com o Idle: o golpe
    // sempre leva junto o avanço em CSS na direção do alvo.
    if (hit) steps.push({ ...hit, css: 'lunge' })
    if (steps.length === 0) steps.push({ anim: null, css: 'lunge', ms: 320 })
    return steps
  }

  function hurtSteps(fighter: SimFighter, side: 'player' | 'wild'): Step[] {
    const sheet = sheetStep(fighter, side, battleAnimChoice({ kind: 'hurt' }).anim)
    return [sheet ?? { anim: null, css: 'hurt', ms: 450 }]
  }

  function faintSteps(fighter: SimFighter, side: 'player' | 'wild', slow: boolean): Step[] {
    const sheet = sheetStep(fighter, side, battleAnimChoice({ kind: 'faint' }).anim)
    const ms = slow && !reduced ? FAINT_SLOW_MS : 600
    if (sheet) return [{ ...sheet, ms: Math.max(sheet.ms, ms) }]
    return [{ anim: null, css: 'faint', ms }]
  }

  function poseFor(side: 'player' | 'wild', steps: Step[]) {
    if (reduced) return
    poseId += 1
    const pose: Pose = { id: poseId, start: performance.now(), steps }
    // Quem caiu continua caído até a próxima entrada: nada o sobrescreve.
    if (side === 'player') {
      if (!isFaintPose(allyPose)) allyPose = pose
      else if (steps[0]?.css === 'faint' || steps[0]?.anim === 'Faint') allyPose = pose
    } else if (!isFaintPose(wildPose)) wildPose = pose
  }

  function isFaintPose(pose: Pose | null): boolean {
    const first = pose?.steps[0]
    return first?.css === 'faint' || first?.anim === 'Faint'
  }

  function poseView(
    pose: Pose | null,
    now: number,
    idle: number,
  ): { anim: PmdAnimName; time: number; css: string } {
    if (!pose) return { anim: 'Idle', time: idle, css: '' }
    const into = Math.max(0, now - pose.start)
    let offset = 0
    for (const step of pose.steps) {
      if (into < offset + step.ms) {
        return {
          anim: step.anim ?? 'Idle',
          time: step.anim ? into - offset : idle,
          css: step.css ? `${step.css}-${pose.id % 2}` : '',
        }
      }
      offset += step.ms
    }
    const last = pose.steps[pose.steps.length - 1]
    // Desmaio fica no último quadro; os outros voltam a respirar.
    if (isFaintPose(pose) && last) {
      return { anim: last.anim ?? 'Idle', time: last.anim ? Math.max(0, last.ms - 1) : idle, css: last.css ? 'faint-end' : '' }
    }
    return { anim: 'Idle', time: idle, css: '' }
  }

  // ---- Apresentação --------------------------------------------------------

  function hpPercent(side: BattleSnapshotSide): number {
    return side.maxHp <= 0 ? 0 : Math.max(0, Math.min(100, (side.hp / side.maxHp) * 100))
  }

  function hpTone(percent: number): string {
    if (percent > 50) return 'ok'
    return percent > 20 ? 'mid' : 'low'
  }

  // A carga aparece só no enchimento do botão, de baixo para cima.
  const chargeFill = $derived(chargedCost === null ? 0 : Math.min(1, active.energy / chargedCost))
  const chargeReady = $derived(chargedCost !== null && active.energy >= chargedCost)
  const wildPercent = $derived(hpPercent(snap.wild))
  const allyPercent = $derived(hpPercent(active))
  const shakePx = $derived(shakeHard ? SHAKE_PX_CHARGED : SHAKE_PX_FAST)
  const shakeMs = $derived(shakeHard ? SHAKE_CHARGED_MS : SHAKE_FAST_MS)
  // Barra azul: durante a luta fica parada; no brinde pós-vitória anima.
  const xpHud = $derived.by((): XpHud | null => {
    if (xpOverride) return xpOverride
    const mon = monOf(activeFighter.id)
    if (!mon) return null
    return { level: mon.level, xp: mon.xp, need: mon.xpToNext }
  })
  const showRecap = $derived(status === 'finishing' || status === 'celebrating')
  const xpFill = $derived(
    xpHud && xpHud.need && xpHud.need > 0 ? Math.min(100, (xpHud.xp / xpHud.need) * 100) : 0,
  )

  // Rastro da barra: ao perder vida, a parte perdida espera um instante e
  // desce. O valor anterior é lido com untrack: se fosse dependência, o
  // efeito rodaria de novo logo depois de gravar e o rastro sumiria na hora.
  // A limpeza cancela a espera quando chega outro golpe antes dela.
  $effect(() => {
    const next = wildPercent
    if (reduced || next >= untrack(() => wildTrail)) {
      wildTrail = next
      return
    }
    const hold = window.setTimeout(() => (wildTrail = next), HP_TRAIL_HOLD_MS)
    return () => window.clearTimeout(hold)
  })

  $effect(() => {
    const next = allyPercent
    // Troca de Pokémon não é dano: a barra só acompanha.
    const swapped = untrack(() => allyTrailSlot !== snap.activeSlot)
    allyTrailSlot = untrack(() => snap.activeSlot)
    if (reduced || swapped || next >= untrack(() => allyTrail)) {
      allyTrail = next
      return
    }
    const hold = window.setTimeout(() => (allyTrail = next), HP_TRAIL_HOLD_MS)
    return () => window.clearTimeout(hold)
  })

  // Primeira foto da tela (retomada): já grava e aplica o estado inicial.
  commit(
    untrack(() => sim),
    elapsedAt(performance.now()),
  )
</script>

{#snippet bar(fill: number, trail: number, tone: string)}
  <span class="hp-track">
    <span class="hp-trail" style:transform="scaleX({trail / 100})"></span>
    <span class="hp-fill {tone}" style:transform="scaleX({fill / 100})"></span>
  </span>
{/snippet}

{#snippet fxLayer()}
  {#each liveFx as fx (fx.uid)}
    {@const at = fxPoint(fx)}
    <!-- Uma camada só, em coordenadas da arena: o efeito vai ao meio do corpo
         (ou ao alto da cabeça) e, se o quadro passaria da borda (a arena corta),
         é empurrado para dentro. -->
    <span
      class="fx-anchor"
      style:left="{at?.x ?? -999}px"
      style:top="{at?.y ?? -999}px"
      aria-hidden="true"
    >
      <FxSprite
        id={fx.fxId}
        scale={fx.scale}
        loop={fx.loop}
        rate={fx.rate}
        maxFrames={fx.maxFrames}
        time={clock - fx.born}
        onDone={() => dropFx(fx.uid)}
      />
    </span>
  {/each}
{/snippet}

<div class="live" class:ending={endingFaint && status === 'finishing'}>
  <div class="top">
    <span class="timer" class:late={remaining < 10_000} aria-label="Tempo restante">{formatCountdown(remaining)}</span>
    <div class="top-actions">
      <button type="button" class="btn flee" disabled={status !== 'live' || fleeing} onclick={fleeFight}>Fugir</button>
      <button
        type="button"
        class="btn speed"
        class:on={speed === 2}
        aria-pressed={speed === 2}
        aria-label="Acelerar a luta"
        disabled={status !== 'live' || fleeing}
        onclick={toggleSpeed}
      >
        2x
      </button>
      <button type="button" class="btn auto" class:on={battleAuto} aria-pressed={battleAuto} disabled={status !== 'live' || fleeing} onclick={toggleAuto}>
        Auto{battleAuto ? ': ligado' : ''}
      </button>
    </div>
  </div>

  <div
    class="arena"
    bind:this={arenaEl}
    class:nudge-a={!reduced && shakeToken > 0 && shakeToken % 2 === 1}
    class:nudge-b={!reduced && shakeToken > 0 && shakeToken % 2 === 0}
    aria-label="Campo de batalha"
    style:--shake-px="{shakePx}px"
    style:--shake-ms="{shakeMs}ms"
  >
    {@render fxLayer()}
    <!-- Choque da paralisia: dois raiozinhos em pixel art dos lados do corpo. -->
    {#each ['wild', 'player'] as const as side (side)}
      {#if clock < zapUntil[side]}
        {@const at = bodyPoint(side)}
        {#if at}
          <span class="zap" style:left="{at.x}px" style:top="{at.y}px" aria-hidden="true">
            {#each [0, 1] as k (k)}
              <svg class="bolt b{k}" viewBox="0 0 5 8" shape-rendering="crispEdges">
                {#each BOLT_PIXELS as px (`${px.x},${px.y}`)}
                  <rect x={px.x} y={px.y} width="1" height="1" />
                {/each}
              </svg>
            {/each}
          </span>
        {/if}
      {/if}
    {/each}
    <!-- Bola do golpe especial. Cada uma das três (a bola e dois rastros que
         saem um pouco depois) tem duas camadas: .proj anda em linha reta do
         atacante ao alvo e .proj-arc sobe e desce, o que desenha a curva. -->
    {#each projectiles as shot (shot.uid)}
      {#each [2, 1, 0] as lag (lag)}
        <div
          class="proj"
          class:big={shot.big}
          aria-hidden="true"
          style:--x0="{shot.from.x}px"
          style:--y0="{shot.from.y}px"
          style:--x1="{shot.to.x}px"
          style:--y1="{shot.to.y}px"
          style:--c={shot.color}
          style:--ms="{shot.ms}ms"
          style:--lag="{lag * PROJ_TRAIL_MS}ms"
          style:--size={1 - lag * 0.25}
          style:opacity={1 - lag * 0.3}
        >
          <span class="proj-arc">
            <svg class="orb" viewBox="0 0 8 8" shape-rendering="crispEdges">
              {#each ORB_PIXELS as px (`${px.x},${px.y}`)}
                <rect x={px.x} y={px.y} width="1" height="1" class="o{px.tone}" />
              {/each}
            </svg>
          </span>
        </div>
      {/each}
    {/each}
    {#if chargedFx && !reduced}
      <div class="charged-veil" aria-hidden="true"></div>
      <p class="charged-banner" style:--glow={chargedFx.color}>{chargedFx.name}</p>
    {/if}
    <div class="plate wild-plate">
      <span class="who">
        <b>{encounter.displayName}{#if encounter.isShiny} ★{/if}</b>
        {#if statusSeal(snap.wild.status)}
          {@const seal = statusSeal(snap.wild.status)!}
          <span class="seal {seal.tone}" class:pop={!reduced}>{seal.code}</span>
        {/if}
        {#if snap.wild.confused}<span class="seal conf" class:pop={!reduced}>CNF</span>{/if}
        <small>Nv {wildFighter.level}</small>
      </span>
      <span role="progressbar" aria-label="HP do selvagem" aria-valuemin="0" aria-valuemax={snap.wild.maxHp} aria-valuenow={snap.wild.hp}>
        {@render bar(wildPercent, wildTrail, hpTone(wildPercent))}
      </span>
    </div>

    <div class="slot wild" bind:this={wildSlotEl} style:--dx="-22px" style:--dy="16px">
      <div
        class="body {wildView.css}"
        class:down={snap.wild.fainted}
        class:hit-flash={flashSide === 'wild'}
        class:type-glow={chargedFx?.side === 'wild'}
        class:tone-burn={snap.wild.status === 'burn'}
        class:tone-freeze={snap.wild.status === 'freeze'}
        class:zapped={clock < zapUntil.wild}
        class:asleep={snap.wild.status === 'sleep'}
        style:--glow={chargedFx?.side === 'wild' ? chargedFx.color : 'transparent'}
      >
        {#if wildLook.kind === 'pmd'}
          <div class="anchor">
            <PmdSprite
              speciesId={encounter.speciesId}
              shiny={wildLook.shinySheet}
              anim={wildView.anim}
              dir={7}
              scale={spriteScale}
              time={wildView.time}
              shadow={wildLook.shadow}
            />
          </div>
        {:else}
          <img class="gif" src={showdownSrc(encounter.speciesId, encounter.isShiny)} alt="" />
        {/if}
        {#if snap.wild.status === 'sleep' && !reduced}<span class="zzz" aria-hidden="true">Zzz</span>{/if}
      </div>
      {#each floaters.filter((f) => f.side === 'wild') as f (f.id)}
        <span
          class="float"
          class:heal={f.heal}
          class:charged={f.charged}
          class:super={f.effectiveness !== undefined && f.effectiveness > 1}
          class:resist={f.effectiveness !== undefined && f.effectiveness > 0 && f.effectiveness < 1}
          class:burn={f.tone === 'burn'}
          class:poison={f.tone === 'poison'}
          class:recoil={f.tone === 'recoil'}
          class:confusion={f.tone === 'confusion'}
        >
          {f.text}
          {#if f.note}<small>{f.note}</small>{/if}
        </span>
      {/each}
    </div>

    <div class="slot ally" bind:this={allySlotEl} style:--dx="22px" style:--dy="-16px">
      <div
        class="body {allyView.css} {switchCss}"
        class:down={active.fainted && switchFx?.phase !== 'out'}
        class:hit-flash={flashSide === 'player'}
        class:type-glow={chargedFx?.side === 'player'}
        class:tone-burn={active.status === 'burn' && switchFx?.phase !== 'out'}
        class:tone-freeze={active.status === 'freeze' && switchFx?.phase !== 'out'}
        class:zapped={clock < zapUntil.player}
        class:asleep={active.status === 'sleep' && switchFx?.phase !== 'out'}
        style:--glow={chargedFx?.side === 'player' ? chargedFx.color : 'transparent'}
      >
        {#if allyLook.kind === 'pmd'}
          <div class="anchor">
            <PmdSprite
              speciesId={allyShowSpecies}
              shiny={allyLook.shinySheet}
              anim={switchFx ? 'Idle' : allyView.anim}
              dir={3}
              scale={spriteScale}
              time={switchFx ? idleTime : allyView.time}
              shadow={allyLook.shadow}
            />
          </div>
        {:else}
          <img class="gif flip" src={showdownSrc(allyShowSpecies, allyShowShiny)} alt="" />
        {/if}
        {#if active.status === 'sleep' && !reduced && switchFx?.phase !== 'out'}
          <span class="zzz" aria-hidden="true">Zzz</span>
        {/if}
      </div>
      {#each floaters.filter((f) => f.side === 'player') as f (f.id)}
        <span
          class="float"
          class:heal={f.heal}
          class:charged={f.charged}
          class:super={f.effectiveness !== undefined && f.effectiveness > 1}
          class:resist={f.effectiveness !== undefined && f.effectiveness > 0 && f.effectiveness < 1}
          class:burn={f.tone === 'burn'}
          class:poison={f.tone === 'poison'}
          class:recoil={f.tone === 'recoil'}
          class:confusion={f.tone === 'confusion'}
        >
          {f.text}
          {#if f.note}<small>{f.note}</small>{/if}
        </span>
      {/each}
    </div>

    <div class="plate ally-plate">
      <span class="who">
        <b>{nameOf(activeFighter)}{#if allyShiny} ★{/if}</b>
        {#if status === 'live' && statusSeal(active.status)}
          {@const seal = statusSeal(active.status)!}
          <span class="seal {seal.tone}" class:pop={!reduced}>{seal.code}</span>
        {/if}
        {#if status === 'live' && active.confused}<span class="seal conf" class:pop={!reduced}>CNF</span>{/if}
        <small>Nv {xpHud?.level ?? activeFighter.level}</small>
      </span>
      <div class="bars">
        <span role="progressbar" aria-label="HP do seu Pokémon" aria-valuemin="0" aria-valuemax={active.maxHp} aria-valuenow={active.hp}>
          {@render bar(allyPercent, allyTrail, hpTone(allyPercent))}
        </span>
        {#if xpHud && xpHud.need !== null}
          <span
            class="xp-track"
            class:pulse={status === 'celebrating'}
            role="progressbar"
            aria-label="XP do seu Pokémon"
            aria-valuemin="0"
            aria-valuemax={xpHud.need}
            aria-valuenow={Math.round(xpHud.xp)}
          >
            <span class="xp-fill" style:transform="scaleX({xpFill / 100})"></span>
          </span>
        {/if}
      </div>
      <small class="hp-text">{active.hp}/{active.maxHp}</small>
    </div>
  </div>

  {#if status === 'offline'}
    <p class="note bad" role="alert">Sem conexão. A luta está guardada.</p>
    <button type="button" class="btn btn-primary retry" onclick={retryFinish}>Tentar de novo</button>
  {:else if showRecap}
    <!-- No lugar dos golpes/troca: caixa de texto da pós-luta (estilo jogos). -->
    <button
      type="button"
      class="recap"
      onclick={onRecapTap}
      disabled={status === 'finishing' || recapBusy}
      aria-live="polite"
      aria-label={recapLine}
    >
      <p>{recapLine}</p>
      {#if recapHint && !recapBusy}<small>Toque</small>{/if}
    </button>
  {:else}
    <!-- Sem golpe carregado, o botão nem aparece e o rápido ocupa a linha.
         Escolhendo a troca, os golpes saem para o time caber na tela. -->
    <div class="moves" class:solo={!activeFighter.chargedMove} hidden={partyOpen}>
      <button
        type="button"
        class="btn act typed"
        style:--type={typeColor(activeFighter.fastMove.type)}
        style:--type-ink={typeInk(activeFighter.fastMove.type)}
        class:white-ink={typeInk(activeFighter.fastMove.type) === '#ffffff'}
        disabled={!canAct}
        aria-label={lockLabel ?? moveLabel(activeFighter.fastMove.name)}
        onclick={() => manual('fast')}
      >
        <span class="cd" style:transform="scaleX({cdFill})" aria-hidden="true"></span>
        <span class="label">
          {#if !lockLabel}<TypeIcon type={activeFighter.fastMove.type} />{/if}
          <span class="move-name {nameFit(fastText)}">{fastText}</span>
        </span>
      </button>
      {#if activeFighter.chargedMove && chargedCost !== null}
        <button
          type="button"
          class="btn act charged typed"
          class:ready={chargeReady}
          style:--type={typeColor(activeFighter.chargedMove.type)}
          style:--type-ink={typeInk(activeFighter.chargedMove.type)}
          class:white-ink={typeInk(activeFighter.chargedMove.type) === '#ffffff'}
          disabled={!canCharged}
          aria-label={lockLabel ?? moveLabel(activeFighter.chargedMove.name)}
          onclick={() => manual('charged')}
        >
          <!-- Cada golpe rápido enche o botão de baixo para cima. -->
          <span class="charge" style:transform="scaleY({chargeFill})" aria-hidden="true"></span>
          {#if chargeReady}<span class="cd" style:transform="scaleX({cdFill})" aria-hidden="true"></span>{/if}
          <span class="label">
            {#if !lockLabel}<TypeIcon type={activeFighter.chargedMove.type} />{/if}
            <span class="move-name {nameFit(chargedText)}">{chargedText}</span>
          </span>
        </button>
      {/if}
    </div>

    {#if setup.team.length > 1}
      {#if !partyOpen}
        <button
          type="button"
          class="btn party-toggle"
          disabled={!canSwitch}
          aria-expanded="false"
          onclick={openParty}
        >
          {#if switchWait > 0}
            Trocar ({Math.ceil(switchWait / 1000)}s)
          {:else}
            Trocar Pokémon
          {/if}
        </button>
      {:else}
        <div class="party" role="group" aria-label="Escolher Pokémon">
          <div class="party-list">
            {#each setup.team as fighter, slot (slot)}
              {@const side = snap.team[slot]!}
              {@const here = slot === snap.activeSlot}
              {@const mon = monOf(fighter.id)}
              {@const look = gardenSprite(fighter.speciesId, mon?.isShiny ?? false)}
              {#if !here}
                <button
                  type="button"
                  class="chip"
                  class:down={side.fainted}
                  disabled={side.fainted || !canSwitch}
                  aria-label="Trocar para {nameOf(fighter)}"
                  onclick={() => swap(slot)}
                >
                  <span class="chip-sprite" aria-hidden="true">
                    {#if look.kind === 'pmd'}
                      <!-- Caixa baixa + overflow: corta a folga transparente em cima do quadro. -->
                      <span class="chip-anchor">
                        <PmdSprite
                          speciesId={fighter.speciesId}
                          shiny={look.shinySheet}
                          anim="Idle"
                          dir={0}
                          scale={chipScale}
                          time={idleTime}
                          shadow={0}
                        />
                      </span>
                    {:else}
                      <img src={showdownSrc(fighter.speciesId, mon?.isShiny ?? false)} alt="" />
                    {/if}
                  </span>
                  <span class="chip-info">
                    <span class="chip-name">{nameOf(fighter)}</span>
                    <span class="chip-meta">
                      {#if side.fainted}Caiu{:else}Nv {fighter.level}{/if}
                    </span>
                    {@render bar(hpPercent(side), hpPercent(side), hpTone(hpPercent(side)))}
                  </span>
                </button>
              {/if}
            {/each}
          </div>
          <button type="button" class="btn-link party-cancel" onclick={closeParty}>Cancelar</button>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  /* No PC a arena esticava na tela toda e os dois ficavam longe um do outro:
     largura de celular, centralizada. */
  .live {
    /* Cores dos selos e dos números de dano (um lugar só). */
    --seal-burn: #c04020;
    --seal-poison: #7040a0;
    --seal-para: #c0a020;
    --seal-sleep: #4868a8;
    --seal-freeze: #58b0c8;
    --seal-conf: #a05078;
    --dmg-heal: #6ecf5a;
    --dmg-recoil: #8a8a8a;
    width: min(100%, 30rem);
    margin: 0 auto;
    display: grid;
    gap: 0.5rem;
    user-select: none;
    -webkit-user-select: none;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .timer {
    min-width: 4.5rem;
    font-size: 1.5rem;
    font-weight: 700;
  }

  .timer.late {
    color: var(--danger);
  }

  .top-actions {
    display: flex;
    gap: 0.35rem;
  }

  .top-actions .btn {
    padding: 0 0.6rem;
  }

  .auto,
  .speed {
    min-height: 48px;
  }

  .auto.on,
  .speed.on {
    background: var(--primary);
    color: #fff;
    text-shadow: 0 var(--px) 0 var(--primary-shade);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -3px 0 var(--primary-shade);
  }

  .arena {
    position: relative;
    height: 14rem;
    overflow: hidden;
    background: linear-gradient(to bottom, var(--sky) 0 46%, var(--grass-1) 46% 100%);
    box-shadow: inset 0 0 0 var(--px) #00000022;
  }

  .arena.nudge-a {
    animation: arena-shake-a var(--shake-ms, 150ms) ease-out;
  }

  .arena.nudge-b {
    animation: arena-shake-b var(--shake-ms, 150ms) ease-out;
  }

  .proj {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 4;
    pointer-events: none;
    animation: proj-line var(--ms) linear var(--lag) both;
  }

  .proj-arc {
    position: absolute;
    left: 0;
    top: 0;
    animation: proj-arc var(--ms) var(--lag) both;
  }

  /* 8 px de grade × 2 = 16 px; no carregado, 3× (24 px). O centro fica no ponto. */
  .orb {
    position: absolute;
    left: -8px;
    top: -8px;
    width: 16px;
    height: 16px;
    transform: scale(var(--size, 1));
    filter: drop-shadow(0 0 3px var(--c));
  }

  .proj.big .orb {
    left: -12px;
    top: -12px;
    width: 24px;
    height: 24px;
  }

  .orb .od {
    fill: color-mix(in srgb, var(--c) 55%, #000);
  }

  .orb .om {
    fill: var(--c);
  }

  .orb .ol {
    fill: color-mix(in srgb, var(--c) 45%, #fff);
  }

  .orb .ow {
    fill: #fff;
  }

  @keyframes proj-line {
    from {
      transform: translate(var(--x0), var(--y0));
    }
    to {
      transform: translate(var(--x1), var(--y1));
    }
  }

  /* Sobe desacelerando e desce acelerando: com a linha reta, uma curva. */
  @keyframes proj-arc {
    0% {
      transform: translateY(0);
      animation-timing-function: ease-out;
    }
    50% {
      transform: translateY(-16px);
      animation-timing-function: ease-in;
    }
    100% {
      transform: translateY(0);
    }
  }

  .charged-veil {
    position: absolute;
    inset: 0;
    z-index: 4;
    background: #00000055;
    pointer-events: none;
    animation: veil-in 0.55s ease-out both;
  }

  .charged-banner {
    position: absolute;
    left: 0;
    right: 0;
    top: 42%;
    z-index: 5;
    margin: 0;
    padding: 0.35rem 0.5rem;
    background: color-mix(in srgb, var(--glow, #fff) 35%, #000000cc);
    color: #fff;
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-align: center;
    text-transform: uppercase;
    pointer-events: none;
    animation: banner-sweep 0.55s ease-out both;
  }

  .live.ending .arena::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 6;
    background: #fff;
    opacity: 0;
    pointer-events: none;
    animation: end-flash 0.5s ease-out both;
  }

  .slot {
    position: absolute;
    width: 7rem;
    height: 6.5rem;
  }

  .slot.wild {
    top: 0.4rem;
    right: 0.6rem;
  }

  .slot.ally {
    bottom: 0.3rem;
    left: 0.6rem;
  }

  .body {
    position: absolute;
    inset: 0;
    transition: opacity 0.4s;
  }

  .body.down {
    opacity: 0.45;
  }

  /* Status: tom no sprite (filho), como o hit-flash. */
  .body.tone-burn:not(.hit-flash) > .anchor,
  .body.tone-burn:not(.hit-flash) > .gif {
    filter: sepia(0.45) hue-rotate(-20deg) saturate(1.7);
  }

  .body.tone-freeze:not(.hit-flash) > .anchor,
  .body.tone-freeze:not(.hit-flash) > .gif {
    filter: sepia(0.35) hue-rotate(160deg) saturate(1.15) brightness(1.08);
  }

  /* Acerto: o sprite inteiro fica branco por um instante (flash de pixel art).
     O filtro fica no filho, porque o .body já usa filter nas animações de dano. */
  .body.hit-flash > .anchor,
  .body.hit-flash > .gif {
    filter: brightness(0) invert(1);
  }

  /* Golpe carregado: contorno na cor do tipo do golpe. */
  .body.type-glow:not(.hit-flash) > .anchor,
  .body.type-glow:not(.hit-flash) > .gif {
    filter: drop-shadow(0 0 2px var(--glow)) drop-shadow(0 0 4px var(--glow));
  }

  /* Paralisia: o sprite pisca amarelo (3 vezes por pulso; filtro no filho,
     como o hit-flash) e dois raiozinhos piscam dos lados do corpo. */
  .body.zapped:not(.hit-flash) > .anchor,
  .body.zapped:not(.hit-flash) > .gif {
    animation: zap-blink 0.36s steps(1, end);
  }

  .zap {
    position: absolute;
    z-index: 2;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .bolt {
    position: absolute;
    width: 20px;
    height: 32px;
    fill: #ffe14d;
    filter: drop-shadow(0 0 2px #fff6a8);
    animation: zap-blink-bolt 0.36s steps(1, end) both;
  }

  .bolt.b0 {
    left: -38px;
    top: -34px;
  }

  .bolt.b1 {
    left: 18px;
    top: -10px;
    transform: scaleX(-1);
    animation-delay: 0.06s;
  }

  @keyframes zap-blink {
    0%,
    34%,
    68% {
      filter: sepia(1) saturate(6) hue-rotate(5deg) brightness(1.35);
    }
    17%,
    51%,
    85% {
      filter: none;
    }
  }

  @keyframes zap-blink-bolt {
    0%,
    34%,
    68% {
      opacity: 1;
    }
    17%,
    51%,
    85%,
    100% {
      opacity: 0;
    }
  }

  /* Posição (left/top em px da arena) vem de fxPoint. Mesmo z dos números de
     dano (.float), que vêm depois no DOM: o número fica por cima do efeito. */
  .fx-anchor {
    position: absolute;
    z-index: 2;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .zzz {
    position: absolute;
    left: 58%;
    top: 8%;
    z-index: 4;
    font-size: 0.85rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: #dfe8ff;
    text-shadow:
      0 var(--px) 0 var(--ink),
      0 calc(var(--px) * -1) 0 var(--ink),
      var(--px) 0 0 var(--ink),
      calc(var(--px) * -1) 0 0 var(--ink);
    pointer-events: none;
    animation: zzz-rise 1.6s ease-out infinite;
  }

  @keyframes zzz-rise {
    0% {
      transform: translate(0, 0);
      opacity: 0;
    }
    20% {
      opacity: 1;
    }
    100% {
      transform: translate(10px, -22px);
      opacity: 0;
    }
  }

  /* Ponto do chão: o PmdSprite se posiciona a partir daqui. */
  .anchor {
    position: absolute;
    left: 50%;
    bottom: 0.75rem;
    width: 0;
    height: 0;
  }

  .gif {
    position: absolute;
    left: 50%;
    bottom: 0.25rem;
    width: 80px;
    height: 80px;
    margin-left: -40px;
    object-fit: contain;
    object-position: bottom;
    image-rendering: pixelated;
  }

  .gif.flip {
    transform: scaleX(-1);
  }

  .plate {
    position: absolute;
    display: grid;
    gap: 0.15rem;
    width: 9.5rem;
    box-sizing: border-box;
    padding: 0.3rem 0.45rem;
    background: #f8f8f8e6;
    box-shadow: inset 0 0 0 var(--px) var(--panel-edge);
  }

  .wild-plate {
    top: 0.4rem;
    left: 0.4rem;
  }

  .ally-plate {
    right: 0.4rem;
    bottom: 0.4rem;
  }

  .who {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.3rem;
    font-size: 0.9rem;
    flex-wrap: wrap;
  }

  .who b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .who small,
  .hp-text {
    font-size: 0.8rem;
    font-weight: 600;
  }

  /* HP + XP colados, como no HUD clássico. */
  .bars {
    display: grid;
    gap: 0;
  }

  .xp-track {
    position: relative;
    display: block;
    height: 4px;
    overflow: hidden;
    background: #00000028;
    box-shadow: inset 0 0 0 var(--px) var(--ink);
  }

  .xp-track.pulse {
    box-shadow:
      inset 0 0 0 var(--px) var(--ink),
      0 0 0 1px #4aa3e055;
  }

  .xp-fill {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    transform-origin: left center;
    background: #4aa3e0;
    box-shadow: inset 0 calc(var(--px) * -1) 0 #2f7bb0;
    will-change: transform;
  }

  .seal {
    flex: 0 0 auto;
    padding: 0.05rem 0.25rem;
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    line-height: 1.2;
    color: #fff;
    background: #666;
  }

  .seal.pop {
    animation: seal-pop 220ms ease-out;
  }

  .seal.burn {
    background: var(--seal-burn);
  }
  .seal.poison {
    background: var(--seal-poison);
  }
  .seal.para {
    background: var(--seal-para);
    color: #1a1208;
  }
  .seal.sleep {
    background: var(--seal-sleep);
  }
  .seal.freeze {
    background: var(--seal-freeze);
    color: #0e2030;
  }
  .seal.conf {
    background: var(--seal-conf);
  }

  @keyframes seal-pop {
    from {
      transform: scale(0.7);
      opacity: 0.4;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .seal.pop {
      animation: none;
    }

    .zzz {
      animation: none;
      opacity: 0.85;
    }
  }

  .hp-text {
    text-align: right;
  }

  .hp-track {
    position: relative;
    display: block;
    height: 0.6rem;
    background: #00000030;
    box-shadow: inset 0 0 0 var(--px) var(--ink);
    overflow: hidden;
  }

  .hp-trail,
  .hp-fill {
    position: absolute;
    inset: 0;
    display: block;
    height: 100%;
    width: 100%;
    transform-origin: left center;
    will-change: transform;
  }

  /* Branco: lê contra vida verde, amarela (--accent) e vermelha. */
  .hp-trail {
    background: #fff8e8;
    transition: transform 0.28s linear;
  }

  .hp-fill {
    transition: none;
  }

  .hp-fill.ok {
    background: var(--grass-side);
  }

  .hp-fill.mid {
    background: var(--accent);
  }

  .hp-fill.low {
    background: var(--danger);
  }

  .float {
    position: absolute;
    left: 50%;
    top: 0.5rem;
    z-index: 2;
    display: grid;
    justify-items: center;
    gap: 0.05rem;
    font-size: 1.35rem;
    font-weight: 700;
    color: #fff;
    text-shadow:
      0 var(--px) 0 var(--ink),
      0 calc(var(--px) * -1) 0 var(--ink),
      var(--px) 0 0 var(--ink),
      calc(var(--px) * -1) 0 0 var(--ink);
    pointer-events: none;
    animation: rise 1s ease-out both;
  }

  /* O selvagem fica colado no topo da arena, que corta o que passa da borda:
     o número dele nasce mais embaixo para dar tempo de subir à vista. */
  .slot.wild .float {
    top: 2.6rem;
  }

  .float small {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .float.heal {
    color: var(--dmg-heal);
  }

  .float.burn {
    color: var(--seal-burn);
  }

  .float.poison {
    color: var(--seal-poison);
  }

  .float.recoil {
    color: var(--dmg-recoil);
  }

  .float.confusion {
    color: var(--seal-conf);
  }

  .float.charged {
    font-size: 1.7rem;
    animation-name: rise-pop;
  }

  .float.super {
    color: #ffb347;
  }

  .float.super small {
    color: #ffd27a;
  }

  .float.resist {
    font-size: 1.05rem;
    opacity: 0.72;
    color: #c8c8c8;
  }

  .float.resist small {
    color: #b0b0b0;
  }

  .note {
    margin: 0;
    font-weight: 600;
    text-align: center;
  }

  .note.bad {
    color: var(--danger);
  }

  .retry {
    width: 100%;
  }

  .recap {
    display: grid;
    gap: 0.35rem;
    width: 100%;
    min-height: 5.5rem;
    margin: 0;
    padding: 0.85rem 1rem;
    border: 0;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    touch-action: manipulation;
    background: #f8f8f8e6;
    box-shadow: inset 0 0 0 var(--px) var(--panel-edge);
  }

  .recap:disabled {
    cursor: default;
    opacity: 1;
  }

  .recap p {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1.35;
  }

  .recap small {
    font-size: 0.75rem;
    font-weight: 600;
    opacity: 0.55;
    justify-self: end;
  }

  .moves {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  /* O display: grid acima venceria o atributo hidden. */
  .moves[hidden] {
    display: none;
  }

  .moves.solo {
    grid-template-columns: 1fr;
  }

  /* Energia do carregado: enche o botão de baixo para cima. */
  .charge {
    position: absolute;
    inset: 0;
    transform-origin: center bottom;
    background: #f8d03099;
    pointer-events: none;
  }

  .act.charged.ready {
    background: var(--primary);
    color: #fff;
    text-shadow: 0 var(--px) 0 var(--primary-shade);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -3px 0 var(--primary-shade);
    animation: ready-pulse 0.8s steps(2, jump-none) infinite alternate;
  }

  .act.charged.ready .charge {
    background: transparent;
  }

  /* Carregando: não aceita toque, mas não pode acinzentar, senão o
     enchimento amarelo some. */
  .act.charged:disabled:not(.ready) {
    filter: none;
    color: var(--ink-soft);
  }

  @keyframes ready-pulse {
    to {
      filter: brightness(1.15);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .act.charged.ready {
      animation: none;
    }
  }

  .act {
    position: relative;
    flex-direction: column;
    gap: 0.2rem;
    min-height: 64px;
    overflow: hidden;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .act {
    padding-left: 0.25rem;
    padding-right: 0.25rem;
  }

  .act .label {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    max-width: 100%;
    font-size: 1.05rem;
  }

  /* Nome do golpe: quebra entre palavras (até 2 linhas) e encolhe quando a
     maior palavra não cabe (nameFit). */
  .act .move-name {
    display: -webkit-box;
    min-width: 0;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    line-height: 1.15;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .act .move-name.small {
    font-size: 0.85rem;
  }

  .act .move-name.tiny {
    font-size: 0.72rem;
  }

  /* Golpe com a cor e o ícone do tipo (Fogo vermelho-laranja, Água azul...). */
  .act.typed {
    background: var(--type);
    color: var(--type-ink);
    text-shadow: none;
    box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--type) 62%, #000);
  }

  /* Texto branco ganha sombra do próprio tipo, como o botão primário. */
  .act.typed.white-ink {
    text-shadow: 0 var(--px) 0 color-mix(in srgb, var(--type) 55%, #000);
  }

  /* Rápido esperando o próximo golpe: continua com a cor do tipo, só apagado. */
  .act.typed:disabled {
    filter: saturate(0.55) brightness(0.92);
  }

  /* Carregado enchendo: fundo claro do tipo, e a carga sobe na cor cheia. */
  .act.charged.typed:not(.ready) {
    background: color-mix(in srgb, var(--type) 28%, var(--panel-face));
    color: var(--ink);
    text-shadow: none;
  }

  .act.charged.typed:not(.ready) .charge {
    background: color-mix(in srgb, var(--type) 80%, transparent);
  }

  .act.charged.typed:disabled:not(.ready) {
    filter: none;
    color: var(--ink);
  }

  .act.charged.typed.ready {
    background: var(--type);
    color: var(--type-ink);
    box-shadow:
      inset 0 0 0 2px var(--selected-ring),
      inset 0 -3px 0 color-mix(in srgb, var(--type) 62%, #000);
  }

  /* Espera até poder golpear de novo: enche da esquerda para a direita. */
  .cd {
    position: absolute;
    inset: 0;
    transform-origin: left center;
    background: #a0a0a866;
    pointer-events: none;
  }

  .act.charged .cd {
    background: #3f8fc444;
  }

  .party-toggle {
    width: 100%;
  }

  .party {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.35rem;
    min-height: 0;
  }

  /* Até 5 para trocar (time de 6): duas colunas, para caber no celular. */
  .party-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: max-content;
    gap: 0.4rem;
    max-height: min(30vh, 7.4rem);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding-right: 0.1rem;
  }

  .party-cancel {
    justify-self: center;
    min-height: 44px;
  }

  .chip {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 0.35rem;
    align-items: center;
    box-sizing: border-box;
    min-width: 0;
    min-height: 52px;
    padding: 0.25rem 0.4rem;
    border: 2px solid var(--panel-edge);
    background: var(--panel-face);
    box-shadow: inset 0 -2px 0 var(--panel-shade);
    color: var(--ink);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .chip:active:not(:disabled) {
    box-shadow: inset 0 2px 0 #00000022;
    transform: translateY(var(--px));
    background: var(--paper);
  }

  .chip.down,
  .chip:disabled {
    cursor: default;
    filter: grayscale(1) opacity(0.55);
  }

  .chip-sprite {
    position: relative;
    width: 36px;
    height: 40px;
    overflow: hidden;
    pointer-events: none;
  }

  .chip-anchor {
    position: absolute;
    left: 50%;
    bottom: 3px;
    width: 0;
    height: 0;
  }

  .chip-sprite img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: bottom;
    image-rendering: pixelated;
  }

  .chip-info {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }

  .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85rem;
  }

  .chip-meta {
    font-size: 0.8rem;
  }

  @keyframes rise {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  /* Só com movimento liberado: o número sobe, o sprite avança, treme e cai. */
  @media (prefers-reduced-motion: no-preference) {
    .float {
      animation-name: rise-move;
    }

    .float.charged {
      animation-name: rise-pop;
    }

    .body.lunge-0 {
      animation: lunge-a 0.32s ease-out;
    }

    .body.lunge-1 {
      animation: lunge-b 0.32s ease-out;
    }

    .body.hurt-0 {
      animation: hurt-a 0.45s steps(6, end);
    }

    .body.hurt-1 {
      animation: hurt-b 0.45s steps(6, end);
    }

    .body.recall-0,
    .body.recall-1 {
      animation: recall 0.28s ease-in both;
    }

    .body.sendout-0,
    .body.sendout-1 {
      animation: sendout 0.32s ease-out both;
    }

    .body.faint-0,
    .body.faint-1,
    .body.faint-end {
      animation: faint 0.6s ease-in both;
    }

    .live.ending .body.faint-0,
    .live.ending .body.faint-1,
    .live.ending .body.faint-end {
      animation: faint-slow 1.1s ease-in both;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .arena.nudge-a,
    .arena.nudge-b,
    .charged-veil,
    .charged-banner,
    .live.ending .arena::after {
      animation: none !important;
    }

    .hp-trail {
      transition: none;
    }
  }

  @keyframes rise-move {
    from {
      transform: translate(-50%, 0);
      opacity: 1;
    }
    to {
      transform: translate(-50%, -2rem);
      opacity: 0;
    }
  }

  @keyframes rise-pop {
    0% {
      transform: translate(-50%, 0.4rem) scale(0.6);
      opacity: 0;
    }
    35% {
      transform: translate(-50%, -0.4rem) scale(1.25);
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -2.4rem) scale(1);
      opacity: 0;
    }
  }

  /* Dois nomes iguais por dentro: trocar o nome da animação é o que faz o
     navegador repetir a tremida a cada golpe. */
  @keyframes arena-shake-a {
    0%,
    100% {
      transform: translate(0, 0);
    }
    20% {
      transform: translate(var(--shake-px), calc(var(--shake-px) * -0.5));
    }
    45% {
      transform: translate(calc(var(--shake-px) * -1), var(--shake-px));
    }
    70% {
      transform: translate(calc(var(--shake-px) * 0.5), calc(var(--shake-px) * -0.5));
    }
  }

  @keyframes arena-shake-b {
    0%,
    100% {
      transform: translate(0, 0);
    }
    20% {
      transform: translate(var(--shake-px), calc(var(--shake-px) * -0.5));
    }
    45% {
      transform: translate(calc(var(--shake-px) * -1), var(--shake-px));
    }
    70% {
      transform: translate(calc(var(--shake-px) * 0.5), calc(var(--shake-px) * -0.5));
    }
  }

  @keyframes veil-in {
    0% {
      opacity: 0;
    }
    25% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  @keyframes banner-sweep {
    0% {
      transform: translateX(-12%) scaleX(0.85);
      opacity: 0;
    }
    30% {
      transform: translateX(0) scaleX(1);
      opacity: 1;
    }
    100% {
      transform: translateX(8%) scaleX(1);
      opacity: 0;
    }
  }

  @keyframes end-flash {
    0% {
      opacity: 0.55;
    }
    100% {
      opacity: 0;
    }
  }

  @keyframes faint-slow {
    to {
      transform: translateY(28px);
      opacity: 0.3;
    }
  }

  @keyframes lunge-a {
    50% {
      transform: translate(var(--dx), var(--dy));
    }
  }

  @keyframes lunge-b {
    50% {
      transform: translate(var(--dx), var(--dy));
    }
  }

  @keyframes hurt-a {
    17% {
      transform: translateX(-4px);
      filter: brightness(2);
    }
    34% {
      transform: translateX(4px);
      opacity: 0.4;
    }
    50% {
      transform: translateX(-3px);
      filter: brightness(2);
      opacity: 1;
    }
    67% {
      transform: translateX(3px);
      opacity: 0.4;
    }
    84% {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes hurt-b {
    17% {
      transform: translateX(-4px);
      filter: brightness(2);
    }
    34% {
      transform: translateX(4px);
      opacity: 0.4;
    }
    50% {
      transform: translateX(-3px);
      filter: brightness(2);
      opacity: 1;
    }
    67% {
      transform: translateX(3px);
      opacity: 0.4;
    }
    84% {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes recall {
    from {
      transform: translate(0, 0) scale(1);
      opacity: 1;
    }
    to {
      transform: translate(0, 28px) scale(0.3);
      opacity: 0;
    }
  }

  @keyframes sendout {
    from {
      transform: translate(0, 24px) scale(0.3);
      opacity: 0;
    }
    to {
      transform: translate(0, 0) scale(1);
      opacity: 1;
    }
  }

  @keyframes faint {
    to {
      transform: translateY(20px);
      opacity: 0.35;
    }
  }
</style>
