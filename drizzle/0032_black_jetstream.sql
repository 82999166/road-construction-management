ALTER TABLE `machine_monthly_statements` ADD `leaseBillingType` varchar(16) NOT NULL;--> statement-breakpoint
ALTER TABLE `machine_monthly_statements` ADD `leaseRate` decimal(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `machine_monthly_statements` ADD `machineOvertimeRate` decimal(16,2) DEFAULT '0' NOT NULL;