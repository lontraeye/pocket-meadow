ALTER TABLE `trainers` ADD `garden_min_col` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trainers` ADD `garden_min_row` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trainers` ADD `garden_max_col` integer DEFAULT 11 NOT NULL;--> statement-breakpoint
ALTER TABLE `trainers` ADD `garden_max_row` integer DEFAULT 11 NOT NULL;--> statement-breakpoint
ALTER TABLE `trainers` ADD `garden_expansions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trainers` ADD `garden_expand_side` text;--> statement-breakpoint
ALTER TABLE `trainers` ADD `garden_expand_started_at` integer;--> statement-breakpoint
ALTER TABLE `trainers` ADD `garden_expand_ready_at` integer;
