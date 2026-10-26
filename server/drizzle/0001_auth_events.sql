CREATE TABLE `auth_events` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`event` text NOT NULL,
	`ip` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_auth_events_event" CHECK("auth_events"."event" in ('register', 'login', 'logout'))
);
--> statement-breakpoint
CREATE INDEX `idx_auth_events_user` ON `auth_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_events_ip` ON `auth_events` (`ip`);