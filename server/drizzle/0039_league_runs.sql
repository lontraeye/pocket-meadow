CREATE TABLE `league_runs` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`stage` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`finished_at` integer,
	`team` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_league_runs_stage" CHECK(`stage` >= 0 and `stage` <= 4),
	CONSTRAINT "ck_league_runs_status" CHECK(`status` in ('active', 'won', 'lost', 'abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_league_runs_one_active` ON `league_runs` (`user_id`) WHERE `status` = 'active';
