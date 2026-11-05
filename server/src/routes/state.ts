import { and, eq, inArray } from 'drizzle-orm'
import { moveProgressionConfig } from '../config/traits.js'
import { Hono } from 'hono'
import { type AuthEnv, requireUser } from '../auth/session.js'
import { ballList, ballsConfig } from '../config/balls.js'
import { battleConfig } from '../config/battle.js'
import { FIRST_GROWTH_MULT, berryConfig, berryList, energyBerryOff } from '../config/berries.js'
import { CARETAKER_TIERS, daycareConfig } from '../config/daycare.js'
import { gardenUnlocks, nextDaycareSlotAt } from '../config/gardenUnlocks.js'
import { clearedMilestones } from '../db/milestones.js'
import { caretakerOf, daycareContext } from '../db/caretaker.js'
import { applyDaycareHours } from '../game/daycare.js'
import { progressConfig, xpToNext } from '../config/progress.js'
import { progressionConfig } from '../config/progression.js'
import { trainerConfig, trainerXpToNext } from '../config/trainer.js'
import { weatherConfig } from '../config/weather.js'
import { petConfig } from '../config/pets.js'
import { healConfig } from '../config/heal.js'
import { loadWeather } from '../db/weather.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb, immediate } from '../db/client.js'
import { countClaimableBlocks } from '../game/pokedex.js'
import {
  activeEffects,
  berryPlots,
  candies,
  daycareSlots,
  encounters,
  evolutions,
  gardenGifts,
  inventory,
  pokemon,
  species,
  trainers,
} from '../db/schema.js'
import { catchChance, power } from '../game/battle.js'
import { battleMaxHp } from '../game/sim/config.js'
import { energyFullAt, nextEnergyAt } from '../game/catchUp.js'
import { availableMovesFor, buildTraitView, requireTraitFields } from '../game/traitView.js'
import type { AbilitySlot } from '../game/traits.js'
import { devToolsEnabled } from './dev.js'
import { toEncounterView } from './encounterView.js'
import { currentPlaceOf } from './places.js'
import { layoutView } from './build.js'
import { view as petView } from './garden.js'
import { missionsView } from '../db/missions.js'
import { treesView } from '../db/apricorn.js'
import { benchesView } from '../db/bench.js'
import { visitorsView } from '../db/visitors.js'
import { healMachinesView } from '../db/healMachine.js'

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
      inPc: pokemon.inPc,
      teamSlot: pokemon.teamSlot,
      caughtAt: pokemon.caughtAt,
      caughtRegion: pokemon.caughtRegion,
      caughtBall: pokemon.caughtBall,
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
      moveOffer: pokemon.moveOffer,
      hunger: pokemon.hunger,
      affection: pokemon.affection,
      happiness: pokemon.happiness,
      lastPetAt: pokemon.lastPetAt,
      hpRatio: pokemon.hpRatio,
      faintedAt: pokemon.faintedAt,
      habitatId: pokemon.habitatId,
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
  const cleared = clearedMilestones(userId)
  const slotsUnlocked = gardenUnlocks(cleared).daycareSlots
  // Cuidador e time (5.21): o bônus de alcance, o teto e a prévia de cada vaga.
  const context = daycareContext(userId)
  const speciesNames = new Map(
    db
      .select({ id: species.id, displayName: species.displayName })
      .from(species)
      .where(inArray(species.id, CARETAKER_TIERS.flatMap((tier) => [...tier.species])))
      .all()
      .map((row) => [row.id, row.displayName]),
  )
  const levelOf = new Map(
    db
      .select({ id: pokemon.id, level: pokemon.level, xp: pokemon.xp })
      .from(pokemon)
      .where(eq(pokemon.userId, userId))
      .all()
      .map((row) => [row.id, row]),
  )
  const daycare = {
    slotsUnlocked,
    /** O marco que abre a próxima vaga (null = todas abertas). */
    nextSlotAt: nextDaycareSlotAt(cleared),
    slots: daycareRows
      .map((row) => {
        const fullAt = row.enteredAt + daycareConfig.maxMs
        const mon = levelOf.get(row.pokemonId)
        // Prévia: as horas que faltam até o fim do prazo, com o time e o cuidador de agora.
        const hoursLeft = Math.max(0, Math.floor((fullAt - row.lastSettledAt) / (60 * 60 * 1000)))
        const projected = mon
          ? applyDaycareHours(mon.level, mon.xp, hoursLeft, 1, { context })
          : { level: 0, xp: 0, xpGained: 0 }
        return {
          slotIndex: row.slotIndex,
          pokemonId: row.pokemonId,
          enteredAt: row.enteredAt,
          lastSettledAt: row.lastSettledAt,
          xpGained: row.xpGained,
          fullAt,
          projected: { level: projected.level, xpGained: projected.xpGained },
        }
      })
      .sort((a, b) => a.slotIndex - b.slotIndex),
    caretaker: caretakerOf(userId),
    caretakerTiers: CARETAKER_TIERS.map((tier) => ({
      key: tier.key,
      name: tier.name,
      mult: tier.mult,
      species: tier.species.map((id) => ({ id, name: speciesNames.get(id) ?? `#${id}` })),
    })),
    /** Para a tela simular a estadia de quem ainda vai entrar. */
    rules: {
      levelsPerHour: daycareConfig.levelsPerHour,
      catchUpPerLevel: daycareConfig.catchUpPerLevel,
      catchUpMax: daycareConfig.catchUpMax,
      maxHours: daycareConfig.maxHours,
      xpBase: progressConfig.xpBase,
      xpExponent: progressConfig.xpExponent,
      levelCap: progressConfig.levelCap,
    },
    context,
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
      wonAt: encounters.wonAt,
      catchChance: encounters.catchChance,
      throwCount: encounters.throwCount,
      agitation: encounters.agitation,
      captureRate: species.captureRate,
      type1: species.type1,
      type2: species.type2,
      leaderKey: encounters.leaderKey,
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

  // Cada estrutura é uma peça (PROGRESSAO.md 4.3, passo 2): listas, com o id de cada uma.
  const trees = treesView(userId, now)
  const benches = benchesView(userId, now)
  return {
    now,
    devTools: devToolsEnabled(),
    gardenMaxVisible: progressConfig.gardenMaxVisible,
    uprootSeedReturnChance: berryConfig.uprootSeedReturnChance,
    firstGrowthMult: FIRST_GROWTH_MULT,
    weather: loadWeather(userId, now),
    weatherGrowFactor: weatherConfig.favoriteGrowFactor,
    berries: berryList.map((berry) => ({
      key: berry.key,
      name: berry.name,
      growMs: berry.growMs,
      favoriteWeather: berry.favoriteWeather,
      // Sem energia, a Oran só serve na captura.
      effectDescription: energyBerryOff(berry) ? (berry.capture?.description ?? '') : berry.effectDescription,
      effectKey:
        !berry.effect || berry.effect.kind === 'energy' ? null : berry.effect.effectKey,
      bagUsable: berry.effect !== undefined && !energyBerryOff(berry),
      capture: berry.capture
        ? {
            catchMult: berry.capture.catchMult ?? null,
            calm: berry.capture.calm ?? null,
            candyOnCatch: berry.capture.candyOnCatch ?? null,
            description: berry.capture.description,
          }
        : null,
    })),
    balls: {
      startingPokeBalls: ballsConfig.startingPokeBalls,
      list: ballList.map((ball) => ({
        key: ball.key,
        displayName: ball.displayName,
        sprite: ball.sprite,
        itemKey: `ball:${ball.key}`,
      })),
      catchMult: battleConfig.catchMult,
      catchMin: battleConfig.catchMin,
      throwQualityMult: battleConfig.throwQualityMult,
      throwCurveMult: battleConfig.throwCurveMult,
    },
    battle: {
      k: battleConfig.k,
      minChance: battleConfig.minChance,
      maxChance: battleConfig.maxChance,
      teamWeights: battleConfig.teamWeights,
      fleeBase: battleConfig.fleeBase,
      fleeStep: battleConfig.fleeStep,
      fleeMax: battleConfig.fleeMax,
    },
    progression: {
      levelCap: progressConfig.levelCap,
      candyXp: progressionConfig.candyXp,
      genericPerCandy: progressionConfig.genericPerCandy,
      /** Doces da linha para sortear de novo cada golpe (5.18). */
      moveRerollCost: moveProgressionConfig.rerollCost,
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
      xpToNext: trainerXpToNext(trainer.level),
      energyEnabled: trainerConfig.energyEnabled,
      teamMax: trainerConfig.teamMax,
      currentPlace: currentPlaceOf(userId),
      energy: trainer.energy,
      energyMax: trainerConfig.energyMax,
      energyNextAt: nextEnergyAt(trainer.energy, trainer.energyUpdatedAt),
      energyFullAt: energyFullAt(trainer.energy, trainer.energyUpdatedAt),
      genericCandies: trainer.genericCandies,
      battleAuto: trainer.battleAuto,
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
        moveOffer: mon.moveOffer,
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
        // Para a tela, o PC é mais um lugar (no banco é a coluna in_pc).
        location: mon.inPc ? ('pc' as const) : mon.location,
        teamSlot: mon.teamSlot,
        caughtAt: mon.caughtAt,
        caughtRegion: mon.caughtRegion,
        caughtBall: mon.caughtBall,
        power: power(mon.baseStatTotal, mon.level),
        evolutions: evolutionsBySpecies.get(mon.speciesId) ?? [],
        ivRating: view.ivRating,
        nature: view.nature,
        ability: view.ability,
        stats: view.stats,
        fastMove: view.fastMove,
        chargedMove: view.chargedMove,
        nextChargedMove: view.nextChargedMove,
        moveOffer: view.moveOffer,
        rerollOptions: view.rerollOptions,
        learnset: view.learnset,
        availableMoves: available,
        pet: petView(mon, now),
        /** Fração do HP de luta (0..1); já liquidada no catch-up. */
        hpRatio: mon.hpRatio,
        /** Quando sai do desmaio; null = não está desmaiado. */
        faintedUntil: mon.faintedAt == null ? null : mon.faintedAt + healConfig.faintRecoverMs,
        /** HP máximo de luta (o atual sai do hpRatio). */
        maxHp: battleMaxHp(view.stats.hp),
        /** Habitat onde mora (5.22); null = sem casa. */
        habitatId: mon.habitatId,
      }
    }),
    candies: db.select().from(candies).where(eq(candies.userId, userId)).all(),
    missions: missionsView(userId, trainer.level, now),
    garden: {
      gifts: db
        .select({
          id: gardenGifts.id,
          pokemonId: gardenGifts.pokemonId,
          itemKey: gardenGifts.itemKey,
          quantity: gardenGifts.quantity,
          createdAt: gardenGifts.createdAt,
        })
        .from(gardenGifts)
        .where(eq(gardenGifts.userId, userId))
        .all(),
      needThreshold: petConfig.needThreshold,
      fullAt: petConfig.fullAt,
      fightMinHunger: petConfig.fightMinHunger,
      berryFill: petConfig.berryFill,
      restFullMs: healConfig.restFullMs,
      /** HP ao sair do desmaio; o descanso do jardim segue a partir daí. */
      faintRecoverRatio: healConfig.faintRecoverRatio,
      trees,
      /** Visitantes dos habitats (5.22), um por habitat pronto. */
      visitors: visitorsView(userId),
      benches,
      healMachines: healMachinesView(userId, now),
      // Construção (PROGRESSAO.md 4.3): onde está cada peça e o que está guardado.
      layout: layoutView(userId),
    },
    daycare,
    plots: db
      .select({
        plotIndex: berryPlots.plotIndex,
        berryKey: berryPlots.berryKey,
        plantedAt: berryPlots.plantedAt,
        readyAt: berryPlots.readyAt,
        harvests: berryPlots.harvests,
        deadAt: berryPlots.deadAt,
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
    encounter: pending
      ? toEncounterView({
          ...pending,
          catchChance:
            pending.wonAt != null
              ? catchChance(pending.captureRate, peekCatchBonus(userId, effects))
              : null,
          throwCount: pending.throwCount,
          agitation: pending.agitation,
          captureRate: pending.captureRate,
          type1: pending.type1,
          type2: pending.type2,
        })
      : null,
    pokedex: {
      claimable: countClaimableBlocks(userId),
    },
  }
}

function peekCatchBonus(
  userId: number,
  effects: { userId?: number; effectKey: string; multiplier: number; charges: number | null; id: number }[],
): number {
  const rows = effects
    .filter((effect) => effect.effectKey === 'catch_boost')
    .sort((a, b) => a.id - b.id)
  const chosen = rows.find((row) => row.charges !== null) ?? rows[0]
  return chosen?.multiplier ?? 1
}
