CREATE TABLE `attendance_check_ins` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`businessDate` date NOT NULL,
	`checkedInAt` datetime NOT NULL,
	`deviceFingerprintHash` varchar(128) NOT NULL,
	`deviceLabel` varchar(160),
	`longitude` decimal(10,7),
	`latitude` decimal(10,7),
	`locationAccuracyMeters` decimal(10,2),
	`status` enum('normal','location_missing') NOT NULL DEFAULT 'normal',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attendance_check_ins_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_check_ins_user_project_date_unique` UNIQUE(`userId`,`projectId`,`businessDate`)
);
--> statement-breakpoint
CREATE INDEX `attendance_check_ins_project_date_index` ON `attendance_check_ins` (`projectId`,`businessDate`);--> statement-breakpoint
CREATE INDEX `attendance_check_ins_device_index` ON `attendance_check_ins` (`deviceFingerprintHash`,`businessDate`);