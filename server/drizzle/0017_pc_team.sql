ALTER TABLE `pokemon` ADD `in_pc` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `team_slot` integer CONSTRAINT "ck_pokemon_team_slot" CHECK(`team_slot` is null or `team_slot` between 0 and 5);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pokemon_team_slot` ON `pokemon` (`user_id`,`team_slot`) WHERE "pokemon"."team_slot" is not null;--> statement-breakpoint
UPDATE `pokemon` SET `team_slot` = (
	SELECT `ranked`.`rn` - 1 FROM (
		SELECT `id`, row_number() OVER (PARTITION BY `user_id` ORDER BY `is_favorite` DESC, `level` DESC, `id`) AS `rn`
		FROM `pokemon` WHERE `location` = 'garden'
	) AS `ranked`
	WHERE `ranked`.`id` = `pokemon`.`id` AND `ranked`.`rn` <= 6
) WHERE `location` = 'garden';--> statement-breakpoint
CREATE TABLE `__new_encounter_fighters` (
	`encounter_id` integer NOT NULL,
	`slot` integer NOT NULL,
	`pokemon_id` integer,
	`power` real NOT NULL,
	PRIMARY KEY(`encounter_id`, `slot`),
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_encounter_fighters_slot" CHECK("__new_encounter_fighters"."slot" between 0 and 5)
);--> statement-breakpoint
INSERT INTO `__new_encounter_fighters`("encounter_id", "slot", "pokemon_id", "power") SELECT "encounter_id", "slot", "pokemon_id", "power" FROM `encounter_fighters`;--> statement-breakpoint
DROP TABLE `encounter_fighters`;--> statement-breakpoint
ALTER TABLE `__new_encounter_fighters` RENAME TO `encounter_fighters`;
