CREATE TABLE `official_account_broadcast_deliveries` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`broadcastId` bigint NOT NULL,
	`recipientUserId` int NOT NULL,
	`notificationRecordId` bigint,
	`deliveryStatus` enum('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
	`deliveryReason` varchar(64),
	`providerMessageId` varchar(128),
	`attemptedAt` datetime,
	`deliveredAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `official_account_broadcast_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `official_account_broadcast_deliveries_recipient_unique` UNIQUE(`broadcastId`,`recipientUserId`)
);
--> statement-breakpoint
CREATE TABLE `official_account_broadcasts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`broadcastNo` varchar(64) NOT NULL,
	`title` varchar(200) NOT NULL,
	`content` text NOT NULL,
	`deepLink` varchar(512),
	`audienceType` enum('project','organization','role') NOT NULL,
	`projectId` int,
	`organizationId` int,
	`roleCode` varchar(64),
	`status` enum('draft','submitted','approved','rejected','publishing','published','partial','failed','cancelled') NOT NULL DEFAULT 'draft',
	`reviewNote` varchar(500),
	`createdBy` int NOT NULL,
	`reviewedBy` int,
	`reviewedAt` datetime,
	`publishedBy` int,
	`publishedAt` datetime,
	`recipientCount` int NOT NULL DEFAULT 0,
	`deliveredCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`skippedCount` int NOT NULL DEFAULT 0,
	`audienceSnapshotJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `official_account_broadcasts_id` PRIMARY KEY(`id`),
	CONSTRAINT `official_account_broadcasts_no_unique` UNIQUE(`broadcastNo`)
);
--> statement-breakpoint
CREATE INDEX `official_account_broadcast_deliveries_status_index` ON `official_account_broadcast_deliveries` (`broadcastId`,`deliveryStatus`);--> statement-breakpoint
CREATE INDEX `official_account_broadcasts_status_index` ON `official_account_broadcasts` (`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `official_account_broadcasts_scope_index` ON `official_account_broadcasts` (`audienceType`,`projectId`,`organizationId`,`roleCode`);