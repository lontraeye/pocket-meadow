// Luta contra treinador (PLANNING 5.24, parte 1). Líder, Liga e rival usam o
// mesmo formato; cada um entra na lista quando a parte dele existe.

import { leagueTrainers } from './league.js'
import { leaderConfigs, type LeaderFoe } from './leaders.js'
import { rivalTrainers } from './rival.js'
import { traitsConfig } from './traits.js'
import { readSpeciesSnapshot } from '../seed/apply.js'
import { movesByName } from '../seed/traitsData.js'

export type TrainerKind = 'leader' | 'elite' | 'champion' | 'rival'

export type TrainerConfig = {
  key: string
  name: string
  kind: TrainerKind
  foes: readonly LeaderFoe[]
}

/** Líderes, Liga e rival (cada luta do rival em três variações, uma por inicial). */
export function allTrainers(): readonly TrainerConfig[] {
  return [
    ...leaderConfigs.map((leader) => ({
      key: leader.milestoneKey,
      name: leader.name,
      kind: 'leader' as const,
      foes: leader.foes,
    })),
    ...leagueTrainers,
    ...rivalTrainers,
  ]
}

export function trainerByKey(key: string): TrainerConfig | undefined {
  return allTrainers().find((trainer) => trainer.key === key)
}

/**
 * Boot: espécie no seed, rápido até 55 de poder, carregado acima disso.
 * Falha com o nome do treinador e do golpe ou da espécie.
 */
export function checkTrainers(trainers: readonly TrainerConfig[] = allTrainers()): void {
  const speciesIds = new Set(readSpeciesSnapshot().species.map((row) => row.id))
  const moves = movesByName()
  const keys = new Set<string>()
  for (const trainer of trainers) {
    if (keys.has(trainer.key)) throw new Error(`trainer ${trainer.key} is duplicated`)
    keys.add(trainer.key)
    for (const foe of trainer.foes) {
      if (!speciesIds.has(foe.speciesId)) {
        throw new Error(`trainer ${trainer.key} species ${foe.speciesId} is not seeded`)
      }
      const fast = moves.get(foe.fastMove)
      if (!fast || fast.power <= 0 || fast.power > traitsConfig.fastPowerMax) {
        throw new Error(`trainer ${trainer.key} fast move ${foe.fastMove} is missing or not fast`)
      }
      if (foe.chargedMove) {
        const charged = moves.get(foe.chargedMove)
        if (!charged || charged.power <= traitsConfig.fastPowerMax) {
          throw new Error(`trainer ${trainer.key} charged move ${foe.chargedMove} is missing or not charged`)
        }
      }
    }
  }
}
