CREATE TABLE `employee_payroll_advances` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`employeeProfileId` int NOT NULL,
	`laborWorkerId` int,
	`projectId` int,
	`advanceDate` date NOT NULL,
	`amount` decimal(16,2) NOT NULL,
	`status` enum('draft','approved','deducted','void') NOT NULL DEFAULT 'draft',
	`remarks` varchar(500),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_payroll_advances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `employee_profiles` ADD `tradeName` varchar(128);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `bankAccountEncrypted` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `bankName` varchar(128);--> statement-breakpoint
CREATE INDEX `employee_payroll_advances_profile_date_index` ON `employee_payroll_advances` (`employeeProfileId`,`advanceDate`,`status`);--> statement-breakpoint
CREATE INDEX `employee_payroll_advances_worker_index` ON `employee_payroll_advances` (`laborWorkerId`);