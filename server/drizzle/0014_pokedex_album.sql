CREATE TABLE `pokedex_claims` (
	`user_id` integer NOT NULL,
	`block_key` text NOT NULL,
	`claimed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `block_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `pokedex_entries` ADD `max_level_reached` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `pokedex_entries`
SET `max_level_reached` = coalesce((
  SELECT max(`pokemon`.`level`)
  FROM `pokemon`
  WHERE `pokemon`.`user_id` = `pokedex_entries`.`user_id`
    AND `pokemon`.`species_id` = `pokedex_entries`.`species_id`
), 0);
