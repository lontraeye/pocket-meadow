CREATE TABLE `garden_structures` (
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`since` integer NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`operator_pokemon_id` integer,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operator_pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE set null
);
