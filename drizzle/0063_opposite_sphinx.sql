CREATE TABLE `subcontract_payment_settlements` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`settlementNo` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`packageId` bigint NOT NULL,
	`subcontractTeamId` bigint NOT NULL,
	`packageNoSnapshot` varchar(64) NOT NULL,
	`workItemSnapshot` varchar(200) NOT NULL,
	`quantitySnapshot` decimal(16,3) NOT NULL,
	`unitSnapshot` varchar(16) NOT NULL,
	`grossPayableAmount` decimal(16,2) NOT NULL,
	`manualDeductionAmount` decimal(16,2) NOT NULL DEFAULT '0',
	`netPayableAmount` decimal(16,2) NOT NULL,
	`invoiceStatus` enum('missing','attached','verified','rejected') NOT NULL DEFAULT 'missing',
	`invoiceNo` varchar(128),
	`invoiceEvidenceId` bigint,
	`payeeName` varchar(128) NOT NULL,
	`payeeAccount` varchar(160),
	`paymentMethod` enum('bank_transfer','corporate_account','cash','wechat','alipay','other') NOT NULL DEFAULT 'bank_transfer',
	`paymentDate` date,
	`paymentReference` varchar(128),
	`remarks` varchar(500),
	`status` enum('draft','submitted','approved','paid','void') NOT NULL DEFAULT 'draft',
	`submittedBy` int,
	`submittedAt` datetime,
	`approvedBy` int,
	`approvedAt` datetime,
	`paidBy` int,
	`paidAt` datetime,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subcontract_payment_settlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `subcontract_payment_settlements_no_unique` UNIQUE(`settlementNo`),
	CONSTRAINT `subcontract_payment_settlements_package_unique` UNIQUE(`packageId`)
);
--> statement-breakpoint
ALTER TABLE `subcontract_packages` ADD `priceExceptionReason` varchar(500);--> statement-breakpoint
ALTER TABLE `subcontract_packages` ADD `confirmedBy` int;--> statement-breakpoint
ALTER TABLE `subcontract_packages` ADD `confirmedAt` datetime;--> statement-breakpoint
ALTER TABLE `subcontract_packages` ADD `priceExceptionReviewedBy` int;--> statement-breakpoint
ALTER TABLE `subcontract_packages` ADD `priceExceptionReviewedAt` datetime;--> statement-breakpoint
ALTER TABLE `subcontract_payment_settlements` ADD CONSTRAINT `subcontract_payment_settlements_package_fk` FOREIGN KEY (`packageId`) REFERENCES `subcontract_packages`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `subcontract_payment_settlements` ADD CONSTRAINT `subcontract_payment_settlements_team_fk` FOREIGN KEY (`subcontractTeamId`) REFERENCES `subcontract_teams`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `subcontract_payment_settlements_project_status_index` ON `subcontract_payment_settlements` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `subcontract_payment_settlements_team_index` ON `subcontract_payment_settlements` (`subcontractTeamId`);