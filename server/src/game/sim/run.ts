import { mulberry32, type Rng } from '../mulberry32.js'
import {
  abilityImmunity,
  calcDamage,
  chargedEnergyCost,
  defensiveStat,
  fastEnergyGain,
  moveCooldownMs,
  offensiveStat,
} from './damage.js'
import { simConfig } from './config.js'
import { autoReactionSeed } from './seeds.js'
import type {
  BattleEvent,
  BattleInput,
  BattleResult,
  BattleResultKind,
  BattleSetup,
  BattleSnapshot,
  BattleSnapshotSide,
  SimFighter,
  SimMove,
} from './types.js'

type SideState = {
  fighter: SimFighter
  hp: number
  maxHp: number
  energy: number
  readyAt: number
  intimidated: boolean
  slot: number
}

type BattleState = {
  t: number
  team: SideState[]
  activeSlot: number
  wild: SideState
  switchReadyAt: number
  enteredSlots: Set<number>
  log: BattleEvent[]
  recordedInputs: BattleInput[]
  rng: Rng
  autoRng: Rng
  wildActAt: number | null
  /** Próximo toque do automático (após reação). */
  playerActAt: number | null
}

export type RunBattleOptions = {
  setup: BattleSetup
  seed: number
  /** Se omitido ou 'auto', o jogador automático gera as ações. */
  inputs?: BattleInput[] | 'auto'
  /** Se definido, para neste instante e devolve snapshot (sem end se ainda em andamento). */
  untilMs?: number
}

export function runBattle(options: RunBattleOptions): BattleResult {
  const { setup, seed } = options
  if (setup.team.length < 1 || setup.team.length > 3) {
    throw new Error('team must have 1–3 fighters')
  }

  const auto = options.inputs === undefined || options.inputs === 'auto'
  const inputs: BattleInput[] = auto ? [] : validateAndSortInputs(options.inputs as BattleInput[])
  const untilMs =
    options.untilMs === undefined
      ? null
      : Math.max(0, Math.min(simConfig.timeLimitMs, Math.floor(options.untilMs)))

  const rng = mulberry32(seed)
  const autoRng = mulberry32(autoReactionSeed(seed))

  const team = setup.team.map((fighter, slot) => makeSide(fighter, slot))
  const wild = makeSide(setup.wild, 0)
  const state: BattleState = {
    t: 0,
    team,
    activeSlot: 0,
    wild,
    switchReadyAt: 0,
    enteredSlots: new Set([0]),
    log: [],
    recordedInputs: [],
    rng,
    autoRng,
    wildActAt: null,
    playerActAt: null,
  }

  enter(state, 'player', 0, false)
  enter(state, 'wild', 0, false)
  scheduleWild(state)
  if (auto) schedulePlayer(state)

  let inputIndex = 0
  let result: BattleResultKind | null = null
  let stoppedEarly = false

  while (result === null) {
    if (state.t >= simConfig.timeLimitMs) {
      result = 'timeout'
      break
    }

    const player = state.team[state.activeSlot]!
    if (player.hp <= 0) {
      const next = nextLivingSlot(state)
      if (next === null) {
        result = 'lose'
        break
      }
      const switchAt = state.t + simConfig.faintSwitchDelayMs
      if (untilMs !== null && switchAt > untilMs) {
        state.t = untilMs
        stoppedEarly = true
        break
      }
      state.t = switchAt
      if (state.t >= simConfig.timeLimitMs) {
        result = 'timeout'
        break
      }
      enter(state, 'player', next, false)
      state.playerActAt = null
      scheduleWild(state)
      if (auto) schedulePlayer(state)
      continue
    }
    if (state.wild.hp <= 0) {
      result = 'win'
      break
    }

    // Automático: toca no instante agendado (cooldown + reação).
    if (auto) {
      if (state.playerActAt === null) schedulePlayer(state)
      if (state.playerActAt !== null && state.playerActAt === state.t) {
        const action = pickAutoAction(player)
        applyPlayerAction(state, { t: state.t, action })
        state.playerActAt = null
        if (state.wild.hp <= 0) {
          result = 'win'
          break
        }
        if (state.team[state.activeSlot]!.hp > 0) schedulePlayer(state)
        // Processa o resto deste instante (selvagem) antes de avançar.
      }
    }

    // Inputs manuais neste instante (e os que ficaram no passado após um salto de t).
    while (!auto && inputIndex < inputs.length && inputs[inputIndex]!.t <= state.t) {
      const input = inputs[inputIndex]!
      inputIndex += 1
      if (input.t < state.t) {
        ignorePastInput(state, input)
        continue
      }
      applyPlayerAction(state, input)
      if (state.wild.hp <= 0) {
        result = 'win'
        break
      }
      if (state.team[state.activeSlot]!.hp <= 0) break
    }
    if (result !== null) break
    if (state.team[state.activeSlot]!.hp <= 0) continue

    // Selvagem age.
    if (state.wildActAt !== null && state.wildActAt === state.t) {
      wildAttack(state)
      state.wildActAt = null
      if (state.wild.hp <= 0) {
        result = 'win'
        break
      }
      if (state.team[state.activeSlot]!.hp <= 0) continue
      scheduleWild(state)
    } else if (state.wildActAt === null && state.wild.hp > 0 && state.t >= state.wild.readyAt) {
      scheduleWild(state)
    }

    // Depois de processar este instante: se untilMs chegou, para (foto coerente com o log).
    if (untilMs !== null && state.t >= untilMs) {
      stoppedEarly = true
      break
    }

    const next = nextTime(state, auto, inputs, inputIndex, untilMs)
    if (next === null) {
      if (untilMs !== null) {
        state.t = untilMs
        stoppedEarly = true
        break
      }
      state.t = simConfig.timeLimitMs
      result = 'timeout'
      break
    }
    if (untilMs !== null && next > untilMs) {
      state.t = untilMs
      stoppedEarly = true
      break
    }
    if (next === state.t) {
      state.t += 1
    } else {
      state.t = next
    }
  }

  if (result !== null) {
    state.log.push({ t: state.t, kind: 'end', result })
  } else if (!stoppedEarly) {
    result = 'timeout'
    state.log.push({ t: state.t, kind: 'end', result })
  }

  return {
    result,
    durationMs: state.t,
    log: state.log,
    inputs: state.recordedInputs,
    enteredSlots: [...state.enteredSlots].sort((a, b) => a - b),
    snapshot: takeSnapshot(state, result),
  }
}

