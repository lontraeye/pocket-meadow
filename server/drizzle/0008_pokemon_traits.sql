ALTER TABLE `species` ADD `ev_hp` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `species` ADD `ev_attack` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `species` ADD `ev_defense` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `species` ADD `ev_sp_attack` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `species` ADD `ev_sp_defense` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `species` ADD `ev_speed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `iv_hp` integer;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `iv_attack` integer;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `iv_defense` integer;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `iv_sp_attack` integer;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `iv_sp_defense` integer;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `iv_speed` integer;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `ev_hp` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `ev_attack` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `ev_defense` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `ev_sp_attack` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `ev_sp_defense` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `ev_speed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `nature` text;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `ability_slot` text;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `fast_move` text;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `charged_move` text;
