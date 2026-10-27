import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  customType,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const usernameText = customType<{ data: string }>({
  dataType: () => 'text collate nocase',
})

export const species = sqliteTable(
  'species',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    displayName: text('display_name').notNull(),
    type1: text('type1').notNull(),
    type2: text('type2'),
    hp: integer('hp').notNull(),
    attack: integer('attack').notNull(),
    defense: integer('defense').notNull(),
    spAttack: integer('sp_attack').notNull(),
    spDefense: integer('sp_defense').notNull(),
    speed: integer('speed').notNull(),
    baseStatTotal: integer('base_stat_total').notNull(),
    baseExperience: integer('base_experience').notNull().default(0),
    captureRate: integer('capture_rate').notNull(),
    evolutionChainId: integer('evolution_chain_id').notNull(),
    evolvesFromId: integer('evolves_from_id').references((): AnySQLiteColumn => species.id),
    evolutionStage: integer('evolution_stage').notNull().default(1),
    isLegendary: integer('is_legendary', { mode: 'boolean' }).notNull().default(false),
    isMythical: integer('is_mythical', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [index('idx_species_chain').on(table.evolutionChainId)],
)

export const evolutions = sqliteTable(
  'evolutions',
  {
    fromSpeciesId: integer('from_species_id')
      .notNull()
      .references(() => species.id),
    toSpeciesId: integer('to_species_id')
      .notNull()
      .references(() => species.id),
    minLevel: integer('min_level').notNull(),
    candyCost: integer('candy_cost').notNull(),
    viaTrade: integer('via_trade', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.fromSpeciesId, table.toSpeciesId] })],
)

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey(),
    username: usernameText('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: integer('created_at').notNull(),
  },
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('idx_sessions_user').on(table.userId)],
)

export const authEvents = sqliteTable(
  'auth_events',
  {
    id: integer('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text('event', { enum: ['register', 'login', 'logout'] }).notNull(),
    ip: text('ip').notNull(),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_auth_events_user').on(table.userId),
    index('idx_auth_events_ip').on(table.ip),
    check('ck_auth_events_event', sql`${table.event} in ('register', 'login', 'logout')`),
  ],
)

export const trainers = sqliteTable('trainers', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  level: integer('level').notNull().default(1),
  xp: integer('xp').notNull().default(0),
  energy: integer('energy').notNull(),
  energyUpdatedAt: integer('energy_updated_at').notNull(),
  genericCandies: integer('generic_candies').notNull().default(0),
  totalEncounters: integer('total_encounters').notNull().default(0),
  totalCatches: integer('total_catches').notNull().default(0),
  totalReleases: integer('total_releases').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
})

export const pokemon = sqliteTable(
  'pokemon',
  {
    id: integer('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    speciesId: integer('species_id')
      .notNull()
      .references(() => species.id),
    level: integer('level').notNull(),
    xp: integer('xp').notNull().default(0),
    isShiny: integer('is_shiny', { mode: 'boolean' }).notNull().default(false),
    nickname: text('nickname'),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    location: text('location', { enum: ['garden', 'daycare'] })
      .notNull()
      .default('garden'),
    caughtAt: integer('caught_at').notNull(),
    caughtRegion: text('caught_region'),
    originalSpeciesId: integer('original_species_id')
      .notNull()
      .references(() => species.id),
  },
  (table) => [
    index('idx_pokemon_user').on(table.userId),
    index('idx_pokemon_user_species').on(table.userId, table.speciesId),
    check('ck_pokemon_location', sql`${table.location} in ('garden', 'daycare')`),
  ],
)

export const candies = sqliteTable(
  'candies',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    evolutionChainId: integer('evolution_chain_id').notNull(),
    amount: integer('amount').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.evolutionChainId] }),
    check('ck_candies_amount', sql`${table.amount} >= 0`),
  ],
)

export const daycareSlots = sqliteTable(
  'daycare_slots',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slotIndex: integer('slot_index').notNull(),
    pokemonId: integer('pokemon_id')
      .notNull()
      .unique()
      .references(() => pokemon.id, { onDelete: 'cascade' }),
    enteredAt: integer('entered_at').notNull(),
    lastSettledAt: integer('last_settled_at').notNull(),
    xpGained: integer('xp_gained').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.slotIndex] })],
)

export const encounters = sqliteTable(
  'encounters',
  {
    id: integer('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    regionSlug: text('region_slug').notNull(),
    speciesId: integer('species_id')
      .notNull()
      .references(() => species.id),
    level: integer('level').notNull(),
    isShiny: integer('is_shiny', { mode: 'boolean' }).notNull().default(false),
    rngSeed: integer('rng_seed').notNull(),
    status: text('status', {
      enum: ['pending', 'lost', 'caught', 'escaped', 'fled'],
    })
      .notNull()
      .default('pending'),
    winChance: real('win_chance'),
    catchChance: real('catch_chance'),
    caughtPokemonId: integer('caught_pokemon_id').references(() => pokemon.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (table) => [
    index('idx_encounters_user_created').on(table.userId, sql`${table.createdAt} desc`),
    uniqueIndex('uq_encounters_one_pending')
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    check(
      'ck_encounters_status',
      sql`${table.status} in ('pending', 'lost', 'caught', 'escaped', 'fled')`,
    ),
  ],
)

export const encounterFighters = sqliteTable(
  'encounter_fighters',
  {
    encounterId: integer('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    pokemonId: integer('pokemon_id').references(() => pokemon.id, { onDelete: 'set null' }),
    power: real('power').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.encounterId, table.slot] }),
    check('ck_encounter_fighters_slot', sql`${table.slot} between 0 and 2`),
  ],
)

export const pokedexEntries = sqliteTable(
  'pokedex_entries',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    speciesId: integer('species_id')
      .notNull()
      .references(() => species.id),
    seenCount: integer('seen_count').notNull().default(0),
    caughtCount: integer('caught_count').notNull().default(0),
    firstSeenAt: integer('first_seen_at').notNull(),
    firstCaughtAt: integer('first_caught_at'),
    shinyCaught: integer('shiny_caught', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.userId, table.speciesId] })],
)

export const berryPlots = sqliteTable(
  'berry_plots',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    plotIndex: integer('plot_index').notNull(),
    berryKey: text('berry_key').notNull(),
    plantedAt: integer('planted_at').notNull(),
    readyAt: integer('ready_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.plotIndex] })],
)

export const inventory = sqliteTable(
  'inventory',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemKey: text('item_key').notNull(),
    quantity: integer('quantity').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.itemKey] }),
    check('ck_inventory_quantity', sql`${table.quantity} >= 0`),
  ],
)

export const activeEffects = sqliteTable(
  'active_effects',
  {
    id: integer('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    effectKey: text('effect_key').notNull(),
    multiplier: real('multiplier').notNull().default(1),
    charges: integer('charges'),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_effects_user').on(table.userId),
    check(
      'ck_active_effects_duration',
      sql`${table.charges} is not null or ${table.expiresAt} is not null`,
    ),
  ],
)
