CREATE TABLE `active_effects` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`effect_key` text NOT NULL,
	`multiplier` real DEFAULT 1 NOT NULL,
	`charges` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_active_effects_duration" CHECK("active_effects"."charges" is not null or "active_effects"."expires_at" is not null)
);
--> statement-breakpoint
CREATE INDEX `idx_effects_user` ON `active_effects` (`user_id`);--> statement-breakpoint
CREATE TABLE `berry_plots` (
	`user_id` integer NOT NULL,
	`plot_index` integer NOT NULL,
	`berry_key` text NOT NULL,
	`planted_at` integer NOT NULL,
	`ready_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `plot_index`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `candies` (
	`user_id` integer NOT NULL,
	`evolution_chain_id` integer NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `evolution_chain_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_candies_amount" CHECK("candies"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE `daycare_slots` (
	`user_id` integer NOT NULL,
	`slot_index` integer NOT NULL,
	`pokemon_id` integer NOT NULL,
	`entered_at` integer NOT NULL,
	`last_settled_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `slot_index`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daycare_slots_pokemon_id_unique` ON `daycare_slots` (`pokemon_id`);--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`region_slug` text NOT NULL,
	`species_id` integer NOT NULL,
	`level` integer NOT NULL,
	`is_shiny` integer DEFAULT false NOT NULL,
	`rng_seed` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`fighter_pokemon_id` integer,
	`win_chance` real,
	`catch_chance` real,
	`caught_pokemon_id` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fighter_pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`caught_pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_encounters_status" CHECK("encounters"."status" in ('pending', 'lost', 'caught', 'escaped', 'fled'))
);
--> statement-breakpoint
CREATE INDEX `idx_encounters_user_created` ON `encounters` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_encounters_one_pending` ON `encounters` (`user_id`) WHERE "encounters"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `evolutions` (
	`from_species_id` integer NOT NULL,
	`to_species_id` integer NOT NULL,
	`min_level` integer NOT NULL,
	`candy_cost` integer NOT NULL,
	PRIMARY KEY(`from_species_id`, `to_species_id`),
	FOREIGN KEY (`from_species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`user_id` integer NOT NULL,
	`item_key` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `item_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_inventory_quantity" CHECK("inventory"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE `pokedex_entries` (
	`user_id` integer NOT NULL,
	`species_id` integer NOT NULL,
	`seen_count` integer DEFAULT 0 NOT NULL,
	`caught_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`first_caught_at` integer,
	`shiny_caught` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `species_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pokemon` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`species_id` integer NOT NULL,
	`level` integer NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`is_shiny` integer DEFAULT false NOT NULL,
	`nickname` text,
	`is_favorite` integer DEFAULT false NOT NULL,
	`location` text DEFAULT 'garden' NOT NULL,
	`caught_at` integer NOT NULL,
	`caught_region` text,
	`original_species_id` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_pokemon_location" CHECK("pokemon"."location" in ('garden', 'daycare'))
);
--> statement-breakpoint
CREATE INDEX `idx_pokemon_user` ON `pokemon` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_pokemon_user_species` ON `pokemon` (`user_id`,`species_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `species` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`type1` text NOT NULL,
	`type2` text,
	`hp` integer NOT NULL,
	`attack` integer NOT NULL,
	`defense` integer NOT NULL,
	`sp_attack` integer NOT NULL,
	`sp_defense` integer NOT NULL,
	`speed` integer NOT NULL,
	`base_stat_total` integer NOT NULL,
	`capture_rate` integer NOT NULL,
	`evolution_chain_id` integer NOT NULL,
	`evolves_from_id` integer,
	`evolution_stage` integer DEFAULT 1 NOT NULL,
	`is_legendary` integer DEFAULT false NOT NULL,
	`is_mythical` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`evolves_from_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_species_chain` ON `species` (`evolution_chain_id`);--> statement-breakpoint
CREATE TABLE `trainers` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`energy` integer NOT NULL,
	`energy_updated_at` integer NOT NULL,
	`generic_candies` integer DEFAULT 0 NOT NULL,
	`total_encounters` integer DEFAULT 0 NOT NULL,
	`total_catches` integer DEFAULT 0 NOT NULL,
	`total_releases` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text collate nocase NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);