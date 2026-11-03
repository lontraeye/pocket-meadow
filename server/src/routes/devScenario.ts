import { and, eq, inArray } from 'drizzle-orm'
import { APRICORN_ITEM, TREES, apricornConfig } from '../config/apricorn.js'
import { daycareConfig } from '../config/daycare.js'
import { persistCatchUp } from '../db/catchUp.js'
import { getDb } from '../db/client.js'
import { treeView } from '../db/apricorn.js'
import { setOperator, startJob } from '../db/bench.js'
import { creditItems } from '../db/inventory.js'
import { ensureMissionDay } from '../db/missions.js'
import {
  berryPlots,
  craftJobs,
  daycareSlots,
  dailyMissions,
  encounters,
  gardenGifts,
  gardenStructures,
  pokemon,
  trainers,
} from '../db/schema.js'
import { mulberry32, randomSeed } from '../game/rng.js'
import { traitColumns } from '../game/traitValues.js'
import { rollTraits, traitsRngSeed } from '../game/traits.js'
import { abilitiesFor, learnsetFor, movesByName } from '../seed/traitsData.js'

// Cenário de teste do aviso de "pronto" (PLANNING.md, 6.1): deixa a conta com
// um pouco de tudo esperando. Só pelas rotas /dev. Chamar dentro de immediate().

type Mon = { speciesId: number; hunger: number; affection: number; happiness: number }

// Sentret, Hoothoot, Hoppip, Wooper, Ledyba: dois com fome, um querendo
// carinho, um feliz e um que vai para o daycare.
const GARDEN: Mon[] = [
  { speciesId: 161, hunger: 15, affection: 70, happiness: 50 },
  { speciesId: 163, hunger: 25, affection: 70, happiness: 50 },
  { speciesId: 187, hunger: 80, affection: 15, happiness: 30 },
  { speciesId: 194, hunger: 90, affection: 90, happiness: 90 },
]
const DAYCARE_SPECIES = 165

export function applyReadyScenario(userId: number, now: number): void {
  persistCatchUp(userId, now)
  const db = getDb()
  const trainer = db.select({ level: trainers.level }).from(trainers).where(eq(trainers.userId, userId)).get()
  if (!trainer) throw new Error(`trainer missing for user ${userId}`)

  const addMon = (speciesId: number) => {
    const traits = rollTraits(mulberry32(traitsRngSeed(randomSeed())), {
      level: 5,
      learnset: learnsetFor(speciesId),
      abilities: abilitiesFor(speciesId),
      moves: movesByName(),
    })
    const row = db
      .insert(pokemon)
      .values({ userId, speciesId, level: 5, caughtAt: now, originalSpeciesId: speciesId, ...traitColumns(traits) })
      .returning({ id: pokemon.id })
      .get()
    if (!row) throw new Error('failed to add scenario pokemon')
    return row.id
  }

  // Pets: necessidades valendo agora; presente recém-dado para não nascer outro.
  const ids = GARDEN.map((mon) => {
    const id = addMon(mon.speciesId)
    db.update(pokemon)
      .set({ hunger: mon.hunger, affection: mon.affection, happiness: mon.happiness, petAt: now, lastPetAt: null, lastGiftAt: now })
      .where(eq(pokemon.id, id))
      .run()
    return id
  })

  // Presentes no chão.
  db.insert(gardenGifts)
    .values([
      { userId, pokemonId: ids[3] ?? null, itemKey: 'ball:poke', quantity: 2, createdAt: now },
      { userId, pokemonId: ids[3] ?? null, itemKey: 'seed:oran', quantity: 1, createdAt: now },
    ])
    .run()

  // Daycare cheio na vaga 0 (aberta desde o nível 1), se estiver livre.
  const taken = db
    .select({ slot: daycareSlots.slotIndex })
    .from(daycareSlots)
    .where(and(eq(daycareSlots.userId, userId), eq(daycareSlots.slotIndex, 0)))
    .get()
  if (!taken) {
    const id = addMon(DAYCARE_SPECIES)
    const enteredAt = now - daycareConfig.maxMs - 60_000
    db.insert(daycareSlots).values({ userId, slotIndex: 0, pokemonId: id, enteredAt, lastSettledAt: enteredAt }).run()
    db.update(pokemon).set({ location: 'daycare' }).where(eq(pokemon.id, id)).run()
  }

  // Os 2 canteiros do nível 1 com Oran pronta.
  db.delete(berryPlots)
    .where(and(eq(berryPlots.userId, userId), inArray(berryPlots.plotIndex, [0, 1])))
    .run()
  db.insert(berryPlots)
    .values([0, 1].map((plotIndex) => ({ userId, plotIndex, berryKey: 'oran', plantedAt: now - 3_600_000, readyAt: now - 60_000 })))
    .run()

  // Árvore de Apricorn cheia (5.23); sobe o treinador até o nível que abre a árvore.
  const level = Math.max(trainer.level, apricornConfig.unlockLevel)
  if (level !== trainer.level) db.update(trainers).set({ level, xp: 0 }).where(eq(trainers.userId, userId)).run()
  treeView(userId, level, now)
  db.update(gardenStructures)
    .set({ progress: TREES[0]!.cap, since: now })
    .where(and(eq(gardenStructures.userId, userId), eq(gardenStructures.key, 'apricorn_tree')))
    .run()

  // Bancada (5.23): o Sentret opera um lote de 5 com 2 bolas já prontas.
  const operatorId = ids[0]!
  if (setOperator(userId, level, operatorId, now).ok) {
    creditItems(userId, [{ itemKey: APRICORN_ITEM, quantity: 5 }])
    const started = startJob(userId, level, 'poke_ball', 5, now)
    if (started.ok) {
      db.update(craftJobs)
        .set({ startedAt: now - Math.round(started.job.unitMs * 2.5) })
        .where(eq(craftJobs.id, started.job.id))
        .run()
    }
  }

  // Missão do slot 0 vira "vencer 1 luta", já cumprida por uma luta vencida agora.
  const day = ensureMissionDay(userId, level, now)
  db.update(dailyMissions)
    .set({ kind: 'win_any', params: '{}', target: 1, assignedAt: now - 60_000, claimedAt: null })
    .where(and(eq(dailyMissions.userId, userId), eq(dailyMissions.day, day), eq(dailyMissions.slot, 0)))
    .run()
  db.insert(encounters)
    .values({ userId, regionSlug: 'route-29', speciesId: 161, level: 3, rngSeed: randomSeed(), status: 'fled', wonAt: now, resolvedAt: now, createdAt: now, expiresAt: now })
    .run()
}
