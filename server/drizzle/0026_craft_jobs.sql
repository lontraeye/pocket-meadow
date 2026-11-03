CREATE TABLE `craft_jobs` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`structure_key` text NOT NULL,
	`recipe_key` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_ms` integer NOT NULL,
	`started_at` integer NOT NULL,
	`collected` integer DEFAULT 0 NOT NULL,
	`cancelled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_craft_jobs_user` ON `craft_jobs` (`user_id`,`structure_key`);
