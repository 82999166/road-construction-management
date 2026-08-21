CREATE TABLE `contract_tax_registrations` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`contractId` bigint NOT NULL,
	`projectId` int NOT NULL,
	`taxEntityId` bigint NOT NULL,
	`contractNoSnapshot` varchar(64) NOT NULL,
	`contractTypeSnapshot` varchar(64) NOT NULL,
	`counterpartyNameSnapshot` varchar(200) NOT NULL,
	`contractDate` date,
	`contractAmountSnapshot` decimal(16,2) NOT NULL DEFAULT '0',
	`contractEvidenceId` bigint,
	`taxItem` varchar(100),
	`taxBaseAmount` decimal(16,2),
	`referenceTaxRate` decimal(7,4),
	`professionallyConfirmedTaxAmount` decimal(16,2),
	`paymentReference` varchar(200),
	`paymentEvidenceId` bigint,
	`status` enum('pending_review','confirmed','handed_off','receipt_recorded','not_applicable','void') NOT NULL DEFAULT 'pending_review',
	`reviewNote` varchar(1000),
	`reviewedBy` int,
	`reviewedAt` datetime,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contract_tax_registrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `contract_tax_registrations_contract_unique` UNIQUE(`contractId`)
);
--> statement-breakpoint
CREATE TABLE `cross_region_construction_tax_ledgers` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`taxEntityId` bigint NOT NULL,
	`period` varchar(7) NOT NULL,
	`projectLocationSnapshot` varchar(300) NOT NULL,
	`taxMethodSnapshot` enum('general','small_scale','simplified','other') NOT NULL,
	`projectRegistrationReference` varchar(200),
	`revenueIncludingTaxAmount` decimal(16,2),
	`subcontractDeductionAmount` decimal(16,2),
	`subcontractDeductionReference` varchar(200),
	`deductionEvidenceId` bigint,
	`prepaidVatAmount` decimal(16,2),
	`taxPaymentReference` varchar(200),
	`taxPaymentEvidenceId` bigint,
	`status` enum('pending_review','ready_for_handoff','receipt_recorded','not_applicable','void') NOT NULL DEFAULT 'pending_review',
	`reviewNote` varchar(1000),
	`reviewedBy` int,
	`reviewedAt` datetime,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cross_region_construction_tax_ledgers_id` PRIMARY KEY(`id`),
	CONSTRAINT `cross_region_construction_tax_project_period_unique` UNIQUE(`projectId`,`period`)
);
--> statement-breakpoint
CREATE TABLE `payroll_tax_withholding_entries` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`workerId` int NOT NULL,
	`projectId` int NOT NULL,
	`taxEntityId` bigint NOT NULL,
	`period` varchar(7) NOT NULL,
	`incomeType` enum('resident_wage_salary','labor_remuneration','nonresident_wage_salary','manual_review') NOT NULL,
	`sourceGrossIncome` decimal(16,2) NOT NULL DEFAULT '0',
	`sourceDocumentCount` int NOT NULL DEFAULT 0,
	`cumulativeGrossIncome` decimal(16,2) NOT NULL DEFAULT '0',
	`cumulativeExemptIncome` decimal(16,2) NOT NULL DEFAULT '0',
	`employmentMonths` int NOT NULL DEFAULT 0,
	`cumulativeBasicDeduction` decimal(16,2) NOT NULL DEFAULT '0',
	`cumulativeSocialInsuranceDeduction` decimal(16,2) NOT NULL DEFAULT '0',
	`cumulativeSpecialAdditionalDeduction` decimal(16,2) NOT NULL DEFAULT '0',
	`cumulativeOtherDeduction` decimal(16,2) NOT NULL DEFAULT '0',
	`cumulativeTaxableIncome` decimal(16,2) NOT NULL DEFAULT '0',
	`applicableRate` decimal(7,4),
	`quickDeduction` decimal(16,2),
	`calculatedCumulativeTax` decimal(16,2),
	`cumulativeTaxWithheldBefore` decimal(16,2) NOT NULL DEFAULT '0',
	`calculatedCurrentWithholding` decimal(16,2),
	`externallyWithheldThisPeriod` decimal(16,2),
	`externalReference` varchar(200),
	`evidenceId` bigint,
	`calculationSnapshotJson` text NOT NULL,
	`status` enum('draft','reviewed','handed_off','receipt_recorded','void') NOT NULL DEFAULT 'draft',
	`reviewNote` varchar(1000),
	`reviewedBy` int,
	`reviewedAt` datetime,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payroll_tax_withholding_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_tax_withholding_worker_entity_period_unique` UNIQUE(`workerId`,`taxEntityId`,`period`,`incomeType`)
);
--> statement-breakpoint
ALTER TABLE `contract_tax_registrations` ADD CONSTRAINT `contract_tax_registrations_contract_fk` FOREIGN KEY (`contractId`) REFERENCES `outsource_contracts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contract_tax_registrations` ADD CONSTRAINT `contract_tax_registrations_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contract_tax_registrations` ADD CONSTRAINT `contract_tax_registrations_contract_evidence_fk` FOREIGN KEY (`contractEvidenceId`) REFERENCES `evidence_records`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contract_tax_registrations` ADD CONSTRAINT `contract_tax_registrations_payment_evidence_fk` FOREIGN KEY (`paymentEvidenceId`) REFERENCES `evidence_records`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contract_tax_registrations` ADD CONSTRAINT `contract_tax_registrations_reviewer_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contract_tax_registrations` ADD CONSTRAINT `contract_tax_registrations_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cross_region_construction_tax_ledgers` ADD CONSTRAINT `cross_region_construction_tax_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cross_region_construction_tax_ledgers` ADD CONSTRAINT `cross_region_construction_tax_deduction_evidence_fk` FOREIGN KEY (`deductionEvidenceId`) REFERENCES `evidence_records`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cross_region_construction_tax_ledgers` ADD CONSTRAINT `cross_region_construction_tax_payment_evidence_fk` FOREIGN KEY (`taxPaymentEvidenceId`) REFERENCES `evidence_records`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cross_region_construction_tax_ledgers` ADD CONSTRAINT `cross_region_construction_tax_reviewer_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cross_region_construction_tax_ledgers` ADD CONSTRAINT `cross_region_construction_tax_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_tax_withholding_entries` ADD CONSTRAINT `payroll_tax_withholding_worker_fk` FOREIGN KEY (`workerId`) REFERENCES `labor_workers`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_tax_withholding_entries` ADD CONSTRAINT `payroll_tax_withholding_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_tax_withholding_entries` ADD CONSTRAINT `payroll_tax_withholding_evidence_fk` FOREIGN KEY (`evidenceId`) REFERENCES `evidence_records`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_tax_withholding_entries` ADD CONSTRAINT `payroll_tax_withholding_reviewer_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_tax_withholding_entries` ADD CONSTRAINT `payroll_tax_withholding_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `contract_tax_registrations_project_status_index` ON `contract_tax_registrations` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `cross_region_construction_tax_entity_period_index` ON `cross_region_construction_tax_ledgers` (`taxEntityId`,`period`,`status`);--> statement-breakpoint
CREATE INDEX `payroll_tax_withholding_project_period_index` ON `payroll_tax_withholding_entries` (`projectId`,`period`,`status`);--> statement-breakpoint