function takeSnapshot(state: BattleState, result: BattleResultKind | null): BattleSnapshot {
  return {
    t: state.t,
    activeSlot: state.activeSlot,
    switchReadyAt: state.switchReadyAt,
    team: state.team.map(snapshotSide),
    wild: snapshotSide(state.wild),
    result,
  }
}

function snapshotSide(side: SideState): BattleSnapshotSide {
  return {
    slot: side.slot,
    fighterId: side.fighter.id,
    speciesId: side.fighter.speciesId,
    hp: side.hp,
    maxHp: side.maxHp,
    energy: side.energy,
    readyAt: side.readyAt,
    fainted: side.hp <= 0,
  }
}

function makeSide(fighter: SimFighter, slot: number): SideState {
  const maxHp = Math.max(1, Math.floor(fighter.stats.hp * simConfig.battleHpMultiplier))
  return {
    fighter,
    hp: maxHp,
    maxHp,
    energy: 0,
    readyAt: 0,
    intimidated: false,
    slot,
  }
}

function ignorePastInput(state: BattleState, input: BattleInput) {
  state.recordedInputs.push({ ...input })
  const player = state.team[state.activeSlot]!
  const reason = player.hp <= 0 ? 'fainted' : 'switching'
  state.log.push({ t: state.t, kind: 'ignored', side: 'player', reason })
}

