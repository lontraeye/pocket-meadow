ALTER TABLE `trainers` ADD `weather_seed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `trainers` SET `weather_seed` = (random() & 4294967295);
