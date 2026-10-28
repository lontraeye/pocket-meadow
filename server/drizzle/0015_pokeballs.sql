ALTER TABLE `pokemon` ADD `caught_ball` text DEFAULT 'poke' NOT NULL;--> statement-breakpoint
ALTER TABLE `encounters` ADD `agitation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
INSERT INTO `inventory` (`user_id`, `item_key`, `quantity`)
SELECT `user_id`, 'ball:poke', 0
FROM `trainers`
WHERE NOT EXISTS (
  SELECT 1 FROM `inventory` AS `i`
  WHERE `i`.`user_id` = `trainers`.`user_id`
    AND `i`.`item_key` = 'ball:poke'
);--> statement-breakpoint
UPDATE `inventory`
SET `quantity` = `quantity` + 30
WHERE `item_key` = 'ball:poke';
