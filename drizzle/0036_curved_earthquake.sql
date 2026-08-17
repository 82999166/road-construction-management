CREATE TABLE `project_risk_alerts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`businessDate` date NOT NULL,
	`category` enum('construction','attendance','fuel','transport') NOT NULL,
	`severity` enum('notice','warning','critical') NOT NULL DEFAULT 'warning',
	`ruleCode` varchar(64) NOT NULL,
	`sourceType` varchar(64) NOT NULL,
	`sourceId` varchar(128) NOT NULL,
	`title` varchar(200) NOT NULL,
	`summary` varchar(1000) NOT NULL,
	`evidenceJson` text,
	`status` enum('open','acknowledged','resolved','ignored') NOT NULL DEFAULT 'open',
	`notifiedAt` datetime,
	`acknowledgedBy` int,
	`acknowledgedAt` datetime,
	`resolvedBy` int,
	`resolvedAt` datetime,
	`resolutionNote` varchar(1000),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_risk_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_risk_alerts_unique` UNIQUE(`projectId`,`ruleCode`,`sourceId`,`businessDate`)
);
--> statement-breakpoint
CREATE TABLE `project_risk_briefings` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`period` varchar(7) NOT NULL,
	`model` varchar(128) NOT NULL,
	`summaryJson` text NOT NULL,
	`alertSnapshotJson` text NOT NULL,
	`generatedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_risk_briefings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_risk_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`maxFuelFillRatio` decimal(6,3) NOT NULL DEFAULT '1.100',
	`maxTransportSpeedKmh` decimal(8,2) NOT NULL DEFAULT '80.00',
	`maxTransportDurationMinutes` int NOT NULL DEFAULT 360,
	`maxOpenCheckInHours` int NOT NULL DEFAULT 14,
	`maxPendingReportHours` int NOT NULL DEFAULT 24,
	`createdBy` int,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_risk_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_risk_rules_project_unique` UNIQUE(`projectId`)
);
--> statement-breakpoint
ALTER TABLE `machines` ADD `fuelTankCapacityLiters` decimal(10,2);--> statement-breakpoint
ALTER TABLE `transport_vehicles` ADD `fuelTankCapacityLiters` decimal(10,2);--> statement-breakpoint
CREATE INDEX `project_risk_alerts_project_status_date_index` ON `project_risk_alerts` (`projectId`,`status`,`businessDate`);--> statement-breakpoint
CREATE INDEX `project_risk_briefings_project_period_index` ON `project_risk_briefings` (`projectId`,`period`,`createdAt`);