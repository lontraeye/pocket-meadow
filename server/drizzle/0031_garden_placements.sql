CREATE TABLE `garden_placements` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`piece` text NOT NULL,
	`slot` integer DEFAULT 0 NOT NULL,
	`col` integer NOT NULL,
	`row` integer NOT NULL,
	`placed_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_garden_placements_cell` ON `garden_placements` (`user_id`,`col`,`row`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_garden_placements_piece` ON `garden_placements` (`user_id`,`piece`,`slot`);--> statement-breakpoint
ALTER TABLE `trainers` ADD `garden_layout_at` integer;
