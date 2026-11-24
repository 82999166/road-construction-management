CREATE TABLE `business_document_creation_receipts` (
	`requestHash` varchar(64) NOT NULL,
	`inputHash` varchar(64) NOT NULL,
	`scope` varchar(128) NOT NULL,
	`actorId` int NOT NULL,
	`resultJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `business_document_creation_receipts_requestHash` PRIMARY KEY(`requestHash`)
) ENGINE=InnoDB;
--> statement-breakpoint
ALTER TABLE `asset_maintenance_records` ADD `documentNo` varchar(36);--> statement-breakpoint
ALTER TABLE `construction_daily_reports` ADD `documentNo` varchar(36);--> statement-breakpoint
ALTER TABLE `diesel_refuel_records` ADD `machineCostSourceId` bigint;--> statement-breakpoint
ALTER TABLE `employee_payroll_advances` ADD `documentNo` varchar(36);--> statement-breakpoint
ALTER TABLE `machine_cost_records` ADD `documentNo` varchar(36);--> statement-breakpoint
ALTER TABLE `machine_daily_operations` ADD `documentNo` varchar(36);--> statement-breakpoint
ALTER TABLE `machine_monthly_statements` ADD `documentNo` varchar(36);--> statement-breakpoint
ALTER TABLE `payroll_statements` ADD `documentNo` varchar(36);--> statement-breakpoint
ALTER TABLE `settlement_payment_records` ADD `documentNo` varchar(36);--> statement-breakpoint
ALTER TABLE `temporary_daily_wage_settlements` ADD `documentNo` varchar(36);--> statement-breakpoint
ALTER TABLE `asset_maintenance_records` ADD CONSTRAINT `asset_maintenance_records_documentNo_unique` UNIQUE(`documentNo`);--> statement-breakpoint
ALTER TABLE `construction_daily_reports` ADD CONSTRAINT `construction_daily_reports_documentNo_unique` UNIQUE(`documentNo`);--> statement-breakpoint
ALTER TABLE `diesel_refuel_records` ADD CONSTRAINT `diesel_refuel_records_machineCostSourceId_unique` UNIQUE(`machineCostSourceId`);--> statement-breakpoint
ALTER TABLE `employee_payroll_advances` ADD CONSTRAINT `employee_payroll_advances_documentNo_unique` UNIQUE(`documentNo`);--> statement-breakpoint
ALTER TABLE `machine_cost_records` ADD CONSTRAINT `machine_cost_records_documentNo_unique` UNIQUE(`documentNo`);--> statement-breakpoint
ALTER TABLE `machine_daily_operations` ADD CONSTRAINT `machine_daily_operations_documentNo_unique` UNIQUE(`documentNo`);--> statement-breakpoint
ALTER TABLE `machine_monthly_statements` ADD CONSTRAINT `machine_monthly_statements_documentNo_unique` UNIQUE(`documentNo`);--> statement-breakpoint
ALTER TABLE `payroll_statements` ADD CONSTRAINT `payroll_statements_documentNo_unique` UNIQUE(`documentNo`);--> statement-breakpoint
ALTER TABLE `settlement_payment_records` ADD CONSTRAINT `settlement_payment_records_documentNo_unique` UNIQUE(`documentNo`);--> statement-breakpoint
ALTER TABLE `temporary_daily_wage_settlements` ADD CONSTRAINT `temporary_daily_wage_settlements_documentNo_unique` UNIQUE(`documentNo`);
