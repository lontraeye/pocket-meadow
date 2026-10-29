ALTER TABLE `trainers` ADD `current_place` text DEFAULT 'new-bark' NOT NULL;--> statement-breakpoint
CREATE TABLE `trainer_places` (
	`user_id` integer NOT NULL,
	`place_slug` text NOT NULL,
	`first_visit_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `place_slug`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `trainer_places` (`user_id`, `place_slug`, `first_visit_at`) SELECT `user_id`, 'new-bark', `updated_at` FROM `trainers`;
