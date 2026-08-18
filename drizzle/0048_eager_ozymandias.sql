CREATE TABLE `subcontract_packages` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`packageNo` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`measurementTakeoffId` bigint,
	`subcontractTeamId` bigint NOT NULL,
	`workItem` varchar(200) NOT NULL,
	`workLocation` varchar(200),
	`unit` enum('m3','m2','m','t','piece','set','other') NOT NULL,
	`quantity` decimal(16,3) NOT NULL,
	`upstreamUnitPrice` decimal(16,2) NOT NULL DEFAULT '0',
	`subcontractUnitPrice` decimal(16,2) NOT NULL DEFAULT '0',
	`upstreamAmount` decimal(16,2) NOT NULL,
	`subcontractAmount` decimal(16,2) NOT NULL,
	`marginAmount` decimal(16,2) NOT NULL,
	`status` enum('draft','allocated','confirmed','settled','void') NOT NULL DEFAULT 'draft',
	`allocatedAt` datetime,
	`settledAt` datetime,
	`remarks` varchar(500),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subcontract_packages_id` PRIMARY KEY(`id`),
	CONSTRAINT `subcontract_packages_no_unique` UNIQUE(`packageNo`)
);
--> statement-breakpoint
CREATE TABLE `subcontract_teams` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`teamName` varchar(200) NOT NULL,
	`contactName` varchar(100),
	`contactPhoneEncrypted` text,
	`contactPhoneMasked` varchar(32),
	`status` enum('active','suspended','closed') NOT NULL DEFAULT 'active',
	`remarks` varchar(500),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subcontract_teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `subcontract_teams_project_name_unique` UNIQUE(`projectId`,`teamName`)
);
--> statement-breakpoint
CREATE INDEX `subcontract_packages_project_status_index` ON `subcontract_packages` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `subcontract_packages_team_index` ON `subcontract_packages` (`subcontractTeamId`);--> statement-breakpoint
CREATE INDEX `subcontract_packages_takeoff_index` ON `subcontract_packages` (`measurementTakeoffId`);--> statement-breakpoint
CREATE INDEX `subcontract_teams_project_status_index` ON `subcontract_teams` (`projectId`,`status`);