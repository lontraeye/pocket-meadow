ALTER TABLE `trainers` ADD `starter_species_id` integer;--> statement-breakpoint
CREATE TABLE `trainer_rivals` (
	`user_id` integer NOT NULL,
	`rival_key` text NOT NULL,
	`cleared_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `rival_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
