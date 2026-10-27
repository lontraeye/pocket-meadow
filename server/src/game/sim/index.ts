export { simConfig, isFinishTooEarly } from './config.js'
export { runBattle, type RunBattleOptions } from './run.js'
export { battleRngSeed, throwRngSeed, wildTraitsSeed, wildFightTraitsSeed } from './seeds.js'
export { serializeBattleSetup, parseBattleSetup } from './setupJson.js'
export {
  calcDamage,
  speedFactor,
  moveCooldownMs,
  fastEnergyGain,
  chargedEnergyCost,
  typeMultiplier,
} from './damage.js'
export type {
  BattleSetup,
  BattleInput,
  BattleResult,
  BattleEvent,
  BattleAction,
  SimFighter,
  SimMove,
  BattleResultKind,
} from './types.js'