function enter(state: BattleState, side: 'player' | 'wild', slot: number, manual: boolean) {
  if (side === 'player') {
    state.activeSlot = slot
    state.enteredSlots.add(slot)
    const fighter = state.team[slot]!
    fighter.readyAt = state.t
    fighter.energy = Math.min(fighter.energy, simConfig.energyMax)
    state.log.push({
      t: state.t,
      kind: 'enter',
      side: 'player',
      fighterId: fighter.fighter.id,
      slot,
    })
    if (manual) {
      state.log.push({ t: state.t, kind: 'switch', side: 'player', slot, manual: true })
      state.switchReadyAt = state.t + simConfig.switchCooldownMs
    } else if (state.log.some((e) => e.kind === 'faint' && e.side === 'player')) {
      state.log.push({ t: state.t, kind: 'switch', side: 'player', slot, manual: false })
    }
    applyIntimidate(state, 'player')
  } else {
    state.log.push({
      t: state.t,
      kind: 'enter',
      side: 'wild',
      fighterId: state.wild.fighter.id,
      slot: 0,
    })
    applyIntimidate(state, 'wild')
  }
}

function applyIntimidate(state: BattleState, entering: 'player' | 'wild') {
  const self = entering === 'player' ? state.team[state.activeSlot]! : state.wild
  if (self.fighter.abilityKey !== 'intimidate') return
  const foe = entering === 'player' ? state.wild : state.team[state.activeSlot]!
  foe.intimidated = true
  state.log.push({ t: state.t, kind: 'intimidate', side: entering })
}

function pickAutoAction(player: SideState): 'fast' | 'charged' {
  const charged = player.fighter.chargedMove
  if (charged && player.energy >= chargedEnergyCost(charged.power)) return 'charged'
  return 'fast'
}

function applyPlayerAction(state: BattleState, input: BattleInput) {
  state.recordedInputs.push({ ...input })
  const player = state.team[state.activeSlot]!
  if (player.hp <= 0) {
    state.log.push({ t: state.t, kind: 'ignored', side: 'player', reason: 'fainted' })
    return
  }
  if (input.action === 'switch') {
    const slot = input.slot
    if (slot === undefined || slot < 0 || slot >= state.team.length || slot === state.activeSlot) {
      state.log.push({ t: state.t, kind: 'ignored', side: 'player', reason: 'invalid' })
      return
    }
    if (state.team[slot]!.hp <= 0) {
      state.log.push({ t: state.t, kind: 'ignored', side: 'player', reason: 'fainted' })
      return
    }
    if (state.t < state.switchReadyAt) {
      state.log.push({ t: state.t, kind: 'ignored', side: 'player', reason: 'cooldown' })
      return
    }
    enter(state, 'player', slot, true)
    scheduleWild(state)
    return
  }

  if (state.t < player.readyAt || state.t < state.switchReadyAt) {
    state.log.push({ t: state.t, kind: 'ignored', side: 'player', reason: 'cooldown' })
    return
  }

  const move = input.action === 'charged' ? player.fighter.chargedMove : player.fighter.fastMove
  if (!move || (input.action === 'charged' && !player.fighter.chargedMove)) {
    state.log.push({ t: state.t, kind: 'ignored', side: 'player', reason: 'invalid' })
    return
  }
  if (input.action === 'charged' && player.energy < chargedEnergyCost(move.power)) {
    state.log.push({ t: state.t, kind: 'ignored', side: 'player', reason: 'energy' })
    return
  }

  resolveMove(state, 'player', player, state.wild, move, input.action)
}

function wildAttack(state: BattleState) {
  const wild = state.wild
  if (wild.hp <= 0 || state.t < wild.readyAt) return
  const player = state.team[state.activeSlot]!
  if (player.hp <= 0) return

  let action: 'fast' | 'charged' = 'fast'
  const charged = wild.fighter.chargedMove
  if (charged && wild.energy >= chargedEnergyCost(charged.power) && state.rng() < simConfig.aiChargedChance) {
    action = 'charged'
  }
  const move = action === 'charged' ? charged! : wild.fighter.fastMove
  resolveMove(state, 'wild', wild, player, move, action)
}

