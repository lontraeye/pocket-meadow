ALTER TABLE `habitats` ADD `visitor_next_at` integer;--> statement-breakpoint
CREATE TABLE `habitat_visitors` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`habitat_id` integer NOT NULL,
	`species_id` integer NOT NULL,
	`level` integer NOT NULL,
	`is_shiny` integer DEFAULT false NOT NULL,
	`arrived_at` integer NOT NULL,
	`leaves_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`habitat_id`) REFERENCES `habitats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_habitat_visitors_habitat` ON `habitat_visitors` (`habitat_id`);--> statement-breakpoint
CREATE INDEX `idx_habitat_visitors_user` ON `habitat_visitors` (`user_id`);
