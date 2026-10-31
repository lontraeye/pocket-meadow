import { and, eq, sql } from 'drizzle-orm'
import { GENERIC_CANDY_GIFT, petConfig } from '../config/pets.js'
import { progressConfig } from '../config/progress.js'
import { applyLevelMovesToPokemon } from '../game/levelMoves.js'
import { gardenXp, pickGift, settlePet } from '../game/pets.js'
import { bumpMaxLevelReached } from '../game/pokedex.js'
import { xpUntilCap } from '../game/progression.js'
import { unitRoll } from '../game/rng.js'
import { grantXp } from '../game/xp.js'
import { getDb } from './client.js'
import { gardenGifts, pokemon } from './schema.js'

/**
 * Liquida o jardim até `now` (5.21): fome, carinho e felicidade de quem está
 * no jardim, o XP do jardim e os presentes novos. Quem saiu do jardim (PC,
 * daycare) é liquidado uma última vez e fica congelado (`pet_at` null); quem
 * voltou começa a contar agora. Chamado pelo catch-up, dentro da transação.
 */
export function settleGarden(userId: number, now: number): void {
  const db = getDb()
  const rows = db
    .select({
      id: pokemon.id,
      speciesId: pokemon.speciesId,
      level: pokemon.level,
      xp: pokemon.xp,
      location: pokemon.location,
      inPc: pokemon.inPc,
      fastMove: pokemon.fastMove,
      chargedMove: pokemon.chargedMove,
      hunger: pokemon.hunger,
      affection: pokemon.affection,
      happiness: pokemon.happiness,
      petAt: pokemon.petAt,
      lastGiftAt: pokemon.lastGiftAt,
    })
    .from(pokemon)
    .where(eq(pokemon.userId, userId))
    .all()

  let onGround = db
    .select({ count: sql<number>`count(*)` })
    .from(gardenGifts)
    .where(eq(gardenGifts.userId, userId))
    .get()?.count ?? 0

  // Os mais felizes deixam presente primeiro quando o chão está quase cheio.
  rows.sort((a, b) => b.happiness - a.happiness)
  for (const row of rows) {
    const inGarden = row.location === 'garden' && !row.inPc
    if (row.petAt === null) {
      if (inGarden) {
        db.update(pokemon).set({ petAt: now, lastGiftAt: now }).where(eq(pokemon.id, row.id)).run()
      }
      continue
    }
    if (inGarden && now - row.petAt < petConfig.settleMinMs) continue

    const settled = settlePet(row, row.petAt, now)
    const gain = Math.min(
      gardenXp(row.level, settled.averageHappiness, settled.hours),
      xpUntilCap(row.level, row.xp, progressConfig.levelCap),
    )
    const grown = gain > 0 ? grantXp(row.level, row.xp, gain) : { level: row.level, xp: row.xp }

    let lastGiftAt = row.lastGiftAt ?? row.petAt
    if (
      inGarden &&
      settled.happiness >= petConfig.gifts.minHappiness &&
      now - lastGiftAt >= petConfig.gifts.intervalMs &&
      onGround < petConfig.gifts.maxOnGround
    ) {
      const gift = pickGift(petConfig.gifts.table, unitRoll())
      const quantity = gift.min + Math.floor(unitRoll() * (gift.max - gift.min + 1))
      db.insert(gardenGifts)
        .values({
          userId,
          pokemonId: row.id,
          itemKey: gift.kind === 'genericCandy' ? GENERIC_CANDY_GIFT : gift.itemKey,
          quantity,
          createdAt: now,
        })
        .run()
      onGround += 1
      lastGiftAt = now
    }

    db.update(pokemon)
      .set({
        hunger: settled.hunger,
        affection: settled.affection,
        happiness: settled.happiness,
        petAt: inGarden ? now : null,
        lastGiftAt,
        level: grown.level,
        xp: grown.xp,
      })
      .where(and(eq(pokemon.id, row.id), eq(pokemon.userId, userId)))
      .run()

    if (grown.level > row.level) {
      bumpMaxLevelReached(userId, row.speciesId, grown.level)
      if (row.fastMove) {
        applyLevelMovesToPokemon({
          userId,
          pokemonId: row.id,
          speciesId: row.speciesId,
          fromLevel: row.level,
          toLevel: grown.level,
          chargedMove: row.chargedMove,
        })
      }
    }
  }
}