function resolveMove(
  state: BattleState,
  side: 'player' | 'wild',
  attacker: SideState,
  defender: SideState,
  move: SimMove,
  action: 'fast' | 'charged',
) {
  const absorb = abilityImmunity(defender.fighter.abilityKey, move.type)
  let damage = 0

  if (absorb.immune && absorb.healFraction > 0) {
    const healed = Math.floor(defender.maxHp / 4)
    defender.hp = Math.min(defender.maxHp, defender.hp + healed)
    state.log.push({ t: state.t, kind: 'heal', side: side === 'player' ? 'wild' : 'player', amount: healed })
  } else {
    damage = calcDamage({
      attacker: attacker.fighter,
      defender: defender.fighter,
      move,
      attackStat: offensiveStat(attacker.fighter, move.damageClass, attacker.intimidated),
      defenseStat: defensiveStat(defender.fighter, move.damageClass),
      attackerHp: attacker.hp,
      attackerMaxHp: attacker.maxHp,
      defenderHp: defender.hp,
      defenderMaxHp: defender.maxHp,
      rng: state.rng,
    })
    defender.hp = Math.max(0, defender.hp - damage)
  }

  if (action === 'fast') {
    attacker.energy = Math.min(simConfig.energyMax, attacker.energy + fastEnergyGain(move.power))
  } else {
    attacker.energy = Math.max(0, attacker.energy - chargedEnergyCost(move.power))
  }

  attacker.readyAt =
    state.t + moveCooldownMs(move, attacker.fighter.stats.speed, attacker.fighter.level)

  const fainted = defender.hp <= 0
  state.log.push({
    t: state.t,
    kind: 'move',
    side,
    move: action,
    moveName: move.name,
    damage,
    fainted,
  })
  if (fainted) {
    state.log.push({
      t: state.t,
      kind: 'faint',
      side: side === 'player' ? 'wild' : 'player',
      slot: defender.slot,
    })
  }
}

function scheduleWild(state: BattleState) {
  if (state.wild.hp <= 0) {
    state.wildActAt = null
    return
  }
  const ready = Math.max(state.t, state.wild.readyAt)
  const span = simConfig.aiFastDelayMaxMs - simConfig.aiFastDelayMinMs + 1
  const delay = simConfig.aiFastDelayMinMs + Math.floor(state.rng() * span)
  state.wildActAt = ready + delay
}

function schedulePlayer(state: BattleState) {
  const player = state.team[state.activeSlot]!
  if (player.hp <= 0 || state.wild.hp <= 0) {
    state.playerActAt = null
    return
  }
  const ready = Math.max(state.t, player.readyAt, state.switchReadyAt)
  const span = simConfig.autoReactionMaxMs - simConfig.autoReactionMinMs + 1
  const delay = simConfig.autoReactionMinMs + Math.floor(state.autoRng() * span)
  state.playerActAt = ready + delay
}

function nextLivingSlot(state: BattleState): number | null {
  for (let i = 0; i < state.team.length; i += 1) {
    if (i === state.activeSlot) continue
    if (state.team[i]!.hp > 0) return i
  }
  return null
}

function nextTime(
  state: BattleState,
  auto: boolean,
  inputs: BattleInput[],
  inputIndex: number,
  untilMs: number | null,
): number | null {
  const candidates: number[] = [simConfig.timeLimitMs]
  if (untilMs !== null) candidates.push(untilMs)

  if (auto && state.playerActAt !== null) candidates.push(state.playerActAt)
  if (!auto) {
    const nextInput = inputs[inputIndex]
    if (nextInput) candidates.push(nextInput.t)
  }
  if (state.wildActAt !== null) candidates.push(state.wildActAt)
  else if (state.wild.hp > 0) candidates.push(Math.max(state.wild.readyAt, state.t))

  let best: number | null = null
  for (const c of candidates) {
    if (c < state.t) continue
    if (best === null || c < best) best = c
  }
  return best
}

function validateAndSortInputs(inputs: BattleInput[]): BattleInput[] {
  let prev = -1
  for (const input of inputs) {
    if (!(input.t >= 0) || !Number.isInteger(input.t) || input.t > simConfig.timeLimitMs) {
      throw new Error('invalid_input_time')
    }
    if (input.t < prev) throw new Error('inputs_out_of_order')
    prev = input.t
    if (input.action === 'switch' && (input.slot === undefined || input.slot < 0 || input.slot > 2)) {
      throw new Error('invalid_switch_slot')
    }
  }
  return inputs
}
