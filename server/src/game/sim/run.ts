import { mulberry32, type Rng } from '../mulberry32.js'
import { isPokemonType } from '../../config/types.js'
import {
  abilityImmunity,
  calcDamage,
  chargedEnergyCost,
  defensiveStat,
  fastEnergyGain,
  moveCooldownMs,
  offensiveStat,
  rollCriticalAgainst,
  typeMultiplier,
} from './damage.js'
import { simConfig } from './config.js'
import { autoReactionSeed } from './seeds.js'
import {
  applyStageChange,
  clearStatus,
  effectChancePercent,
  initStatusFields,
  isImmobilized,
  resetStages,
  rollPercent,
  statusDotDamage,
  thawIfFireHit,
  tickStatusExpiry,
  tryApplyAilment,
  type StatusSide,
} from './status.js'
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
  StatusCondition,
} from './types.js'

type SideState = StatusSide & {
  fighter: SimFighter
  hp: number
  maxHp: number
  energy: number
  readyAt: number
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
  playerActAt: number | null
}

export type RunBattleOptions = {
  setup: BattleSetup
  seed: number
  inputs?: BattleInput[] | 'auto'
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

    // Expira status temporários neste instante.
    tickStatusExpiry(activePlayer(state), state.t, (e) => state.log.push(e), 'player')
    tickStatusExpiry(state.wild, state.t, (e) => state.log.push(e), 'wild')

    // DoT / Shed Skin neste instante.
    if (processSideTicks(state, 'player') === 'faint') {
      /* handled below */
    }
    if (state.wild.hp <= 0) {
      result = 'win'
      break
    }
    if (processSideTicks(state, 'wild') === 'faint') {
      /* handled below */
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

    if (auto) {
      if (state.playerActAt === null) schedulePlayer(state)
      if (state.playerActAt !== null && state.playerActAt === state.t) {
        const blocked = isImmobilized(player, state.t)
        if (blocked) {
          state.log.push({ t: state.t, kind: 'cant_act', side: 'player', reason: blocked })
          state.playerActAt = null
          schedulePlayer(state)
        } else {
          const action = pickAutoAction(player)
          applyPlayerAction(state, { t: state.t, action })
          state.playerActAt = null
          if (state.wild.hp <= 0) {
            result = 'win'
            break
          }
          if (state.team[state.activeSlot]!.hp > 0) schedulePlayer(state)
        }
      }
    }

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

function activePlayer(state: BattleState): SideState {
  return state.team[state.activeSlot]!
}

function processSideTicks(state: BattleState, who: 'player' | 'wild'): 'ok' | 'faint' {
  const side = who === 'player' ? activePlayer(state) : state.wild
  if (side.hp <= 0) return 'ok'

  if (
    side.nextShedSkinAt !== null &&
    side.nextShedSkinAt === state.t &&
    side.status !== null &&
    side.fighter.abilityKey === 'shed-skin'
  ) {
    if (Math.floor(state.rng() * simConfig.shedSkinChanceDenom) === 0) {
      clearStatus(side, state.t, (e) => state.log.push(e), who)
    } else {
      side.nextShedSkinAt = state.t + simConfig.shedSkinIntervalMs
    }
  }

  if (
    side.nextStatusTickAt !== null &&
    side.nextStatusTickAt === state.t &&
    (side.status === 'burn' || side.status === 'poison')
  ) {
    const damage = statusDotDamage(side.maxHp)
    side.hp = Math.max(0, side.hp - damage)
    const fainted = side.hp <= 0
    state.log.push({
      t: state.t,
      kind: 'status_damage',
      side: who,
      status: side.status,
      damage,
      fainted,
    })
    if (fainted) {
      state.log.push({ t: state.t, kind: 'faint', side: who, slot: side.slot })
      return 'faint'
    }
    side.nextStatusTickAt = state.t + simConfig.statusTickMs
  }
  return 'ok'
}

function takeSnapshot(state: BattleState, result: BattleResultKind | null): BattleSnapshot {
  return {
    t: state.t,
    activeSlot: state.activeSlot,
    switchReadyAt: state.switchReadyAt,
    team: state.team.map((s) => snapshotSide(s, state.t)),
    wild: snapshotSide(state.wild, state.t),
    result,
  }
}

function snapshotSide(side: SideState, t: number): BattleSnapshotSide {
  const immobilized = isImmobilized(side, t)
  return {
    slot: side.slot,
    fighterId: side.fighter.id,
    speciesId: side.fighter.speciesId,
    hp: side.hp,
    maxHp: side.maxHp,
    energy: side.energy,
    readyAt: side.readyAt,
    fainted: side.hp <= 0,
    status: immobilized ? immobilized : side.status,
    confused: side.confusionUntil > t,
    stages: { ...side.stages },
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
    slot,
    ...initStatusFields(),
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
    const prev = state.team[state.activeSlot]
    if (prev && prev.slot !== slot) {
      if (prev.fighter.abilityKey === 'natural-cure') {
        clearStatus(prev, state.t, (e) => state.log.push(e), 'player')
      }
      resetStages(prev)
    }
    state.activeSlot = slot
    state.enteredSlots.add(slot)
    const fighter = state.team[slot]!
    fighter.readyAt = state.t
    fighter.energy = Math.min(fighter.energy, simConfig.energyMax)
    resetStages(fighter)
    // Fora de campo os tiques não correm: quem volta com queimadura ou veneno
    // recomeça a contagem agora (senão o horário ficaria no passado e o tique
    // nunca mais bateria).
    if (fighter.nextStatusTickAt !== null && fighter.nextStatusTickAt < state.t) {
      fighter.nextStatusTickAt = state.t + simConfig.statusTickMs
    }
    if (fighter.nextShedSkinAt !== null && fighter.nextShedSkinAt < state.t) {
      fighter.nextShedSkinAt = state.t + simConfig.shedSkinIntervalMs
    }
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
  applyStageChange(foe, 'attack', -1, state.t, (e) => state.log.push(e), entering === 'player' ? 'wild' : 'player')
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

  const blocked = isImmobilized(player, state.t)
  if (blocked) {
    state.log.push({ t: state.t, kind: 'cant_act', side: 'player', reason: blocked })
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

  const blocked = isImmobilized(wild, state.t)
  if (blocked) {
    state.log.push({ t: state.t, kind: 'cant_act', side: 'wild', reason: blocked })
    return
  }

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
  const defenderSide: 'player' | 'wild' = side === 'player' ? 'wild' : 'player'
  const isFast = action === 'fast'
  const serene = attacker.fighter.abilityKey === 'serene-grace'

  // Confusão: chance de se bater.
  if (attacker.confusionUntil > state.t) {
    if (Math.floor(state.rng() * simConfig.confusionSelfHitDenom) === 0) {
      const selfDmg = confusionSelfDamage(attacker, state.rng)
      attacker.hp = Math.max(0, attacker.hp - selfDmg)
      const fainted = attacker.hp <= 0
      state.log.push({
        t: state.t,
        kind: 'confusion_hit',
        side,
        damage: selfDmg,
        fainted,
      })
      setReady(attacker, move, state.t)
      if (action === 'fast') {
        attacker.energy = Math.min(simConfig.energyMax, attacker.energy + fastEnergyGain(move.power))
      } else {
        attacker.energy = Math.max(0, attacker.energy - chargedEnergyCost(move.power))
      }
      if (fainted) {
        state.log.push({ t: state.t, kind: 'faint', side, slot: attacker.slot })
      }
      return
    }
  }

  const absorb = abilityImmunity(defender.fighter.abilityKey, move.type)
  let damage = 0
  let critical = false
  const effectiveness = isPokemonType(move.type)
    ? typeMultiplier(move.type, defender.fighter.types)
    : 1

  if (absorb.immune && absorb.healFraction > 0) {
    const healed = Math.floor(defender.maxHp / 4)
    defender.hp = Math.min(defender.maxHp, defender.hp + healed)
    state.log.push({ t: state.t, kind: 'heal', side: defenderSide, amount: healed })
  } else if (!absorb.immune) {
    critical = rollCriticalAgainst(move, attacker.fighter, defender.fighter, state.rng)
    damage = calcDamage({
      attacker: attacker.fighter,
      defender: defender.fighter,
      move,
      attackStat: offensiveStat(
        attacker.fighter,
        move.damageClass,
        attacker.stages,
        attacker.status,
        critical,
      ),
      defenseStat: defensiveStat(
        defender.fighter,
        move.damageClass,
        defender.stages,
        defender.status,
        critical,
      ),
      attackerHp: attacker.hp,
      attackerMaxHp: attacker.maxHp,
      defenderHp: defender.hp,
      defenderMaxHp: defender.maxHp,
      critical,
      rng: state.rng,
    })
    defender.hp = Math.max(0, defender.hp - damage)
    if (damage > 0) thawIfFireHit(defender, move.type, state.t, (e) => state.log.push(e), defenderSide)
  }

  if (action === 'fast') {
    attacker.energy = Math.min(simConfig.energyMax, attacker.energy + fastEnergyGain(move.power))
  } else {
    attacker.energy = Math.max(0, attacker.energy - chargedEnergyCost(move.power))
  }
  setReady(attacker, move, state.t)

  const targetFainted = defender.hp <= 0
  state.log.push({
    t: state.t,
    kind: 'move',
    side,
    move: action,
    moveName: move.name,
    damage,
    effectiveness,
    critical,
    fainted: targetFainted,
  })
  if (targetFainted) {
    state.log.push({ t: state.t, kind: 'faint', side: defenderSide, slot: defender.slot })
  }

  // Efeitos secundários (não se Shield Dust no alvo; dano/dreno/recuo continuam).
  const shieldDust = defender.fighter.abilityKey === 'shield-dust'
  if (!targetFainted && !shieldDust && !absorb.immune) {
    applySecondaryEffects(state, side, attacker, defender, move, isFast, serene)
  } else if (!targetFainted && !shieldDust && absorb.immune) {
    // sem efeitos em imunidade
  } else if (!targetFainted && shieldDust) {
    // só contato abilities ainda? Shield Dust bloqueia secundários do golpe, não contact abilities after
  }

  // Contato (físico): Static etc. no defensor → atacante.
  if (!targetFainted && damage > 0 && move.damageClass === 'physical') {
    applyContactAbilities(state, attacker, defender, side, defenderSide)
  }

  // Dreno / recuo — sempre (exceto Rock Head no recuo). Ordem: depois dos efeitos.
  // Se o alvo já caiu, a luta é vitória mesmo com recuo no atacante.
  if (damage > 0 && move.drain !== 0) {
    applyDrainRecoil(state, side, attacker, move.drain, damage)
  }

  // Se o alvo caiu, não processamos mais nele; recuo já foi aplicado.
  void targetFainted
}

function setReady(attacker: SideState, move: SimMove, t: number) {
  attacker.readyAt =
    t +
    moveCooldownMs(
      move,
      attacker.fighter.stats.speed,
      attacker.fighter.level,
      attacker.stages.speed,
      attacker.status === 'paralysis',
    )
}

function confusionSelfDamage(attacker: SideState, rng: Rng): number {
  const atk = Math.max(1, attacker.fighter.stats.attack)
  const def = Math.max(1, attacker.fighter.stats.defense)
  const level = attacker.fighter.level
  let damage =
    Math.floor((((Math.floor((2 * level) / 5) + 2) * simConfig.confusionSelfPower * atk) / def) / 50) + 2
  const roll = 85 + Math.floor(rng() * 16)
  damage = Math.floor((damage * roll) / 100)
  return Math.max(1, damage)
}

function applySecondaryEffects(
  state: BattleState,
  side: 'player' | 'wild',
  attacker: SideState,
  defender: SideState,
  move: SimMove,
  isFast: boolean,
  serene: boolean,
) {
  const defenderSide: 'player' | 'wild' = side === 'player' ? 'wild' : 'player'

  if (move.ailment && move.ailmentChance > 0) {
    const allowed =
      !isFast ||
      (simConfig.fastAilments as readonly string[]).includes(move.ailment)
    if (allowed) {
      const chance = effectChancePercent(move.ailmentChance, isFast, serene)
      if (rollPercent(state.rng, chance)) {
        const applied = tryApplyAilment(
          defender,
          move.ailment,
          state.t,
          (e) => state.log.push(e),
          defenderSide,
        )
        if (
          applied &&
          (move.ailment === 'burn' || move.ailment === 'poison' || move.ailment === 'paralysis') &&
          defender.fighter.abilityKey === 'synchronize'
        ) {
          tryApplyAilment(attacker, move.ailment, state.t, (e) => state.log.push(e), side)
        }
      }
    }
  }

  if (move.statChanges.length > 0 && move.statChance > 0) {
    const chance = effectChancePercent(move.statChance, isFast, serene)
    if (rollPercent(state.rng, chance)) {
      const target = move.statOnSelf ? attacker : defender
      const targetSide = move.statOnSelf ? side : defenderSide
      for (const change of move.statChanges) {
        applyStageChange(target, change.stat, change.stages, state.t, (e) => state.log.push(e), targetSide)
      }
    }
  }
}

function applyContactAbilities(
  state: BattleState,
  attacker: SideState,
  defender: SideState,
  attackerSide: 'player' | 'wild',
  _defenderSide: 'player' | 'wild',
) {
  const key = defender.fighter.abilityKey
  const chance = simConfig.contactAbilityChance
  let applied: StatusCondition | null = null
  if (key === 'static' && rollPercent(state.rng, chance)) {
    if (tryApplyAilment(attacker, 'paralysis', state.t, (e) => state.log.push(e), attackerSide)) {
      applied = 'paralysis'
    }
  } else if (key === 'poison-point' && rollPercent(state.rng, chance)) {
    if (tryApplyAilment(attacker, 'poison', state.t, (e) => state.log.push(e), attackerSide)) {
      applied = 'poison'
    }
  } else if (key === 'flame-body' && rollPercent(state.rng, chance)) {
    if (tryApplyAilment(attacker, 'burn', state.t, (e) => state.log.push(e), attackerSide)) {
      applied = 'burn'
    }
  } else if (key === 'effect-spore' && rollPercent(state.rng, chance)) {
    const pick = Math.floor(state.rng() * 3)
    const ailment = pick === 0 ? 'poison' : pick === 1 ? 'paralysis' : 'sleep'
    if (tryApplyAilment(attacker, ailment, state.t, (e) => state.log.push(e), attackerSide)) {
      if (ailment !== 'sleep') applied = ailment
    }
  }
  if (
    applied &&
    attacker.fighter.abilityKey === 'synchronize'
  ) {
    const defenderSide: 'player' | 'wild' = attackerSide === 'player' ? 'wild' : 'player'
    tryApplyAilment(defender, applied, state.t, (e) => state.log.push(e), defenderSide)
  }
}

function applyDrainRecoil(
  state: BattleState,
  side: 'player' | 'wild',
  attacker: SideState,
  drain: number,
  damage: number,
) {
  if (drain > 0) {
    const heal = Math.max(1, Math.floor((damage * drain) / 100))
    const before = attacker.hp
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal)
    const amount = attacker.hp - before
    if (amount > 0) state.log.push({ t: state.t, kind: 'drain', side, amount })
    return
  }
  // recuo
  if (attacker.fighter.abilityKey === 'rock-head') return
  const recoil = Math.max(1, Math.floor((damage * -drain) / 100))
  attacker.hp = Math.max(0, attacker.hp - recoil)
  const fainted = attacker.hp <= 0
  state.log.push({ t: state.t, kind: 'recoil', side, damage: recoil, fainted })
  if (fainted) {
    state.log.push({ t: state.t, kind: 'faint', side, slot: attacker.slot })
  }
}

function scheduleWild(state: BattleState) {
  if (state.wild.hp <= 0) {
    state.wildActAt = null
    return
  }
  const blockedUntil =
    state.wild.status === 'sleep' || state.wild.status === 'freeze'
      ? state.wild.statusUntil
      : 0
  const ready = Math.max(state.t, state.wild.readyAt, blockedUntil)
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
  const blockedUntil =
    player.status === 'sleep' || player.status === 'freeze' ? player.statusUntil : 0
  const ready = Math.max(state.t, player.readyAt, state.switchReadyAt, blockedUntil)
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

  pushTick(candidates, state.team[state.activeSlot]!)
  pushTick(candidates, state.wild)

  let best: number | null = null
  for (const c of candidates) {
    if (c < state.t) continue
    if (best === null || c < best) best = c
  }
  return best
}

function pushTick(candidates: number[], side: SideState) {
  if (side.nextStatusTickAt !== null) candidates.push(side.nextStatusTickAt)
  if (side.nextShedSkinAt !== null) candidates.push(side.nextShedSkinAt)
  if (side.status === 'sleep' || side.status === 'freeze') candidates.push(side.statusUntil)
  if (side.confusionUntil > 0) candidates.push(side.confusionUntil)
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
