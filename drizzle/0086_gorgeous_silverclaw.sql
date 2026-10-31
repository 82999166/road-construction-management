CREATE TABLE `payroll_generation_runs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`scheduleId` int NOT NULL,
	`projectId` int NOT NULL,
	`period` varchar(7) NOT NULL,
	`status` enum('completed','partial','skipped','failed') NOT NULL,
	`createdCount` int NOT NULL DEFAULT 0,
	`skippedCount` int NOT NULL DEFAULT 0,
	`blockedCount` int NOT NULL DEFAULT 0,
	`summaryJson` text NOT NULL,
	`completedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payroll_generation_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_generation_runs_schedule_project_period_unique` UNIQUE(`scheduleId`,`projectId`,`period`)
);
--> statement-breakpoint
CREATE TABLE `payroll_generation_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scopeKey` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
	`generationDay` int NOT NULL DEFAULT 1,
	`generationHour` int NOT NULL DEFAULT 9,
	`generationMinute` int NOT NULL DEFAULT 5,
	`scheduleCronTaskUid` varchar(65),
	`lastAttemptedAt` datetime,
	`lastSuccessfulPeriod` varchar(7),
	`lastResultJson` text,
	`createdBy` int,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payroll_generation_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_generation_schedules_scope_unique` UNIQUE(`scopeKey`)
);
--> statement-breakpoint
CREATE INDEX `payroll_generation_runs_schedule_period_index` ON `payroll_generation_runs` (`scheduleId`,`period`);--> statement-breakpoint
CREATE INDEX `payroll_generation_schedules_task_uid_index` ON `payroll_generation_schedules` (`scheduleCronTaskUid`);