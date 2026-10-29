CREATE TABLE `field_spawns` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`region_slug` text NOT NULL,
	`slot` integer NOT NULL,
	`species_id` integer NOT NULL,
	`level` integer NOT NULL,
	`is_shiny` integer DEFAULT false NOT NULL,
	`rng_seed` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_field_spawns_slot` ON `field_spawns` (`user_id`,`region_slug`,`slot`);
