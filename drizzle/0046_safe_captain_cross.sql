CREATE TABLE `temporary_daily_wage_settlements` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`workerId` int NOT NULL,
	`projectId` int NOT NULL,
	`settlementDate` date NOT NULL,
	`payableAmount` decimal(16,2) NOT NULL,
	`deductionAmount` decimal(16,2) NOT NULL DEFAULT '0',
	`actualAmount` decimal(16,2) NOT NULL,
	`remarks` varchar(500),
	`status` enum('draft','reviewing','approved','paid','void') NOT NULL DEFAULT 'draft',
	`submittedBy` int,
	`submittedAt` datetime,
	`reviewedBy` int,
	`reviewedAt` datetime,
	`paidBy` int,
	`paidAt` datetime,
	`paymentReference` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `temporary_daily_wage_settlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `temporary_daily_wage_worker_date_unique` UNIQUE(`workerId`,`settlementDate`)
);
--> statement-breakpoint
CREATE INDEX `temporary_daily_wage_project_date_index` ON `temporary_daily_wage_settlements` (`projectId`,`settlementDate`,`status`);