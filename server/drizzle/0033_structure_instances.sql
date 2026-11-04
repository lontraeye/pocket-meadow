CREATE TABLE `__new_garden_structures` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`since` integer NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`operator_pokemon_id` integer,
	`upgrade_to` integer,
	`upgrade_ends_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operator_pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_garden_structures`("user_id", "key", "level", "since", "progress", "operator_pokemon_id", "upgrade_to", "upgrade_ends_at") SELECT "user_id", "key", "level", "since", "progress", "operator_pokemon_id", "upgrade_to", "upgrade_ends_at" FROM `garden_structures`;--> statement-breakpoint
DROP TABLE `garden_structures`;--> statement-breakpoint
ALTER TABLE `__new_garden_structures` RENAME TO `garden_structures`;--> statement-breakpoint
CREATE INDEX `idx_garden_structures_user` ON `garden_structures` (`user_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_garden_structures_keeper` ON `garden_structures` (`user_id`) WHERE "garden_structures"."key" = 'daycare_keeper';--> statement-breakpoint
ALTER TABLE `garden_placements` ADD `structure_id` integer REFERENCES garden_structures(id) ON DELETE cascade;--> statement-breakpoint
UPDATE `garden_placements` SET `structure_id` = (
	SELECT `s`.`id` FROM `garden_structures` AS `s`
	WHERE `s`.`user_id` = `garden_placements`.`user_id` AND `s`.`key` = `garden_placements`.`piece`
) WHERE `piece` <> 'berry_plot';--> statement-breakpoint
DELETE FROM `garden_placements` WHERE `piece` <> 'berry_plot' AND `structure_id` IS NULL;--> statement-breakpoint
DROP INDEX `ux_garden_placements_piece`;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_garden_placements_plot` ON `garden_placements` (`user_id`,`slot`) WHERE "garden_placements"."piece" = 'berry_plot';--> statement-breakpoint
CREATE UNIQUE INDEX `ux_garden_placements_structure` ON `garden_placements` (`structure_id`) WHERE "garden_placements"."structure_id" is not null;--> statement-breakpoint
ALTER TABLE `craft_jobs` ADD `structure_id` integer REFERENCES garden_structures(id) ON DELETE cascade;--> statement-breakpoint
UPDATE `craft_jobs` SET `structure_id` = (
	SELECT `s`.`id` FROM `garden_structures` AS `s`
	WHERE `s`.`user_id` = `craft_jobs`.`user_id` AND `s`.`key` = `craft_jobs`.`structure_key`
);--> statement-breakpoint
CREATE INDEX `idx_craft_jobs_structure` ON `craft_jobs` (`structure_id`);
