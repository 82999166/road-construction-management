CREATE TABLE `daily_accounting_closures` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`closingNo` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`closingDate` date NOT NULL,
	`totalIncome` decimal(16,2) NOT NULL DEFAULT '0',
	`totalExpense` decimal(16,2) NOT NULL DEFAULT '0',
	`recordCount` int NOT NULL DEFAULT 0,
	`invoiceCount` int NOT NULL DEFAULT 0,
	`invoiceAmount` decimal(16,2) NOT NULL DEFAULT '0',
	`snapshotHash` varchar(64) NOT NULL,
	`snapshotJson` text NOT NULL,
	`status` enum('closed','archived','void') NOT NULL DEFAULT 'closed',
	`closedBy` int NOT NULL,
	`closedAt` datetime NOT NULL,
	`archivedBy` int,
	`archivedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_accounting_closures_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_accounting_closures_no_unique` UNIQUE(`closingNo`),
	CONSTRAINT `daily_accounting_closures_project_date_unique` UNIQUE(`projectId`,`closingDate`)
);
--> statement-breakpoint
CREATE TABLE `financial_invoices` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`financialRecordId` bigint,
	`invoiceNo` varchar(64) NOT NULL,
	`invoiceCode` varchar(64),
	`counterpartyName` varchar(200) NOT NULL,
	`invoiceType` enum('vat_special','vat_normal','electronic','receipt','other') NOT NULL,
	`direction` enum('income','expense') NOT NULL,
	`amount` decimal(16,2) NOT NULL,
	`taxAmount` decimal(16,2) NOT NULL DEFAULT '0',
	`taxRate` decimal(7,4) NOT NULL DEFAULT '0',
	`issuedAt` date NOT NULL,
	`verifiedAt` datetime,
	`status` enum('issued','verified','void','red_flushed') NOT NULL DEFAULT 'issued',
	`evidenceId` bigint,
	`voidReason` varchar(500),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `financial_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `financial_invoices_project_no_unique` UNIQUE(`projectId`,`invoiceNo`)
);
--> statement-breakpoint
CREATE TABLE `measurement_takeoff_evidences` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`takeoffId` bigint NOT NULL,
	`evidenceId` bigint NOT NULL,
	`linkedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `measurement_takeoff_evidences_id` PRIMARY KEY(`id`),
	CONSTRAINT `measurement_takeoff_evidences_unique` UNIQUE(`takeoffId`,`evidenceId`)
);
--> statement-breakpoint
CREATE TABLE `measurement_takeoff_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`takeoffNo` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`measurementClaimId` bigint,
	`workItem` varchar(200) NOT NULL,
	`workLocation` varchar(200) NOT NULL,
	`unit` enum('m3','m2','m','t','piece','set','other') NOT NULL,
	`quantity` decimal(16,3) NOT NULL,
	`unitPrice` decimal(16,2) NOT NULL DEFAULT '0',
	`declaredAmount` decimal(16,2) NOT NULL,
	`takeoffDate` date NOT NULL,
	`status` enum('draft','submitted','reviewing','approved','rejected','locked','void') NOT NULL DEFAULT 'draft',
	`submittedBy` int NOT NULL,
	`reviewedBy` int,
	`reviewedAt` datetime,
	`reviewNote` varchar(500),
	`lockedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `measurement_takeoff_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `measurement_takeoff_records_no_unique` UNIQUE(`takeoffNo`)
);
--> statement-breakpoint
ALTER TABLE `financial_records` ADD `dailyClosingId` bigint;--> statement-breakpoint
ALTER TABLE `users` ADD `localLoginMode` enum('pc','mobile','both') DEFAULT 'both' NOT NULL;--> statement-breakpoint
CREATE INDEX `financial_invoices_project_status_date_index` ON `financial_invoices` (`projectId`,`status`,`issuedAt`);--> statement-breakpoint
CREATE INDEX `financial_invoices_financial_record_index` ON `financial_invoices` (`financialRecordId`);--> statement-breakpoint
CREATE INDEX `measurement_takeoff_evidences_takeoff_index` ON `measurement_takeoff_evidences` (`takeoffId`);--> statement-breakpoint
CREATE INDEX `measurement_takeoff_records_project_status_date_index` ON `measurement_takeoff_records` (`projectId`,`status`,`takeoffDate`);--> statement-breakpoint
CREATE INDEX `measurement_takeoff_records_claim_index` ON `measurement_takeoff_records` (`measurementClaimId`);