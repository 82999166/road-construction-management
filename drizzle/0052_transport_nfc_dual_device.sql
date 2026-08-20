CREATE TABLE `transport_reader_devices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`siteId` int NOT NULL,
	`deviceCode` varchar(128) NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`status` enum('active','disabled','maintenance') NOT NULL DEFAULT 'active',
	`remarks` varchar(500),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transport_reader_devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `transport_reader_devices_project_code_unique` UNIQUE(`projectId`,`deviceCode`)
);
--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `nfcTransitKey` varchar(128);--> statement-breakpoint
CREATE INDEX `transport_reader_devices_site_status_index` ON `transport_reader_devices` (`siteId`,`status`);--> statement-breakpoint
CREATE INDEX `transport_trips_nfc_transit_key_index` ON `transport_trips` (`projectId`,`nfcTransitKey`);