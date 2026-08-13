CREATE TABLE `asset_maintenance_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`assetType` enum('vehicle','machine') NOT NULL,
	`assetId` int NOT NULL,
	`projectId` int NOT NULL,
	`costCategory` enum('maintenance','repair') NOT NULL,
	`amount` decimal(16,2) NOT NULL,
	`occurredAt` datetime NOT NULL,
	`serviceProvider` varchar(160),
	`meterReading` decimal(14,2),
	`nextDueAt` date,
	`remarks` varchar(500),
	`status` enum('draft','approved','settled','void') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `asset_maintenance_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `employee_insurance_policies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employeeProfileId` int NOT NULL,
	`insuranceType` enum('work_injury','accident','medical','employer_liability','other') NOT NULL,
	`providerName` varchar(128),
	`policyReference` varchar(128),
	`purchasedAt` date NOT NULL,
	`expiresAt` date NOT NULL,
	`status` enum('active','expired','cancelled') NOT NULL DEFAULT 'active',
	`remarks` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_insurance_policies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `employee_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`laborWorkerId` int,
	`projectId` int,
	`employeeType` enum('management','operator','construction_worker') NOT NULL,
	`teamName` varchar(128),
	`employmentStatus` enum('active','suspended','left') NOT NULL DEFAULT 'active',
	`joinedAt` date,
	`leftAt` date,
	`salaryBasis` enum('monthly','daily','hourly','piecework') NOT NULL DEFAULT 'monthly',
	`baseSalary` decimal(16,2),
	`remarks` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_profiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `asset_maintenance_records_asset_date_index` ON `asset_maintenance_records` (`assetType`,`assetId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `asset_maintenance_records_project_status_index` ON `asset_maintenance_records` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `employee_insurance_policies_profile_expiry_index` ON `employee_insurance_policies` (`employeeProfileId`,`expiresAt`,`status`);--> statement-breakpoint
CREATE INDEX `employee_profiles_user_index` ON `employee_profiles` (`userId`);--> statement-breakpoint
CREATE INDEX `employee_profiles_worker_index` ON `employee_profiles` (`laborWorkerId`);--> statement-breakpoint
CREATE INDEX `employee_profiles_project_type_index` ON `employee_profiles` (`projectId`,`employeeType`,`employmentStatus`);