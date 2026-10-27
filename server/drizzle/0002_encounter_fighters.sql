CREATE TABLE `encounter_fighters` (
	`encounter_id` integer NOT NULL,
	`slot` integer NOT NULL,
	`pokemon_id` integer,
	`power` real NOT NULL,
	PRIMARY KEY(`encounter_id`, `slot`),
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_encounter_fighters_slot" CHECK("encounter_fighters"."slot" between 0 and 2)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_encounters` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`region_slug` text NOT NULL,
	`species_id` integer NOT NULL,
	`level` integer NOT NULL,
	`is_shiny` integer DEFAULT false NOT NULL,
	`rng_seed` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`win_chance` real,
	`catch_chance` real,
	`caught_pokemon_id` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`caught_pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_encounters_status" CHECK("__new_encounters"."status" in ('pending', 'lost', 'caught', 'escaped', 'fled'))
);
--> statement-breakpoint
INSERT INTO `__new_encounters`("id", "user_id", "region_slug", "species_id", "level", "is_shiny", "rng_seed", "status", "win_chance", "catch_chance", "caught_pokemon_id", "created_at", "expires_at", "resolved_at") SELECT "id", "user_id", "region_slug", "species_id", "level", "is_shiny", "rng_seed", "status", "win_chance", "catch_chance", "caught_pokemon_id", "created_at", "expires_at", "resolved_at" FROM `encounters`;--> statement-breakpoint
DROP TABLE `encounters`;--> statement-breakpoint
ALTER TABLE `__new_encounters` RENAME TO `encounters`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_encounters_user_created` ON `encounters` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_encounters_one_pending` ON `encounters` (`user_id`) WHERE "encounters"."status" = 'pending';