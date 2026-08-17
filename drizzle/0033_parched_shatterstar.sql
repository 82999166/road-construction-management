CREATE TABLE `machine_daily_operations` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`machineId` int NOT NULL,
	`occurredOn` date NOT NULL,
	`operatorUserId` int,
	`workHours` decimal(8,2) NOT NULL DEFAULT '0',
	`overtimeHours` decimal(8,2) NOT NULL DEFAULT '0',
	`outputAmount` decimal(16,2) NOT NULL DEFAULT '0',
	`driverWageAmount` decimal(16,2) NOT NULL DEFAULT '0',
	`remarks` varchar(500),
	`status` enum('draft','submitted','approved','settled','void') NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `machine_daily_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `machine_daily_operations_machine_project_day_unique` UNIQUE(`machineId`,`projectId`,`occurredOn`)
);
--> statement-breakpoint
CREATE INDEX `machine_daily_operations_project_date_index` ON `machine_daily_operations` (`projectId`,`occurredOn`,`status`);