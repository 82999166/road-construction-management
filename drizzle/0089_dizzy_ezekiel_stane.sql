CREATE TABLE `employee_payroll_advance_allocations` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`advanceId` bigint NOT NULL,
	`payrollStatementId` bigint NOT NULL,
	`amount` decimal(16,2) NOT NULL,
	`status` enum('active','reversed') NOT NULL DEFAULT 'active',
	`allocatedBy` int NOT NULL,
	`allocatedAt` datetime NOT NULL,
	`reversedBy` int,
	`reversedAt` datetime,
	`reversalReason` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `employee_payroll_advance_allocations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settlement_payment_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`settlementType` enum('transport_vehicle','machine','payroll','daily_wage') NOT NULL,
	`settlementId` bigint NOT NULL,
	`direction` enum('expense','income') NOT NULL,
	`amount` decimal(16,2) NOT NULL,
	`paymentDate` date NOT NULL,
	`paymentMethod` enum('bank_transfer','corporate_account','cash','wechat','alipay','other') NOT NULL,
	`payeeNameSnapshot` varchar(128) NOT NULL,
	`payeeAccountSnapshot` varchar(160),
	`paymentReference` varchar(128),
	`evidenceId` bigint,
	`remarks` varchar(500),
	`status` enum('active','reversed') NOT NULL DEFAULT 'active',
	`paidBy` int NOT NULL,
	`paidAt` datetime NOT NULL,
	`reversedBy` int,
	`reversedAt` datetime,
	`reversalReason` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `settlement_payment_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transport_vehicle_carry_forward_offsets` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`vehicleId` int NOT NULL,
	`sourceSettlementId` bigint NOT NULL,
	`targetSettlementId` bigint NOT NULL,
	`amount` decimal(16,2) NOT NULL,
	`status` enum('active','reversed') NOT NULL DEFAULT 'active',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`reversedBy` int,
	`reversedAt` datetime,
	`reversalReason` varchar(500),
	CONSTRAINT `transport_vehicle_carry_forward_offsets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transport_vehicle_payee_accounts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`payeeName` varchar(128) NOT NULL,
	`paymentMethod` enum('bank_transfer','corporate_account','cash','wechat','alipay','other') NOT NULL,
	`accountName` varchar(128),
	`accountNo` varchar(160),
	`isDefault` boolean NOT NULL DEFAULT false,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`remarks` varchar(500),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transport_vehicle_payee_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transport_vehicle_usage_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`usageDate` date NOT NULL,
	`usageType` enum('daily','hourly','shift') NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`description` varchar(500) NOT NULL,
	`evidenceId` bigint,
	`status` enum('confirmed','void') NOT NULL DEFAULT 'confirmed',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`voidedBy` int,
	`voidedAt` datetime,
	`voidReason` varchar(500),
	CONSTRAINT `transport_vehicle_usage_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `machine_payment_settlements` MODIFY COLUMN `status` enum('draft','submitted','approved','partial','paid','void') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `payroll_statements` MODIFY COLUMN `status` enum('draft','reviewing','approved','partial','paid','void') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `temporary_daily_wage_settlements` MODIFY COLUMN `status` enum('draft','reviewing','approved','partial','paid','void') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `transport_vehicle_settlements` MODIFY COLUMN `status` enum('draft','submitted','approved','partial','paid','receivable','offset','void') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `employee_insurance_policies` ADD `evidenceId` bigint;--> statement-breakpoint
ALTER TABLE `employee_insurance_policies` ADD `premiumAmount` decimal(16,2);--> statement-breakpoint
ALTER TABLE `employee_insurance_policies` ADD `coverageAmount` decimal(16,2);--> statement-breakpoint
ALTER TABLE `transport_vehicle_settlements` ADD `settlementKind` enum('trip','lease','adjustment') DEFAULT 'trip' NOT NULL;--> statement-breakpoint
ALTER TABLE `transport_vehicle_settlements` ADD `basisDescription` varchar(500);--> statement-breakpoint
ALTER TABLE `transport_vehicle_settlements` ADD `carryForwardDeductionAmount` decimal(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX `employee_payroll_advance_allocations_advance_index` ON `employee_payroll_advance_allocations` (`advanceId`,`status`);--> statement-breakpoint
CREATE INDEX `employee_payroll_advance_allocations_payroll_index` ON `employee_payroll_advance_allocations` (`payrollStatementId`,`status`);--> statement-breakpoint
CREATE INDEX `settlement_payment_records_settlement_index` ON `settlement_payment_records` (`settlementType`,`settlementId`,`status`);--> statement-breakpoint
CREATE INDEX `settlement_payment_records_project_date_index` ON `settlement_payment_records` (`projectId`,`paymentDate`,`status`);--> statement-breakpoint
CREATE INDEX `settlement_payment_records_evidence_index` ON `settlement_payment_records` (`evidenceId`);--> statement-breakpoint
CREATE INDEX `transport_vehicle_carry_offsets_source_index` ON `transport_vehicle_carry_forward_offsets` (`sourceSettlementId`,`status`);--> statement-breakpoint
CREATE INDEX `transport_vehicle_carry_offsets_target_index` ON `transport_vehicle_carry_forward_offsets` (`targetSettlementId`,`status`);--> statement-breakpoint
CREATE INDEX `transport_vehicle_carry_offsets_vehicle_index` ON `transport_vehicle_carry_forward_offsets` (`vehicleId`,`status`);--> statement-breakpoint
CREATE INDEX `transport_vehicle_payee_accounts_vehicle_status_index` ON `transport_vehicle_payee_accounts` (`vehicleId`,`status`);--> statement-breakpoint
CREATE INDEX `transport_vehicle_payee_accounts_vehicle_default_index` ON `transport_vehicle_payee_accounts` (`vehicleId`,`isDefault`);--> statement-breakpoint
CREATE INDEX `transport_vehicle_usage_records_vehicle_date_index` ON `transport_vehicle_usage_records` (`vehicleId`,`usageDate`,`status`);--> statement-breakpoint
CREATE INDEX `transport_vehicle_usage_records_project_date_index` ON `transport_vehicle_usage_records` (`projectId`,`usageDate`,`status`);--> statement-breakpoint
CREATE INDEX `employee_insurance_policies_evidence_index` ON `employee_insurance_policies` (`evidenceId`);