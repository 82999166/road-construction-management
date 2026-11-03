CREATE TABLE `personnel_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`personId` int NOT NULL,
	`affiliation` enum('company','temporary','labor_team','external') NOT NULL,
	`primaryPositionId` int,
	`secondaryPositionIds` json NOT NULL,
	`projectId` int,
	`teamId` int,
	`employmentStatus` enum('active','suspended','left') NOT NULL,
	`effectiveFrom` date NOT NULL,
	`version` int NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personnel_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `personnel_assignments_person_version_unique` UNIQUE(`personId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `personnel_changes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`personId` int NOT NULL,
	`action` varchar(64) NOT NULL,
	`version` int NOT NULL,
	`changes` json NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personnel_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `personnel_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`personId` int NOT NULL,
	`projectId` int,
	`documentType` enum('portrait','identity','driver_license','operator_certificate','contract','insurance','other') NOT NULL,
	`name` varchar(128) NOT NULL,
	`expiresAt` date,
	`evidenceId` bigint NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personnel_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `personnel_documents_evidence_unique` UNIQUE(`evidenceId`)
);
--> statement-breakpoint
CREATE TABLE `personnel_people` (
	`id` int AUTO_INCREMENT NOT NULL,
	`personNo` varchar(48) NOT NULL,
	`name` varchar(128) NOT NULL,
	`affiliation` enum('company','temporary','labor_team','external') NOT NULL,
	`employmentStatus` enum('active','suspended','left') NOT NULL DEFAULT 'active',
	`primaryPositionId` int,
	`secondaryPositionIds` json NOT NULL,
	`projectId` int,
	`teamId` int,
	`entryDate` date,
	`exitDate` date,
	`gender` enum('male','female','unspecified'),
	`birthDate` date,
	`address` varchar(500),
	`emergencyContactName` varchar(128),
	`emergencyContactPhoneEncrypted` text,
	`emergencyContactPhoneMasked` varchar(64),
	`remarks` varchar(1000),
	`avatarEvidenceId` bigint,
	`payrollEnabled` boolean NOT NULL DEFAULT false,
	`phoneEncrypted` text,
	`phoneFingerprint` varchar(64),
	`phoneMasked` varchar(64),
	`identityNoEncrypted` text,
	`identityNoFingerprint` varchar(64),
	`identityMasked` varchar(64),
	`bankAccountEncrypted` text,
	`bankAccountFingerprint` varchar(64),
	`bankMasked` varchar(64),
	`bankName` varchar(128),
	`userId` int,
	`legacyProfileId` int,
	`legacyWorkerId` int,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`updatedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `personnel_people_id` PRIMARY KEY(`id`),
	CONSTRAINT `personnel_people_no_unique` UNIQUE(`personNo`),
	CONSTRAINT `personnel_people_user_unique` UNIQUE(`userId`),
	CONSTRAINT `personnel_people_phone_unique` UNIQUE(`phoneFingerprint`),
	CONSTRAINT `personnel_people_identity_unique` UNIQUE(`identityNoFingerprint`)
);
--> statement-breakpoint
CREATE TABLE `personnel_positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`category` enum('management','technical','business','driver','operator','construction','other') NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `personnel_positions_id` PRIMARY KEY(`id`),
	CONSTRAINT `personnel_positions_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `personnel_resource_bindings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`personId` int NOT NULL,
	`assetType` enum('vehicle','machine') NOT NULL,
	`assetId` int NOT NULL,
	`projectId` int,
	`effectiveFrom` date NOT NULL,
	`effectiveTo` date,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personnel_resource_bindings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `personnel_salary_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`personId` int NOT NULL,
	`salaryBasis` enum('monthly','daily','hourly','piecework') NOT NULL,
	`baseSalary` decimal(16,2),
	`payrollEnabled` boolean NOT NULL,
	`affiliation` enum('company','temporary','labor_team','external') NOT NULL,
	`effectiveFrom` date NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personnel_salary_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `personnel_salary_person_effective_unique` UNIQUE(`personId`,`effectiveFrom`)
);
--> statement-breakpoint
CREATE TABLE `personnel_source_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`personId` int NOT NULL,
	`sourceType` enum('user','profile','worker') NOT NULL,
	`sourceId` int NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personnel_source_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `personnel_source_unique` UNIQUE(`sourceType`,`sourceId`)
);
--> statement-breakpoint
CREATE TABLE `personnel_teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`projectId` int NOT NULL,
	`leaderName` varchar(128),
	`remarks` varchar(1000),
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `personnel_teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `personnel_teams_project_name_unique` UNIQUE(`projectId`,`name`)
);
--> statement-breakpoint
ALTER TABLE `machines` ADD `operatorPersonId` int;--> statement-breakpoint
ALTER TABLE `transport_vehicles` ADD `driverPersonId` int;--> statement-breakpoint
CREATE INDEX `personnel_changes_person_index` ON `personnel_changes` (`personId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `personnel_documents_person_index` ON `personnel_documents` (`personId`);--> statement-breakpoint
CREATE INDEX `personnel_people_project_index` ON `personnel_people` (`projectId`,`employmentStatus`);--> statement-breakpoint
CREATE INDEX `personnel_resource_asset_date_index` ON `personnel_resource_bindings` (`assetType`,`assetId`,`effectiveFrom`);--> statement-breakpoint
CREATE INDEX `personnel_resource_person_index` ON `personnel_resource_bindings` (`personId`);--> statement-breakpoint
CREATE INDEX `personnel_source_person_index` ON `personnel_source_links` (`personId`);--> statement-breakpoint
CREATE INDEX `machines_operator_person_index` ON `machines` (`operatorPersonId`);--> statement-breakpoint
CREATE INDEX `transport_vehicles_driver_person_index` ON `transport_vehicles` (`driverPersonId`);
--> statement-breakpoint
-- 静态岗位字典，不写入任何人员或工资业务数据；读取接口不执行seed。
INSERT INTO `personnel_positions` (`name`, `category`, `status`) VALUES
('项目经理', 'management', 'active'),
('行政管理', 'management', 'active'),
('技术员', 'technical', 'active'),
('施工员', 'technical', 'active'),
('安全员', 'technical', 'active'),
('会计', 'business', 'active'),
('采购员', 'business', 'active'),
('材料员', 'business', 'active'),
('运输司机', 'driver', 'active'),
('机械操作员', 'operator', 'active'),
('施工工人', 'construction', 'active'),
('其他岗位', 'other', 'active');
