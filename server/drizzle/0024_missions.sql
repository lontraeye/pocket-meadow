CREATE TABLE `daily_missions` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`day` text NOT NULL,
	`slot` integer NOT NULL,
	`kind` text NOT NULL,
	`params` text NOT NULL,
	`target` integer NOT NULL,
	`assigned_at` integer NOT NULL,
	`claimed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_daily_missions_slot` ON `daily_missions` (`user_id`,`day`,`slot`);--> statement-breakpoint
CREATE TABLE `mission_days` (
	`user_id` integer NOT NULL,
	`day` text NOT NULL,
	`rerolls_used` integer DEFAULT 0 NOT NULL,
	`chest_claimed_at` integer,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
