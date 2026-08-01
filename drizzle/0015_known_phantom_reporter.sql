CREATE TABLE `daily_project_digest_runs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`scheduleId` int NOT NULL,
	`projectId` int NOT NULL,
	`businessDate` date NOT NULL,
	`status` enum('pending','completed','partial','skipped','failed') NOT NULL DEFAULT 'pending',
	`summaryJson` text NOT NULL,
	`recipientCount` int NOT NULL DEFAULT 0,
	`deliveredCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`completedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_project_digest_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_project_digest_runs_schedule_project_date_unique` UNIQUE(`scheduleId`,`projectId`,`businessDate`)
);
--> statement-breakpoint
CREATE TABLE `daily_project_digest_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scopeKey` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
	`deliveryHour` int NOT NULL DEFAULT 20,
	`deliveryMinute` int NOT NULL DEFAULT 0,
	`includeEmptyProjects` boolean NOT NULL DEFAULT false,
	`scheduleCronTaskUid` varchar(65),
	`lastAttemptedAt` datetime,
	`lastSuccessfulBusinessDate` date,
	`lastResultJson` text,
	`createdBy` int,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_project_digest_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_project_digest_schedules_scope_unique` UNIQUE(`scopeKey`)
);
--> statement-breakpoint
CREATE TABLE `official_account_bindings` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`openIdEncrypted` text NOT NULL,
	`openIdFingerprint` varchar(64) NOT NULL,
	`bindingSource` enum('wechat_oauth','admin_verified') NOT NULL DEFAULT 'wechat_oauth',
	`status` enum('pending','active','unsubscribed','revoked','disabled') NOT NULL DEFAULT 'pending',
	`boundAt` datetime,
	`lastVerifiedAt` datetime,
	`lastFailureAt` datetime,
	`failureCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `official_account_bindings_id` PRIMARY KEY(`id`),
	CONSTRAINT `official_account_bindings_user_unique` UNIQUE(`userId`),
	CONSTRAINT `official_account_bindings_openid_fingerprint_unique` UNIQUE(`openIdFingerprint`)
);
--> statement-breakpoint
CREATE TABLE `transport_card_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`tripId` bigint NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`eventType` enum('load','unload') NOT NULL,
	`source` enum('card_reader','manual_review','offline_replay') NOT NULL DEFAULT 'card_reader',
	`idempotencyKey` varchar(160) NOT NULL,
	`deviceId` varchar(128),
	`cardFingerprint` varchar(64),
	`payloadFingerprint` varchar(64),
	`occurredAt` datetime NOT NULL,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`validationStatus` enum('accepted','duplicate','rejected','needs_review') NOT NULL DEFAULT 'accepted',
	`validationReason` varchar(500),
	`reviewedBy` int,
	`reviewedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transport_card_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `transport_card_events_idempotency_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
DROP INDEX `user_profiles_wecom_index` ON `user_profiles`;--> statement-breakpoint
ALTER TABLE `notification_records` MODIFY COLUMN `status` enum('pending','sent','failed','skipped','read') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `notification_records` ADD `channel` enum('legacy_wecom','official_account','in_app') DEFAULT 'legacy_wecom' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_records` ADD `providerMessageId` varchar(128);--> statement-breakpoint
ALTER TABLE `notification_records` ADD `failureCode` varchar(64);--> statement-breakpoint
ALTER TABLE `notification_records` ADD `lastAttemptedAt` datetime;--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `loadConfirmedAt` datetime;--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `unloadConfirmedAt` datetime;--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `loadEventId` bigint;--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `unloadEventId` bigint;--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `exceptionStatus` enum('none','open','resolved') DEFAULT 'none' NOT NULL;--> statement-breakpoint
CREATE INDEX `daily_project_digest_runs_schedule_date_index` ON `daily_project_digest_runs` (`scheduleId`,`businessDate`);--> statement-breakpoint
CREATE INDEX `daily_project_digest_schedules_task_uid_index` ON `daily_project_digest_schedules` (`scheduleCronTaskUid`);--> statement-breakpoint
CREATE INDEX `official_account_bindings_status_index` ON `official_account_bindings` (`status`);--> statement-breakpoint
CREATE INDEX `transport_card_events_trip_index` ON `transport_card_events` (`tripId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `transport_card_events_vehicle_index` ON `transport_card_events` (`vehicleId`,`occurredAt`);--> statement-breakpoint
ALTER TABLE `user_profiles` DROP COLUMN `wecomUserId`;