CREATE TABLE `attendance_device_bindings` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`deviceFingerprintHash` varchar(128) NOT NULL,
	`deviceLabel` varchar(160),
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`firstBoundAt` datetime NOT NULL,
	`lastUsedAt` datetime NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `attendance_device_bindings_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_device_bindings_user_device_unique` UNIQUE(`userId`,`deviceFingerprintHash`)
);
--> statement-breakpoint
CREATE INDEX `attendance_device_bindings_user_status_index` ON `attendance_device_bindings` (`userId`,`status`);