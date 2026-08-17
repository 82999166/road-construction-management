CREATE TABLE `transport_sites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`siteType` enum('load','unload') NOT NULL,
	`name` varchar(128) NOT NULL,
	`address` varchar(500),
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`administratorUserId` int,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transport_sites_id` PRIMARY KEY(`id`),
	CONSTRAINT `transport_sites_project_type_name_unique` UNIQUE(`projectId`,`siteType`,`name`)
);
--> statement-breakpoint
ALTER TABLE `transport_card_events` ADD `siteId` int;--> statement-breakpoint
ALTER TABLE `transport_card_events` ADD `operatorUserId` int;--> statement-breakpoint
ALTER TABLE `transport_card_events` ADD `latitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `transport_card_events` ADD `longitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `loadSiteId` int;--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `unloadSiteId` int;--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `loadConfirmedBy` int;--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `unloadConfirmedBy` int;--> statement-breakpoint
CREATE INDEX `transport_sites_project_type_status_index` ON `transport_sites` (`projectId`,`siteType`,`status`);--> statement-breakpoint
CREATE INDEX `transport_sites_administrator_index` ON `transport_sites` (`administratorUserId`,`status`);--> statement-breakpoint
CREATE INDEX `transport_card_events_site_event_index` ON `transport_card_events` (`siteId`,`eventType`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `transport_trips_project_load_site_index` ON `transport_trips` (`projectId`,`loadSiteId`,`startAt`);--> statement-breakpoint
CREATE INDEX `transport_trips_project_unload_site_index` ON `transport_trips` (`projectId`,`unloadSiteId`,`startAt`);