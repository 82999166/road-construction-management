CREATE TABLE `attendance_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`workerId` int NOT NULL,
	`projectId` int NOT NULL,
	`attendanceDate` date NOT NULL,
	`workHours` decimal(7,2) NOT NULL DEFAULT '0',
	`overtimeHours` decimal(7,2) NOT NULL DEFAULT '0',
	`source` enum('manual','mobile','device','import') NOT NULL DEFAULT 'manual',
	`evidenceId` bigint,
	`status` enum('draft','confirmed','locked') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `attendance_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_worker_date_unique` UNIQUE(`workerId`,`attendanceDate`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int,
	`module` varchar(64) NOT NULL,
	`action` varchar(64) NOT NULL,
	`targetType` varchar(64),
	`targetId` varchar(128),
	`summary` varchar(500) NOT NULL,
	`beforeJson` text,
	`afterJson` text,
	`ipAddress` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `config_publish_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settingId` int NOT NULL,
	`operation` enum('create','update','publish','disable','rollback') NOT NULL,
	`version` int NOT NULL,
	`operatorId` int NOT NULL,
	`reviewerId` int,
	`snapshotJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `config_publish_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `evidence_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int,
	`sourceType` varchar(64) NOT NULL,
	`sourceId` varchar(128),
	`fileKey` varchar(512) NOT NULL,
	`fileName` varchar(255),
	`mimeType` varchar(128),
	`ocrResultJson` text,
	`watermarkJson` text,
	`longitude` decimal(11,7),
	`latitude` decimal(10,7),
	`capturedAt` datetime,
	`uploadedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evidence_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `financial_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`recordNo` varchar(64) NOT NULL,
	`projectId` int,
	`direction` enum('income','expense') NOT NULL,
	`category` varchar(64) NOT NULL,
	`amount` decimal(16,2) NOT NULL,
	`occurredAt` datetime NOT NULL,
	`settlementStatus` enum('unpaid','partial','paid','void') NOT NULL DEFAULT 'unpaid',
	`sourceType` varchar(64),
	`sourceId` varchar(128),
	`evidenceId` bigint,
	`remarks` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `financial_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `financial_records_no_unique` UNIQUE(`recordNo`)
);
--> statement-breakpoint
CREATE TABLE `freight_rate_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`materialName` varchar(128),
	`settlementUnit` enum('cubic_meter','ton','trip') NOT NULL,
	`startDistanceKm` decimal(8,3) NOT NULL DEFAULT '1',
	`basePricePerUnit` decimal(16,2) NOT NULL,
	`stepMeters` int NOT NULL DEFAULT 500,
	`stepIncreasePerUnit` decimal(16,2) NOT NULL DEFAULT '0',
	`effectiveFrom` date NOT NULL,
	`effectiveTo` date,
	`status` enum('draft','active','disabled') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `freight_rate_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `labor_workers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`teamName` varchar(128),
	`realName` varchar(64) NOT NULL,
	`identityNoEncrypted` text,
	`phoneEncrypted` text,
	`bankAccountEncrypted` text,
	`bankName` varchar(128),
	`attendanceStatus` enum('pending','active','left') NOT NULL DEFAULT 'pending',
	`entryDate` date,
	`exitDate` date,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `labor_workers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `machine_cost_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`projectId` int NOT NULL,
	`costType` enum('fuel','repair','overtime','mobilization','other') NOT NULL,
	`quantity` decimal(12,3) NOT NULL DEFAULT '0',
	`unitPrice` decimal(16,2) NOT NULL DEFAULT '0',
	`amount` decimal(16,2) NOT NULL,
	`occurredAt` datetime NOT NULL,
	`evidenceId` bigint,
	`status` enum('draft','approved','settled','void') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `machine_cost_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `machine_lease_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`projectId` int NOT NULL,
	`billingType` enum('monthly','daily','hourly','shift') NOT NULL,
	`rate` decimal(16,2) NOT NULL,
	`overtimeHourlyRate` decimal(16,2) NOT NULL DEFAULT '0',
	`effectiveFrom` date NOT NULL,
	`effectiveTo` date,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `machine_lease_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `machines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int,
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`model` varchar(128),
	`ownership` enum('owned','leased') NOT NULL,
	`supplierName` varchar(200),
	`plateOrAssetNo` varchar(64),
	`status` enum('idle','working','repairing','offsite','retired') NOT NULL DEFAULT 'idle',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `machines_id` PRIMARY KEY(`id`),
	CONSTRAINT `machines_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `measurement_claims` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`claimNo` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`period` varchar(7) NOT NULL,
	`declaredAmount` decimal(16,2) NOT NULL,
	`approvedAmount` decimal(16,2),
	`status` enum('draft','submitted','reviewing','approved','settled','rejected') NOT NULL DEFAULT 'draft',
	`submittedBy` int NOT NULL,
	`accountantId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `measurement_claims_id` PRIMARY KEY(`id`),
	CONSTRAINT `measurement_claims_no_unique` UNIQUE(`claimNo`)
);
--> statement-breakpoint
CREATE TABLE `notification_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`eventCode` varchar(128) NOT NULL,
	`idempotencyKey` varchar(160) NOT NULL,
	`recipientUserId` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`content` text NOT NULL,
	`deepLink` varchar(512),
	`status` enum('pending','sent','failed','read') NOT NULL DEFAULT 'pending',
	`retryCount` int NOT NULL DEFAULT 0,
	`sentAt` datetime,
	`readAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_idempotency_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parentId` int,
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`type` enum('group','company','project_department','department','team') NOT NULL,
	`managerUserId` int,
	`costCenterCode` varchar(64),
	`sortOrder` int NOT NULL DEFAULT 0,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizations_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `payroll_statements` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`workerId` int NOT NULL,
	`projectId` int NOT NULL,
	`period` varchar(7) NOT NULL,
	`payableAmount` decimal(16,2) NOT NULL,
	`deductionAmount` decimal(16,2) NOT NULL DEFAULT '0',
	`actualAmount` decimal(16,2) NOT NULL,
	`bankAccountMasked` varchar(64),
	`status` enum('draft','reviewing','approved','paid','void') NOT NULL DEFAULT 'draft',
	`accountantId` int,
	`paidAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payroll_statements_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_worker_period_unique` UNIQUE(`workerId`,`period`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`category` varchar(64) NOT NULL,
	`description` text,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`),
	CONSTRAINT `positions_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parentId` int,
	`organizationId` int,
	`code` varchar(64) NOT NULL,
	`name` varchar(200) NOT NULL,
	`nodeType` varchar(64) NOT NULL,
	`projectType` enum('highway','railway','municipal','other'),
	`status` enum('planning','active','suspended','completed','archived') NOT NULL DEFAULT 'planning',
	`startDate` date,
	`endDate` date,
	`costCenterCode` varchar(64),
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `purchase_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isFixed` boolean NOT NULL DEFAULT true,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchase_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchase_categories_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `purchase_requests` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`requestNo` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`categoryId` int NOT NULL,
	`requesterId` int NOT NULL,
	`amount` decimal(16,2) NOT NULL DEFAULT '0',
	`description` text NOT NULL,
	`status` enum('draft','submitted','approved','ordered','received','stocked','closed','rejected') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `purchase_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchase_requests_no_unique` UNIQUE(`requestNo`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roleId` int NOT NULL,
	`permissionId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `role_permissions_unique` UNIQUE(`roleId`,`permissionId`)
);
--> statement-breakpoint
CREATE TABLE `system_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(128) NOT NULL,
	`name` varchar(128) NOT NULL,
	`module` varchar(64) NOT NULL,
	`action` varchar(64) NOT NULL,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `system_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_permissions_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `system_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`category` enum('system','business') NOT NULL DEFAULT 'business',
	`description` text,
	`isSystem` boolean NOT NULL DEFAULT false,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_roles_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` varchar(64) NOT NULL,
	`settingKey` varchar(128) NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`valueJson` text,
	`secretEncrypted` text,
	`valuePreview` varchar(256),
	`isSensitive` boolean NOT NULL DEFAULT false,
	`status` enum('draft','published','disabled') NOT NULL DEFAULT 'draft',
	`version` int NOT NULL DEFAULT 1,
	`updatedBy` int,
	`publishedAt` datetime,
	`remarks` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_settings_key_unique` UNIQUE(`settingKey`)
);
--> statement-breakpoint
CREATE TABLE `transport_trips` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`tripNo` varchar(64) NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`freightRuleId` int NOT NULL,
	`startAt` datetime NOT NULL,
	`endAt` datetime,
	`actualDistanceKm` decimal(10,3),
	`volumeCubicMeters` decimal(12,3),
	`weightTons` decimal(12,3),
	`calculatedUnitPrice` decimal(16,2),
	`calculatedAmount` decimal(16,2),
	`routeSnapshot` json,
	`evidenceId` bigint,
	`status` enum('draft','submitted','verified','settled','void') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transport_trips_id` PRIMARY KEY(`id`),
	CONSTRAINT `transport_trips_no_unique` UNIQUE(`tripNo`)
);
--> statement-breakpoint
CREATE TABLE `transport_vehicles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`plateNo` varchar(32) NOT NULL,
	`ownerName` varchar(128),
	`driverUserId` int,
	`boxLengthMeters` decimal(8,3) NOT NULL,
	`boxWidthMeters` decimal(8,3) NOT NULL,
	`boxHeightMeters` decimal(8,3) NOT NULL,
	`loadFactor` decimal(5,3) NOT NULL DEFAULT '1',
	`payloadTons` decimal(10,3),
	`status` enum('active','suspended','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transport_vehicles_id` PRIMARY KEY(`id`),
	CONSTRAINT `transport_vehicles_plate_unique` UNIQUE(`plateNo`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`employeeNo` varchar(64),
	`phoneMasked` varchar(32),
	`wecomUserId` varchar(128),
	`organizationId` int,
	`positionId` int,
	`status` enum('pending','active','disabled') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_profiles_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `user_role_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`roleId` int NOT NULL,
	`organizationId` int,
	`projectId` int,
	`validFrom` datetime,
	`validTo` datetime,
	`status` enum('active','revoked','expired') NOT NULL DEFAULT 'active',
	`grantedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_role_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_logs_module_index` ON `audit_logs` (`module`,`createdAt`);--> statement-breakpoint
CREATE INDEX `evidence_records_source_index` ON `evidence_records` (`sourceType`,`sourceId`);--> statement-breakpoint
CREATE INDEX `freight_rate_rules_project_index` ON `freight_rate_rules` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `labor_workers_project_index` ON `labor_workers` (`projectId`);--> statement-breakpoint
CREATE INDEX `machine_cost_records_machine_date_index` ON `machine_cost_records` (`machineId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `machine_lease_rules_machine_index` ON `machine_lease_rules` (`machineId`,`status`);--> statement-breakpoint
CREATE INDEX `organizations_parent_index` ON `organizations` (`parentId`);--> statement-breakpoint
CREATE INDEX `projects_parent_index` ON `projects` (`parentId`);--> statement-breakpoint
CREATE INDEX `transport_trips_vehicle_date_index` ON `transport_trips` (`vehicleId`,`startAt`);--> statement-breakpoint
CREATE INDEX `user_profiles_wecom_index` ON `user_profiles` (`wecomUserId`);--> statement-breakpoint
CREATE INDEX `user_role_assignments_user_index` ON `user_role_assignments` (`userId`);--> statement-breakpoint
CREATE INDEX `user_role_assignments_role_index` ON `user_role_assignments` (`roleId`);