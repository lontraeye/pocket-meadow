ALTER TABLE `encounters` ADD `won_at` integer;--> statement-breakpoint
ALTER TABLE `encounters` ADD `throw_count` integer DEFAULT 0 NOT NULL;
