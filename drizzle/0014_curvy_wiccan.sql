CREATE TABLE `construction_daily_reports` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`reportDate` date NOT NULL,
	`workArea` varchar(200) NOT NULL,
	`weather` enum('sunny','cloudy','rainy','snowy','windy','other') NOT NULL DEFAULT 'other',
	`workContent` text NOT NULL,
	`safetyNotes` varchar(1000),
	`issueNotes` varchar(1000),
	`progressPercent` decimal(5,2) NOT NULL DEFAULT '0',
	`status` enum('draft','submitted','approved','rejected','locked') NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`reviewedBy` int,
	`reviewedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `construction_daily_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `construction_daily_reports_project_date_index` ON `construction_daily_reports` (`projectId`,`reportDate`);--> statement-breakpoint
CREATE INDEX `construction_daily_reports_project_status_index` ON `construction_daily_reports` (`projectId`,`status`);