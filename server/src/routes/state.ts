import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { battleConfig } from '../config/battle.js'
import { berryConfig, berryList, nextPlotSlotLevel, plotSlotsUnlocked } from '../config/berries.js'
import { daycareConfig, daycareSlotsUnlocked, nextDaycareSlotLevel } from '../config/daycare.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { progressionConfig } from '../config/progression.js'
import { trainerConfig } from '../config/trainer.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import {
  activeEffects,
  berryPlots,
  candies,
  daycareSlots,
  encounters,
  evolutions,
  inventory,
  pokemon,
  species,
  trainers,
} from '../db/schema.js'
import { power } from '../game/battle.js'
import { energyFullAt, nextEnergyAt } from '../game/catchUp.js'
import { availableMovesFor, buildTraitView, requireTraitFields } from '../game/traitView.js'
import type { AbilitySlot } from '../game/traits.js'
import { devToolsEnabled } from './dev.js'
import { toEncounterView } from './encounterView.js'

export const stateRoutes = new Hono<AuthEnv>()

stateRoutes.get('/', requireUser, (c) => {
  const userId = c.get('userId')
  const now = Date.now()
  return c.json(immediate(() => readState(userId, now)))
})

function readState(userId: number, now: number) {
  persistCatchUp(userId, now)
  const db = getDb()
  const trainer = db.select().from(trainers).where(eq(trainers.userId, userId)).get()
  if (!trainer) throw new Error(`trainer missing for user ${userId}`)

  const owned = db
    .select({
      id: pokemon.id,
      speciesId: pokemon.speciesId,
      name: species.name,
      displayName: species.displayName,
      evolutionChainId: species.evolutionChainId,
      baseStatTotal: species.baseStatTotal,
      type1: species.type1,
      type2: species.type2,
      hp: species.hp,
      attack: species.attack,
      defense: species.defense,
      spAttack: species.spAttack,
      spDefense: species.spDefense,
      speed: species.speed,
      level: pokemon.level,
      xp: pokemon.xp,
      isShiny: pokemon.isShiny,
      nickname: pokemon.nickname,
      isFavorite: pokemon.isFavorite,
      location: pokemon.location,
      caughtAt: pokemon.caughtAt,
      ivHp: pokemon.ivHp,
      ivAttack: pokemon.ivAttack,
      ivDefense: pokemon.ivDefense,
      ivSpAttack: pokemon.ivSpAttack,
      ivSpDefense: pokemon.ivSpDefense,
      ivSpeed: pokemon.ivSpeed,
      evHp: pokemon.evHp,
      evAttack: pokemon.evAttack,
      evDefense: pokemon.evDefense,
      evSpAttack: pokemon.evSpAttack,
      evSpDefense: pokemon.evSpDefense,
      evSpeed: pokemon.evSpeed,
      nature: pokemon.nature,
      abilitySlot: pokemon.abilitySlot,
      fastMove: pokemon.fastMove,
      chargedMove: pokemon.chargedMove,
    })
    .from(pokemon)
    .innerJoin(species, eq(pokemon.speciesId, species.id))
    .where(eq(pokemon.userId, userId))
    .all()

  const daycareRows = db
    .select({
      slotIndex: daycareSlots.slotIndex,
      pokemonId: daycareSlots.pokemonId,
      enteredAt: daycareSlots.enteredAt,
      lastSettledAt: daycareSlots.lastSettledAt,
      xpGained: daycareSlots.xpGained,
    })
    .from(daycareSlots)
    .where(eq(daycareSlots.userId, userId))
    .all()
  const slotsUnlocked = daycareSlotsUnlocked(trainer.level)
  const daycare = {
    slotsUnlocked,
    nextSlotLevel: nextDaycareSlotLevel(trainer.level),
    slots: daycareRows
      .map((row) => ({
        slotIndex: row.slotIndex,
        pokemonId: row.pokemonId,
        enteredAt: row.enteredAt,
        lastSettledAt: row.lastSettledAt,
        xpGained: row.xpGained,
        fullAt: row.enteredAt + daycareConfig.maxMs,
      }))
      .sort((a, b) => a.slotIndex - b.slotIndex),
  }

  const effects = db.select().from(activeEffects).where(eq(activeEffects.userId, userId)).all()
  const pending = db
    .select({
      id: encounters.id,
      regionSlug: encounters.regionSlug,
      speciesId: encounters.speciesId,
      name: species.name,
      displayName: species.displayName,
      level: encounters.level,
      isShiny: encounters.isShiny,
      expiresAt: encounters.expiresAt,
      baseStatTotal: species.baseStatTotal,
      battleStartedAt: encounters.battleStartedAt,
    })
    .from(encounters)
    .innerJoin(species, eq(encounters.speciesId, species.id))
    .where(and(eq(encounters.userId, userId), eq(encounters.status, 'pending')))
    .get()

  const options = db
    .select({
      fromSpeciesId: evolutions.fromSpeciesId,
      toSpeciesId: evolutions.toSpeciesId,
      minLevel: evolutions.minLevel,
      viaTrade: evolutions.viaTrade,
      displayName: species.displayName,
    })
    .from(evolutions)
    .innerJoin(species, eq(evolutions.toSpeciesId, species.id))
    .all()
  const evolutionsBySpecies = new Map<
    number,
    { toSpeciesId: number; displayName: string; minLevel: number; viaTrade: boolean }[]
  >()
  for (const option of options) {
    const list = evolutionsBySpecies.get(option.fromSpeciesId) ?? []
    list.push({
      toSpeciesId: option.toSpeciesId,
      displayName: option.displayName,
      minLevel: option.minLevel,
      viaTrade: option.viaTrade,
    })
    evolutionsBySpecies.set(option.fromSpeciesId, list)
  }
  for (const list of evolutionsBySpecies.values()) list.sort((a, b) => a.toSpeciesId - b.toSpeciesId)

  return {
    now,
    devTools: devToolsEnabled(),
    gardenMaxVisible: progressConfig.gardenMaxVisible,
    plotSlotsUnlocked: plotSlotsUnlocked(trainer.level),
    nextPlotSlotLevel: nextPlotSlotLevel(trainer.level),
    uprootSeedReturnChance: berryConfig.uprootSeedReturnChance,
    berries: berryList.map((berry) => ({
      key: berry.key,
      name: berry.name,
      growMs: berry.growMs,
      effectDescription: berry.effectDescription,
      effectKey: berry.effect.kind === 'energy' ? null : berry.effect.effectKey,
    })),
    battle: {
      k: battleConfig.k,
      minChance: battleConfig.minChance,
      maxChance: battleConfig.maxChance,
      teamWeights: battleConfig.teamWeights,
    },
    progression: {
      levelCap: progressConfig.levelCap,
      candyXp: progressionConfig.candyXp,
      genericPerCandy: progressionConfig.genericPerCandy,
      releaseBase: progressionConfig.releaseBase,
      releaseLevelDiv: progressionConfig.releaseLevelDiv,
      releaseShinyMult: progressionConfig.releaseShinyMult,
      releaseGeneric: progressionConfig.releaseGeneric,
      feedMax: progressionConfig.feedMaxPerRequest,
      releaseMax: progressionConfig.releaseMaxPerRequest,
      xpBase: progressConfig.xpBase,
      xpExponent: progressConfig.xpExponent,
    },
    trainer: {
      level: trainer.level,
      xp: trainer.xp,
      energy: trainer.energy,
      energyMax: trainerConfig.energyMax,
      energyNextAt: nextEnergyAt(trainer.energy, trainer.energyUpdatedAt),
      energyFullAt: energyFullAt(trainer.energy, trainer.energyUpdatedAt),
      genericCandies: trainer.genericCandies,
    },
    pokemon: owned.map((mon) => {
      const traits = requireTraitFields({
        ...mon,
        abilitySlot: mon.abilitySlot as AbilitySlot | null,
      })
      const view = buildTraitView({
        speciesId: mon.speciesId,
        level: mon.level,
        bases: {
          hp: mon.hp,
          attack: mon.attack,
          defense: mon.defense,
          spAttack: mon.spAttack,
          spDefense: mon.spDefense,
          speed: mon.speed,
          type1: mon.type1,
          type2: mon.type2,
        },
        ...traits,
      })
      const available = availableMovesFor(mon.speciesId, mon.level)
      return {
        id: mon.id,
        speciesId: mon.speciesId,
        name: mon.name,
        displayName: mon.displayName,
        evolutionChainId: mon.evolutionChainId,
        type1: mon.type1,
        type2: mon.type2,
        level: mon.level,
        xp: mon.xp,
        xpToNext: mon.level >= progressConfig.levelCap ? null : xpToNext(mon.level),
        isShiny: mon.isShiny,
        nickname: mon.nickname,
        isFavorite: mon.isFavorite,
        location: mon.location,
        caughtAt: mon.caughtAt,
        power: power(mon.baseStatTotal, mon.level),
        evolutions: evolutionsBySpecies.get(mon.speciesId) ?? [],
        ivRating: view.ivRating,
        nature: view.nature,
        ability: view.ability,
        stats: view.stats,
        fastMove: view.fastMove,
        chargedMove: view.chargedMove,
        nextChargedMove: view.nextChargedMove,
        learnset: view.learnset,
        availableMoves: available,
      }
    }),
    candies: db.select().from(candies).where(eq(candies.userId, userId)).all(),
    daycare,
    plots: db
      .select({
        plotIndex: berryPlots.plotIndex,
        berryKey: berryPlots.berryKey,
        plantedAt: berryPlots.plantedAt,
        readyAt: berryPlots.readyAt,
      })
      .from(berryPlots)
      .where(eq(berryPlots.userId, userId))
      .all()
      .sort((a, b) => a.plotIndex - b.plotIndex),
    inventory: db.select().from(inventory).where(eq(inventory.userId, userId)).all(),
    // O Nanab vencido pode ficar no banco até o daycare liquidar a última hora.
    effects: effects.filter((effect) => effect.expiresAt === null || effect.expiresAt > now).map((effect) => ({
      id: effect.id,
      effectKey: effect.effectKey,
      multiplier: effect.multiplier,
      charges: effect.charges,
      expiresAt: effect.expiresAt,
      createdAt: effect.createdAt,
    })),
    encounter: pending ? toEncounterView(pending) : null,
  }
}
