CREATE TABLE `transport_route_presets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`loadSiteId` int NOT NULL,
	`unloadSiteId` int NOT NULL,
	`freightRuleId` int NOT NULL,
	`presetDistanceKm` decimal(10,3) NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transport_route_presets_id` PRIMARY KEY(`id`),
	CONSTRAINT `transport_route_presets_project_sites_unique` UNIQUE(`projectId`,`loadSiteId`,`unloadSiteId`)
);
--> statement-breakpoint
CREATE INDEX `transport_route_presets_project_status_index` ON `transport_route_presets` (`projectId`,`status`);