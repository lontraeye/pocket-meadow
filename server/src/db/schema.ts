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
    evHp: integer('ev_hp').notNull().default(0),
    evAttack: integer('ev_attack').notNull().default(0),
    evDefense: integer('ev_defense').notNull().default(0),
    evSpAttack: integer('ev_sp_attack').notNull().default(0),
    evSpDefense: integer('ev_sp_defense').notNull().default(0),
    evSpeed: integer('ev_speed').notNull().default(0),
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
    // `sub` do Google (só o ID, sem e-mail). NULL só em contas de teste locais.
    googleSub: text('google_sub').unique(),
    createdAt: integer('created_at').notNull(),
  },
)

// Quem voltou do Google sem conta e ainda vai escolher nome e inicial.
export const googleSignups = sqliteTable(
  'google_signups',
  {
    id: text('id').primaryKey(), // SHA-256 do token do cookie, como em sessions
    googleSub: text('google_sub').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
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
  /** Preferência do treinador: luta com o jogador automático (8.5). */
  battleAuto: integer('battle_auto', { mode: 'boolean' }).notNull().default(false),
  /** Semente do clima do dia (5.11): sorteada na criação, nunca vai ao front. */
  weatherSeed: integer('weather_seed').notNull().default(0),
  /** Onde o treinador está na jornada (JORNADA.md, seção 11): slug do lugar. */
  currentPlace: text('current_place').notNull().default('new-bark'),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * Campo de encontro (PLANNING.md 5.14): os Pokémon andando no gramado de cada
 * área, por jogador. Sorteados e salvos antes de aparecer (sem rerolar); quem
 * é enfrentado sai e a vaga fica vazia até o campo ser explorado de novo.
 */
export const fieldSpawns = sqliteTable(
  'field_spawns',
  {
    id: integer('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    regionSlug: text('region_slug').notNull(),
    slot: integer('slot').notNull(),
    speciesId: integer('species_id')
      .notNull()
      .references(() => species.id),
    level: integer('level').notNull(),
    isShiny: integer('is_shiny', { mode: 'boolean' }).notNull().default(false),
    /** Semente do encontro: o sorteio do selvagem saiu dela (replay da seção 7). */
    rngSeed: integer('rng_seed').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('uq_field_spawns_slot').on(table.userId, table.regionSlug, table.slot)],
)

/** Marcos conquistados (JORNADA.md, seção 6): abrem capítulos e ferramentas. */
export const trainerMilestones = sqliteTable(
  'trainer_milestones',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    milestoneKey: text('milestone_key').notNull(),
    clearedAt: integer('cleared_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.milestoneKey] })],
)

/** Lugares já visitados: Voo, selo "novo" e aviso de chegada. */
export const trainerPlaces = sqliteTable(
  'trainer_places',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    placeSlug: text('place_slug').notNull(),
    firstVisitAt: integer('first_visit_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.placeSlug] })],
)

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
    /**
     * Guardado no PC: some do jardim e fica parado. É coluna à parte (e não
     * um location 'pc') porque mudar o CHECK de location pede recriar a
     * tabela, e o DROP apagaria em cascata o daycare e os encontros.
     */
    inPc: integer('in_pc', { mode: 'boolean' }).notNull().default(false),
    /** Posição no time (0 a 5); null = fora do time. */
    teamSlot: integer('team_slot'),
    caughtAt: integer('caught_at').notNull(),
    caughtRegion: text('caught_region'),
    /** Chave da bola usada na captura (`poke`, `great`…). */
    caughtBall: text('caught_ball').notNull().default('poke'),
    originalSpeciesId: integer('original_species_id')
      .notNull()
      .references(() => species.id),
    // Traços (5.18 / Fase 8.1). NULL só até o backfill; inserts novos sempre preenchem.
    ivHp: integer('iv_hp'),
    ivAttack: integer('iv_attack'),
    ivDefense: integer('iv_defense'),
    ivSpAttack: integer('iv_sp_attack'),
    ivSpDefense: integer('iv_sp_defense'),
    ivSpeed: integer('iv_speed'),
    evHp: integer('ev_hp').notNull().default(0),
    evAttack: integer('ev_attack').notNull().default(0),
    evDefense: integer('ev_defense').notNull().default(0),
    evSpAttack: integer('ev_sp_attack').notNull().default(0),
    evSpDefense: integer('ev_sp_defense').notNull().default(0),
    evSpeed: integer('ev_speed').notNull().default(0),
    nature: text('nature'),
    abilitySlot: text('ability_slot', { enum: ['1', '2', 'hidden'] }),
    fastMove: text('fast_move'),
    chargedMove: text('charged_move'),
    /**
     * Golpe oferecido ao subir de nível (5.18), esperando aprender ou manter;
     * o slot sai do poder dele. null = nenhuma oferta.
     */
    moveOffer: text('move_offer'),
    // Cuidado como pet (5.21): valores de 0 a 100 no instante `petAt`.
    hunger: real('hunger').notNull().default(80),
    affection: real('affection').notNull().default(60),
    happiness: real('happiness').notNull().default(20),
    /** Até quando fome, carinho e felicidade foram liquidados; null = fora do jardim (congelado). */
    petAt: integer('pet_at'),
    lastPetAt: integer('last_pet_at'),
    /** Último presente (ou a entrada no jardim): o próximo sai `intervalMs` depois. */
    lastGiftAt: integer('last_gift_at'),
  },
  (table) => [
    index('idx_pokemon_user').on(table.userId),
    index('idx_pokemon_user_species').on(table.userId, table.speciesId),
    check('ck_pokemon_location', sql`${table.location} in ('garden', 'daycare')`),
    check('ck_pokemon_team_slot', sql`${table.teamSlot} is null or ${table.teamSlot} between 0 and 5`),
    uniqueIndex('uq_pokemon_team_slot')
      .on(table.userId, table.teamSlot)
      .where(sql`${table.teamSlot} is not null`),
    check(
      'ck_pokemon_ability_slot',
      sql`${table.abilitySlot} is null or ${table.abilitySlot} in ('1', '2', 'hidden')`,
    ),
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

// Presentes que os pets deixam no chão do jardim (5.21), sorteados ao surgir.
export const gardenGifts = sqliteTable(
  'garden_gifts',
  {
    id: integer('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pokemonId: integer('pokemon_id').references(() => pokemon.id, { onDelete: 'set null' }),
    /** Chave do inventário (`seed:oran`, `ball:poke`) ou `generic_candy`. */
    itemKey: text('item_key').notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_garden_gifts_user').on(table.userId)],
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
    // Seed dos lançamentos e da semente da vitória: nunca vai para o front.
    // A rng_seed é recuperável pela seed da luta; esta não (PLANNING.md, seção 5.18).
    secretSeed: integer('secret_seed'),
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
    /** Início da luta manual (8.3); null na batalha automática da 8.2. */
    battleStartedAt: integer('battle_started_at'),
    /** Setup JSON congelado no start (finish refaz a luta com este snapshot). */
    battleSetupJson: text('battle_setup_json'),
    /**
     * Vitória aguardando decisão de captura (8.4). Continua `pending`;
     * null = ainda não venceu (ou já resolveu).
     */
    wonAt: integer('won_at'),
    /** Quantos lançamentos já foram feitos neste encontro vencido. */
    throwCount: integer('throw_count').notNull().default(0),
    /** Erros de captura acumulados; sobe a fuga (Fase 9.2). */
    agitation: integer('agitation').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    resolvedAt: integer('resolved_at'),
    /**
     * Luta contra líder (leaders.ts): o marco do líder; null = selvagem. A
     * espécie e o nível são os do 1º Pokémon dele; a luta é contra o time todo.
     * Vitória contra o líder fica 'escaped' (não há captura).
     */
    leaderKey: text('leader_key'),
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
    check('ck_encounter_fighters_slot', sql`${table.slot} between 0 and 5`),
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
    /** Maior nível já alcançado com a espécie (sobrevive a soltar). */
    maxLevelReached: integer('max_level_reached').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.speciesId] })],
)

/** Resgates do álbum da Pokédex (chave versionada do bloco). */
export const pokedexClaims = sqliteTable(
  'pokedex_claims',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockKey: text('block_key').notNull(),
    claimedAt: integer('claimed_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.blockKey] })],
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
