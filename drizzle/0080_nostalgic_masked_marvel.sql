ALTER TABLE `machine_daily_operations` ADD `shiftCount` decimal(8,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `machine_daily_operations` ADD `shiftRate` decimal(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `machine_daily_operations` ADD `overtimeHourlyRate` decimal(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `machine_daily_operations` ADD `shiftAmount` decimal(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `machine_daily_operations` ADD `overtimeAmount` decimal(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `machine_daily_operations` ADD `driverNameSnapshot` varchar(128);