CREATE TABLE `trainer_milestones` (
	`user_id` integer NOT NULL,
	`milestone_key` text NOT NULL,
	`cleared_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `milestone_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `trainer_milestones` (`user_id`, `milestone_key`, `cleared_at`)
SELECT `trainers`.`user_id`, `ladder`.`key`, `trainers`.`updated_at`
FROM `trainers` JOIN (
	SELECT 'violet' AS `key`, 3 AS `level` UNION ALL
	SELECT 'azalea', 6 UNION ALL
	SELECT 'goldenrod', 9 UNION ALL
	SELECT 'ecruteak', 12 UNION ALL
	SELECT 'cianwood', 15 UNION ALL
	SELECT 'olivine', 18 UNION ALL
	SELECT 'mahogany', 21 UNION ALL
	SELECT 'blackthorn', 24 UNION ALL
	SELECT 'league', 30
) AS `ladder` ON `trainers`.`level` >= `ladder`.`level`;
