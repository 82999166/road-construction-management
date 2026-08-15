CREATE TABLE `user_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`permissionId` int NOT NULL,
	`grantedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_permissions_unique` UNIQUE(`userId`,`permissionId`)
);
--> statement-breakpoint
ALTER TABLE `machine_cost_records` ADD `dieselRefuelRecordId` bigint;--> statement-breakpoint
ALTER TABLE `machine_cost_records` ADD CONSTRAINT `machine_cost_records_diesel_refuel_unique` UNIQUE(`dieselRefuelRecordId`);--> statement-breakpoint
CREATE INDEX `user_permissions_user_index` ON `user_permissions` (`userId`);