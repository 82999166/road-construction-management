CREATE TABLE `construction_assistant_daily_usage` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`usageDate` date NOT NULL,
	`channel` enum('ai','voice') NOT NULL,
	`attemptCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `construction_assistant_daily_usage_id` PRIMARY KEY(`id`),
	CONSTRAINT `construction_assistant_usage_user_date_channel_unique` UNIQUE(`userId`,`usageDate`,`channel`)
);
--> statement-breakpoint
CREATE TABLE `construction_input_memory` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`field` varchar(32) NOT NULL,
	`content` text NOT NULL,
	`contentHash` varchar(64) NOT NULL,
	`usedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `construction_input_memory_id` PRIMARY KEY(`id`),
	CONSTRAINT `construction_input_memory_user_project_field_hash_unique` UNIQUE(`userId`,`projectId`,`field`,`contentHash`)
);
--> statement-breakpoint
CREATE INDEX `construction_input_memory_recent_index` ON `construction_input_memory` (`userId`,`projectId`,`field`,`usedAt`);