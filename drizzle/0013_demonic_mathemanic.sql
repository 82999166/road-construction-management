CREATE TABLE `data_backups` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`recordCount` int NOT NULL,
	`scopeVersion` varchar(32) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_backups_id` PRIMARY KEY(`id`),
	CONSTRAINT `data_backups_file_key_unique` UNIQUE(`fileKey`)
);
--> statement-breakpoint
CREATE INDEX `data_backups_created_at_index` ON `data_backups` (`createdAt`);