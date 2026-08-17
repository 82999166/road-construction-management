CREATE TABLE `diesel_price_alert_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`thresholdPercent` decimal(8,2) NOT NULL DEFAULT '10.00',
	`enabled` boolean NOT NULL DEFAULT true,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `diesel_price_alert_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `diesel_price_alert_rules_project_unique` UNIQUE(`projectId`)
);
