CREATE TABLE `rfid_card_write_jobs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`jobNo` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`vehicleId` int NOT NULL,
	`cardId` bigint NOT NULL,
	`writerDeviceId` int,
	`action` enum('issue','rewrite','revoke') NOT NULL,
	`payloadFingerprint` varchar(64) NOT NULL,
	`payloadVersion` int NOT NULL,
	`status` enum('prepared','confirmed','failed','cancelled') NOT NULL DEFAULT 'prepared',
	`failureReason` varchar(500),
	`preparedBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rfid_card_write_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `rfid_card_write_jobs_no_unique` UNIQUE(`jobNo`)
);
--> statement-breakpoint
CREATE TABLE `rfid_writer_devices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`deviceCode` varchar(64) NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`model` varchar(128),
	`connectionMode` enum('manual_placeholder','usb','serial','network') NOT NULL DEFAULT 'manual_placeholder',
	`status` enum('active','disabled','maintenance') NOT NULL DEFAULT 'active',
	`remarks` varchar(500),
	`lastConfirmedAt` datetime,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rfid_writer_devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `rfid_writer_devices_project_code_unique` UNIQUE(`projectId`,`deviceCode`)
);
--> statement-breakpoint
CREATE TABLE `transport_vehicle_rfid_cards` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`vehicleId` int NOT NULL,
	`writerDeviceId` int,
	`cardUidFingerprint` varchar(64) NOT NULL,
	`cardUidMasked` varchar(32) NOT NULL,
	`driverPhoneEncrypted` text,
	`driverPhoneMasked` varchar(32),
	`payloadVersion` int NOT NULL DEFAULT 1,
	`status` enum('active','suspended','revoked') NOT NULL DEFAULT 'active',
	`issuedAt` datetime,
	`lastWrittenAt` datetime,
	`revokedAt` datetime,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transport_vehicle_rfid_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `transport_vehicle_rfid_cards_uid_unique` UNIQUE(`cardUidFingerprint`)
);
--> statement-breakpoint
CREATE INDEX `rfid_card_write_jobs_card_created_index` ON `rfid_card_write_jobs` (`cardId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `rfid_card_write_jobs_project_status_index` ON `rfid_card_write_jobs` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `rfid_writer_devices_project_status_index` ON `rfid_writer_devices` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `transport_vehicle_rfid_cards_vehicle_status_index` ON `transport_vehicle_rfid_cards` (`vehicleId`,`status`);--> statement-breakpoint
CREATE INDEX `transport_vehicle_rfid_cards_project_status_index` ON `transport_vehicle_rfid_cards` (`projectId`,`status`);