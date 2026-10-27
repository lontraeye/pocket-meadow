<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { api, type BattleOutcome, type BattleStart, type OwnedPokemon, type PendingEncounter } from './api'
  import { clearSavedBattle, saveBattleProgress } from './battlePersist'
  import { prefersReducedMotion } from './highlights'
  import PmdSprite from './PmdSprite.svelte'
  import {
    autoReactionSeed,
    chargedEnergyCost,
    fastEnergyGain,
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
  import { battleAnimChoice, gardenSprite, pmdAnim, pmdHasAnim, showdownSrc, type PmdAnimName } from './sprites'
  import { formatCountdown } from './time'

  // Luta ao vivo (8.3). A tela re-simula `runBattle({ untilMs })` com os inputs
  // do jogador, mas só quando algo pode ter mudado: um toque (input novo) ou o
  // próximo instante em que o selvagem pode agir. Entre dois eventos o
  // snapshot continua valendo (HP e energia só mudam em eventos); o
  // requestAnimationFrame cuida só do relógio da interface (cooldowns, anims).

  // Juice visual (parte 1): só transform/opacity; não atrasa a simulação.
  const HIT_FLASH_MS = 120
  const SHAKE_FAST_MS = 150
  const SHAKE_CHARGED_MS = 220
  const SHAKE_PX_FAST = 2
  const SHAKE_PX_CHARGED = 4
  const CHARGED_BANNER_MS = 550
  const FAINT_SLOW_MS = 1100
  const FAINT_LINGER_MS = 900
  const HP_TRAIL_HOLD_MS = 90
  const HP_TRAIL_MS = 280
  const FLOAT_MS = 1000

  const TYPE_GLOW: Record<string, string> = {
    normal: '#a8a878',
    fire: '#f08030',
    water: '#6890f0',
    electric: '#f8d030',
    grass: '#78c850',
    ice: '#98d8d8',
    fighting: '#c03028',
    poison: '#a040a0',
    ground: '#e0c068',
    flying: '#a890f0',
    psychic: '#f85888',
    bug: '#a8b820',
    rock: '#b8a038',
    ghost: '#705898',
    dragon: '#7038f8',
    dark: '#705848',
    steel: '#b8b8d0',
    fairy: '#ee99ac',
  }

  let {
    start,
    encounter,
    team,
    battleAuto = false,
    initialInputs = [],
    resumeElapsedMs = 0,
    onBattleAuto,
    onFinished,
    onError,
  }: {
    start: BattleStart
    encounter: PendingEncounter
    /** Pokémon do time (para nome, apelido e shiny); a ordem não importa. */
    team: OwnedPokemon[]
    /** Preferência do treinador (servidor); a tela só espelha e pede troca. */
    battleAuto?: boolean
    initialInputs?: BattleInput[]
    /** Tempo de relógio que já passou ao retomar uma luta interrompida. */
    resumeElapsedMs?: number
    onBattleAuto: (on: boolean) => void
    onFinished: (outcome: BattleOutcome, team: OwnedPokemon[]) => void
    onError: (message: string) => void
  } = $props()

  type Pose = { id: number; start: number; steps: Step[] }
  type Step = { anim: PmdAnimName | null; css: 'lunge' | 'hurt' | 'faint' | null; ms: number }
  type Floater = {
    id: number
    side: 'player' | 'wild'
    text: string
    heal: boolean
    born: number
    charged?: boolean
    effectiveness?: number
    note?: string
  }
  type ChargedFx = { name: string; color: string; side: 'player' | 'wild'; until: number }
  type Status = 'live' | 'finishing' | 'offline'

  const { setup, seed, timeLimit, encounterId } = untrack(() => ({
    setup: start.setup,
    seed: start.seed,
    timeLimit: start.timeLimitMs,
    encounterId: encounter.id,
  }))
  const reduced = prefersReducedMotion()

  const t0 = performance.now() - untrack(() => resumeElapsedMs)
  const startedWall = Date.now() - untrack(() => resumeElapsedMs)
  let inputs: BattleInput[] = untrack(() => [...initialInputs])

  let status = $state<Status>('live')
  let clock = $state(performance.now())
  let floaters = $state.raw<Floater[]>([])
  let allyPose = $state.raw<Pose | null>(null)
  let wildPose = $state.raw<Pose | null>(null)
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
  let lastSimAt = 0
  let nextEventAt = 0
  let poseId = 0
  let floaterId = 0
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
    return Math.min(timeLimit, Math.max(0, Math.floor(now - t0)))
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
  const active = $derived(snap.team[snap.activeSlot] ?? snap.team[0]!)
  const activeFighter = $derived(setup.team[snap.activeSlot] ?? setup.team[0]!)
  const wildFighter = setup.wild

  const chargedCost = $derived(activeFighter.chargedMove ? chargedEnergyCost(activeFighter.chargedMove.power) : null)
  const waitMs = $derived(Math.max(0, active.readyAt - elapsed, snap.switchReadyAt - elapsed))
  const waitTotal = $derived(Math.max(1, active.readyAt - cdFrom, snap.switchReadyAt - cdFrom))
  const cdFill = $derived(waitMs <= 0 ? 1 : Math.max(0, Math.min(1, 1 - waitMs / waitTotal)))
  const canAct = $derived(status === 'live' && !battleAuto && !active.fainted && !snap.wild.fainted && waitMs <= 0)

  // Ao ligar/desligar o Auto, zera o atraso de reação pendente.
  $effect(() => {
    void battleAuto
    autoAt = null
  })
  const canCharged = $derived(
    canAct && chargedCost !== null && active.energy >= chargedCost && activeFighter.chargedMove !== null,
  )
  const switchWait = $derived(Math.max(0, snap.switchReadyAt - elapsed))
  const remaining = $derived(Math.max(0, timeLimit - elapsed))

  const allyMon = $derived(monOf(active.fighterId))
  const allyShiny = $derived(allyMon?.isShiny ?? false)
  const allyLook = $derived(gardenSprite(active.speciesId, allyShiny))
  const wildLook = $derived(gardenSprite(encounter.speciesId, encounter.isShiny))

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

  // ---- Simulação ao vivo -------------------------------------------------

  function commit(next: BattleResult, e: number) {
    const skipFx = !primed || e - lastSimAt > 700 || next.log.length < seen
    if (skipFx) {
      allyPose = null
      wildPose = null
    }
    const startAt = skipFx ? next.log.length : seen
    let slot = 0
    let from = 0
    for (let i = 0; i < next.log.length; i += 1) {
      const event = next.log[i]!
      if (event.kind === 'enter' && event.side === 'player') {
        slot = event.slot
        from = event.t
        if (i >= startAt) allyPose = null
      }
      if (event.kind === 'move' && event.side === 'player') from = event.t
      if (i >= startAt) react(event, slot, next.snapshot.result === 'win' || next.snapshot.result === 'lose')
    }
    seen = next.log.length
    primed = true
    lastSimAt = e
    cdFrom = from
    sim = next
    nextEventAt = nextEventFor(next, e)
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

  function swap(slot: number) {
    const side = snap.team[slot]
    if (!canAct || !side || side.fainted || slot === snap.activeSlot || switchWait > 0) return
    play('tap')
    push('switch', slot)
  }

  function toggleAuto() {
    if (status !== 'live') return
    play('tap')
    onBattleAuto(!battleAuto)
    persist()
  }

  // Automático: toca quando o cooldown libera mais uma reação curta, com a
  // mesma escolha da simulação (carregado se a energia basta, senão rápido).
  // Gera inputs de verdade, então o servidor valida a luta como qualquer outra.
  function autoStep(e: number) {
    if (!battleAuto) return
    const state = sim.snapshot
    const side = state.team[state.activeSlot]
    if (!side || side.fainted || state.wild.fainted || state.result !== null) {
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
    if (chargedFx && now >= chargedFx.until) chargedFx = null
    if (status !== 'live') return
    const e = elapsedAt(now)
    if (e >= nextEventAt) resim(e)
    autoStep(e)
    if (sim.snapshot.result !== null || e >= timeLimit) void finish()
  }

  onMount(() => {
    persist()
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(flashClear)
    }
  })

  // ---- Fim da luta -------------------------------------------------------

  function fail(code: string) {
    status = 'finishing'
    onError(code)
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function finish() {
    if (status !== 'live') return
    status = 'finishing'
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
        await linger
        clearSavedBattle(encounterId)
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
      if (event.side === 'player') play(charged ? 'charged' : 'fast')
      if (charged) showCharged(attacker, event.side, event.moveName)
      poseFor(event.side, attackSteps(attacker, event.side, event.move))
      if (event.damage > 0) {
        play('hit')
        bumpJuice(defenderSide, charged)
        spawnDamage(defenderSide, event.damage, event.effectiveness, charged)
        if (!event.fainted) {
          poseFor(
            defenderSide,
            hurtSteps(defenderSide === 'player' ? setup.team[allySlot]! : wildFighter, defenderSide),
          )
        }
      }
      // Câmera lenta só no desmaio que encerra a luta: o selvagem caiu, ou caiu
      // o último do seu time (não quando ainda há outro para entrar).
      if (event.fainted && ended) endingFaint = true
    } else if (event.kind === 'heal') {
      spawnHeal(event.side, event.amount)
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

  function spawnDamage(side: 'player' | 'wild', damage: number, effectiveness: number, charged: boolean) {
    floaterId += 1
    let note: string | undefined
    if (effectiveness > 1) note = 'Super eficaz!'
    else if (effectiveness > 0 && effectiveness < 1) note = 'Pouco eficaz'
    floaters = [
      ...floaters,
      {
        id: floaterId,
        side,
        text: `-${damage}`,
        heal: false,
        born: performance.now(),
        charged,
        effectiveness,
        note,
      },
    ]
  }

  function spawnHeal(side: 'player' | 'wild', amount: number) {
    floaterId += 1
    floaters = [...floaters, { id: floaterId, side, text: `+${amount}`, heal: true, born: performance.now() }]
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

  // Energia mostrada no próprio botão do carregado: quantos golpes rápidos
  // faltam (a energia vem só deles) e quanto do botão já encheu.
  const chargeNeeded = $derived(
    chargedCost === null ? 0 : Math.ceil(chargedCost / fastEnergyGain(activeFighter.fastMove.power)),
  )
  const chargeDone = $derived(
    chargedCost === null
      ? 0
      : Math.min(chargeNeeded, Math.floor(active.energy / fastEnergyGain(activeFighter.fastMove.power))),
  )
  const chargeFill = $derived(chargedCost === null ? 0 : Math.min(1, active.energy / chargedCost))
  const chargeReady = $derived(chargedCost !== null && active.energy >= chargedCost)
  const wildPercent = $derived(hpPercent(snap.wild))
  const allyPercent = $derived(hpPercent(active))
  const shakePx = $derived(shakeHard ? SHAKE_PX_CHARGED : SHAKE_PX_FAST)
  const shakeMs = $derived(shakeHard ? SHAKE_CHARGED_MS : SHAKE_FAST_MS)

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

<div class="live" class:ending={endingFaint && status === 'finishing'}>
  <div class="top">
    <span class="timer" class:late={remaining < 10_000} aria-label="Tempo restante">{formatCountdown(remaining)}</span>
    <button type="button" class="btn auto" class:on={battleAuto} aria-pressed={battleAuto} disabled={status !== 'live'} onclick={toggleAuto}>
      Auto{battleAuto ? ': ligado' : ''}
    </button>
  </div>

  <div
    class="arena"
    class:nudge-a={!reduced && shakeToken > 0 && shakeToken % 2 === 1}
    class:nudge-b={!reduced && shakeToken > 0 && shakeToken % 2 === 0}
    aria-label="Campo de batalha"
    style:--shake-px="{shakePx}px"
    style:--shake-ms="{shakeMs}ms"
  >
    {#if chargedFx && !reduced}
      <div class="charged-veil" aria-hidden="true"></div>
      <p class="charged-banner" style:--glow={chargedFx.color}>{chargedFx.name}</p>
    {/if}
    <div class="plate wild-plate">
      <span class="who"><b>{encounter.displayName}{#if encounter.isShiny} ★{/if}</b><small>Nv {wildFighter.level}</small></span>
      <span role="progressbar" aria-label="HP do selvagem" aria-valuemin="0" aria-valuemax={snap.wild.maxHp} aria-valuenow={snap.wild.hp}>
        {@render bar(wildPercent, wildTrail, hpTone(wildPercent))}
      </span>
    </div>

    <div class="slot wild" style:--dx="-22px" style:--dy="16px">
      <div
        class="body {wildView.css}"
        class:down={snap.wild.fainted}
        class:hit-flash={flashSide === 'wild'}
        class:type-glow={chargedFx?.side === 'wild'}
        style:--glow={chargedFx?.side === 'wild' ? chargedFx.color : 'transparent'}
      >
        {#if wildLook.kind === 'pmd'}
          <div class="anchor">
            <PmdSprite
              speciesId={encounter.speciesId}
              shiny={wildLook.shinySheet}
              anim={wildView.anim}
              dir={7}
              scale={2}
              time={wildView.time}
              shadow={wildLook.shadow}
            />
          </div>
        {:else}
          <img class="gif" src={showdownSrc(encounter.speciesId, encounter.isShiny)} alt="" />
        {/if}
      </div>
      {#each floaters.filter((f) => f.side === 'wild') as f (f.id)}
        <span
          class="float"
          class:heal={f.heal}
          class:charged={f.charged}
          class:super={f.effectiveness !== undefined && f.effectiveness > 1}
          class:resist={f.effectiveness !== undefined && f.effectiveness > 0 && f.effectiveness < 1}
        >
          {f.text}
          {#if f.note}<small>{f.note}</small>{/if}
        </span>
      {/each}
    </div>

    <div class="slot ally" style:--dx="22px" style:--dy="-16px">
      <div
        class="body {allyView.css}"
        class:down={active.fainted}
        class:hit-flash={flashSide === 'player'}
        class:type-glow={chargedFx?.side === 'player'}
        style:--glow={chargedFx?.side === 'player' ? chargedFx.color : 'transparent'}
      >
        {#if allyLook.kind === 'pmd'}
          <div class="anchor">
            <PmdSprite
              speciesId={active.speciesId}
              shiny={allyLook.shinySheet}
              anim={allyView.anim}
              dir={3}
              scale={2}
              time={allyView.time}
              shadow={allyLook.shadow}
            />
          </div>
        {:else}
          <img class="gif flip" src={showdownSrc(active.speciesId, allyShiny)} alt="" />
        {/if}
      </div>
      {#each floaters.filter((f) => f.side === 'player') as f (f.id)}
        <span
          class="float"
          class:heal={f.heal}
          class:charged={f.charged}
          class:super={f.effectiveness !== undefined && f.effectiveness > 1}
          class:resist={f.effectiveness !== undefined && f.effectiveness > 0 && f.effectiveness < 1}
        >
          {f.text}
          {#if f.note}<small>{f.note}</small>{/if}
        </span>
      {/each}
    </div>

    <div class="plate ally-plate">
      <span class="who"><b>{nameOf(activeFighter)}{#if allyShiny} ★{/if}</b><small>Nv {activeFighter.level}</small></span>
      <span role="progressbar" aria-label="HP do seu Pokémon" aria-valuemin="0" aria-valuemax={active.maxHp} aria-valuenow={active.hp}>
        {@render bar(allyPercent, allyTrail, hpTone(allyPercent))}
      </span>
      <small class="hp-text">{active.hp}/{active.maxHp}</small>
    </div>
  </div>

  {#if status === 'offline'}
    <p class="note bad" role="alert">Sem conexão. A luta está guardada.</p>
    <button type="button" class="btn btn-primary retry" onclick={retryFinish}>Tentar de novo</button>
  {:else if status === 'finishing'}
    <p class="note">Contando o resultado…</p>
  {/if}

  <!-- Sem golpe carregado, o botão nem aparece e o rápido ocupa a linha. -->
  <div class="moves" class:solo={!activeFighter.chargedMove}>
    <button type="button" class="btn act" disabled={!canAct} onclick={() => manual('fast')}>
      <span class="cd" style:transform="scaleX({cdFill})" aria-hidden="true"></span>
      <span class="label">Rápido</span>
      <small>{moveLabel(activeFighter.fastMove.name)}</small>
    </button>
    {#if activeFighter.chargedMove && chargedCost !== null}
      <button
        type="button"
        class="btn act charged"
        class:ready={chargeReady}
        disabled={!canCharged}
        aria-label="Carregado: {moveLabel(activeFighter.chargedMove.name)}, {chargeDone} de {chargeNeeded} golpes rápidos"
        onclick={() => manual('charged')}
      >
        <!-- Cada golpe rápido enche o botão de baixo para cima. -->
        <span class="charge" style:transform="scaleY({chargeFill})" aria-hidden="true"></span>
        {#if chargeReady}<span class="cd" style:transform="scaleX({cdFill})" aria-hidden="true"></span>{/if}
        <span class="label">{chargeReady ? 'Carregado!' : `Carga ${chargeDone}/${chargeNeeded}`}</span>
        <small>{moveLabel(activeFighter.chargedMove.name)}</small>
      </button>
    {/if}
  </div>

  {#if setup.team.length > 1}
    <div class="party" aria-label="Trocar de Pokémon">
      {#each setup.team as fighter, slot (slot)}
        {@const side = snap.team[slot]!}
        {@const here = slot === snap.activeSlot}
        <button
          type="button"
          class="chip"
          class:on={here}
          disabled={!canAct || side.fainted || here || switchWait > 0}
          aria-label="Trocar para {nameOf(fighter)}"
          onclick={() => swap(slot)}
        >
          <span class="chip-name">{nameOf(fighter)}</span>
          <span class="chip-meta">
            {#if side.fainted}Caiu{:else if here}Em campo{:else if switchWait > 0}{Math.ceil(switchWait / 1000)}s{:else}Trocar{/if}
          </span>
          {@render bar(hpPercent(side), hpPercent(side), hpTone(hpPercent(side)))}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* No PC a arena esticava na tela toda e os dois ficavam longe um do outro:
     largura de celular, centralizada. */
  .live {
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
  }

  .timer {
    min-width: 4.5rem;
    font-size: 1.5rem;
    font-weight: 700;
  }

  .timer.late {
    color: var(--danger);
  }

  .auto {
    min-height: 48px;
  }

  .auto.on {
    border-image-source: url('/ui/button-primary.png');
    color: #f3ffe8;
    text-shadow: 0 var(--px) 0 #3f7a2a;
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

  /* Acerto: o sprite inteiro fica branco por um instante (flash de pixel art).
     O filtro fica no filho, porque o .body já usa filter nas animações de dano. */
  .body.hit-flash > .anchor,
  .body.hit-flash > .gif {
    filter: brightness(0) invert(1);
  }

  /* Golpe carregado: contorno na cor do tipo do golpe. */
  .body.type-glow > .anchor,
  .body.type-glow > .gif {
    filter: drop-shadow(0 0 2px var(--glow)) drop-shadow(0 0 4px var(--glow));
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
    background: #f3e7c6e6;
    box-shadow: inset 0 0 0 var(--px) var(--ink-soft);
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

  .hp-trail {
    background: #ffd27a;
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
    color: #b9ff9a;
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

  .moves {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .moves.solo {
    grid-template-columns: 1fr;
  }

  /* Energia do carregado: enche o botão de baixo para cima. */
  .charge {
    position: absolute;
    inset: 0;
    transform-origin: center bottom;
    background: #ffcc0099;
    pointer-events: none;
  }

  .act.charged.ready {
    border-image-source: url('/ui/button-primary.png');
    color: #fff;
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
    font-size: 1.15rem;
    white-space: nowrap;
  }

  .act small {
    position: relative;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8rem;
    font-weight: 600;
  }

  /* Espera até poder golpear de novo: enche da esquerda para a direita. */
  .cd {
    position: absolute;
    inset: 0;
    transform-origin: left center;
    background: #5a8f3c44;
    pointer-events: none;
  }

  .act.charged .cd {
    background: #3f8fc444;
  }

  .party {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
    gap: 0.4rem;
  }

  .chip {
    display: grid;
    gap: 0.15rem;
    box-sizing: border-box;
    min-height: 64px;
    padding: 0 0.6rem;
    align-content: center;
    border: 8px solid transparent;
    border-image: url('/ui/inlay.png') 4 fill / 8px round;
    background: none;
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .chip.on {
    border-image: url('/ui/selected.png') 6 fill / 8px round;
  }

  .chip:disabled {
    cursor: default;
  }

  .chip:disabled:not(.on) {
    filter: grayscale(1) opacity(0.6);
  }

  .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9rem;
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

  @keyframes faint {
    to {
      transform: translateY(20px);
      opacity: 0.35;
    }
  }
</style>
