CREATE TABLE `official_account_driver_binding_requests` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`tokenFingerprint` varchar(64) NOT NULL,
	`openIdEncrypted` text NOT NULL,
	`openIdFingerprint` varchar(64) NOT NULL,
	`expiresAt` datetime NOT NULL,
	`consumedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `official_account_driver_binding_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `official_account_driver_binding_requests_token_unique` UNIQUE(`tokenFingerprint`)
);
--> statement-breakpoint
CREATE TABLE `official_account_driver_bindings` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`plateNoSnapshot` varchar(32) NOT NULL,
	`driverNameSnapshot` varchar(128),
	`driverPhoneMaskedSnapshot` varchar(32),
	`openIdEncrypted` text NOT NULL,
	`openIdFingerprint` varchar(64) NOT NULL,
	`status` enum('active','revoked','disabled','unsubscribed') NOT NULL DEFAULT 'active',
	`boundAt` datetime,
	`lastVerifiedAt` datetime,
	`lastFailureAt` datetime,
	`failureCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `official_account_driver_bindings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `official_account_driver_notification_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`eventCode` varchar(128) NOT NULL,
	`idempotencyKey` varchar(180) NOT NULL,
	`driverBindingId` bigint,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`content` text NOT NULL,
	`deepLink` varchar(512),
	`status` enum('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
	`retryCount` int NOT NULL DEFAULT 0,
	`sentAt` datetime,
	`providerMessageId` varchar(128),
	`failureCode` varchar(64),
	`lastAttemptedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `official_account_driver_notification_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `official_account_driver_notifications_idempotency_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
ALTER TABLE `official_account_driver_bindings` ADD CONSTRAINT `official_account_driver_bindings_vehicle_fk` FOREIGN KEY (`vehicleId`) REFERENCES `transport_vehicles`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `official_account_driver_binding_requests_openid_index` ON `official_account_driver_binding_requests` (`openIdFingerprint`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `official_account_driver_bindings_vehicle_index` ON `official_account_driver_bindings` (`vehicleId`,`status`);--> statement-breakpoint
CREATE INDEX `official_account_driver_bindings_openid_index` ON `official_account_driver_bindings` (`openIdFingerprint`,`status`);--> statement-breakpoint
CREATE INDEX `official_account_driver_bindings_project_status_index` ON `official_account_driver_bindings` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `official_account_driver_notifications_vehicle_status_index` ON `official_account_driver_notification_records` (`vehicleId`,`status`);--> statement-breakpoint
CREATE INDEX `official_account_driver_notifications_project_created_index` ON `official_account_driver_notification_records` (`projectId`,`createdAt`);