ALTER TABLE `pokemon` ADD `hunger` real DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `affection` real DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `happiness` real DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `pet_at` integer;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `last_pet_at` integer;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `last_gift_at` integer;--> statement-breakpoint
CREATE TABLE `garden_gifts` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`pokemon_id` integer,
	`item_key` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `idx_garden_gifts_user` ON `garden_gifts` (`user_id`);
