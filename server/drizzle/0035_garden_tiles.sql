CREATE TABLE `garden_tiles` (
	`user_id` integer NOT NULL,
	`col` integer NOT NULL,
	`row` integer NOT NULL,
	`floor` text NOT NULL,
	PRIMARY KEY(`user_id`, `col`, `row`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `pokemon` ADD `home_col` integer;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `home_row` integer;
