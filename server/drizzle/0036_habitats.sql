CREATE TABLE `habitats` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_habitats_user` ON `habitats` (`user_id`);--> statement-breakpoint
CREATE TABLE `habitat_tiles` (
	`habitat_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`col` integer NOT NULL,
	`row` integer NOT NULL,
	PRIMARY KEY(`user_id`, `col`, `row`),
	FOREIGN KEY (`habitat_id`) REFERENCES `habitats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_habitat_tiles_habitat` ON `habitat_tiles` (`habitat_id`);--> statement-breakpoint
ALTER TABLE `pokemon` ADD `habitat_id` integer REFERENCES habitats(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `pokemon` DROP COLUMN `home_col`;--> statement-breakpoint
ALTER TABLE `pokemon` DROP COLUMN `home_row`;
