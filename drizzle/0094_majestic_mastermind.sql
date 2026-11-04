CREATE TABLE `vehicle_access_grants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`userId` int,
	`driverBindingId` bigint,
	`role` enum('owner','driver') NOT NULL,
	`scope` enum('service_period','all_history') NOT NULL,
	`effectiveFrom` datetime NOT NULL,
	`effectiveTo` datetime,
	`revokedAt` datetime,
	`revokedBy` int,
	`validFrom` datetime NOT NULL,
	`validTo` datetime,
	`reason` varchar(1000) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vehicle_access_grants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`fromProjectId` int,
	`action` enum('enter','transfer','exit','handover','baseline') NOT NULL,
	`driverPersonId` int,
	`driverUserId` int,
	`driverBindingId` bigint,
	`effectiveFrom` datetime NOT NULL,
	`effectiveTo` datetime,
	`meterReading` decimal(14,2),
	`condition` varchar(1000) NOT NULL,
	`reason` varchar(1000) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vehicle_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_changes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`version` int NOT NULL,
	`action` varchar(64) NOT NULL,
	`changes` json NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vehicle_changes_id` PRIMARY KEY(`id`),
	CONSTRAINT `vehicle_change_version_unique` UNIQUE(`vehicleId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`kind` enum('vehicle_registration','transport_permit','insurance','inspection','annual_review','other') NOT NULL,
	`title` varchar(160) NOT NULL,
	`applicable` boolean NOT NULL,
	`validFrom` date,
	`validTo` date,
	`verificationStatus` enum('pending','verified','rejected','not_applicable') NOT NULL DEFAULT 'pending',
	`verifiedBy` int,
	`verifiedAt` datetime,
	`verificationNote` varchar(1000),
	`fileKey` varchar(512) NOT NULL,
	`originalName` varchar(200) NOT NULL,
	`mimeType` varchar(64) NOT NULL,
	`contentBytes` int NOT NULL,
	`contentSha256` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vehicle_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_fleet_profiles` (
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`propertyType` enum('company_owned','rented','partner') NOT NULL,
	`settlementMode` enum('monthly','daily','hourly','shift','trip','ton','volume','none') NOT NULL,
	`purpose` enum('general','trailer') NOT NULL DEFAULT 'general',
	`vin` varchar(32),
	`brandModel` varchar(160),
	`registeredOn` date,
	`energyType` varchar(64),
	`emissionStandard` varchar(64),
	`effectiveCapacityM3` decimal(10,3),
	`trailerVehicleId` int,
	`technicalStatus` enum('normal','repair','safety_hold') NOT NULL DEFAULT 'normal',
	`dispatchStatus` enum('standby','working','paused') NOT NULL DEFAULT 'standby',
	`projectStatus` enum('pending','on_site','exited') NOT NULL DEFAULT 'on_site',
	`archived` boolean NOT NULL DEFAULT false,
	`remarks` varchar(1000),
	`createdBy` int NOT NULL,
	`updatedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vehicle_fleet_profiles_vehicleId` PRIMARY KEY(`vehicleId`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_inspections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`occurredAt` datetime NOT NULL,
	`driverPersonId` int,
	`meterReading` decimal(14,2),
	`items` json NOT NULL,
	`safetyFault` boolean NOT NULL,
	`notes` varchar(1000) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vehicle_inspections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_maintenance_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`title` varchar(160) NOT NULL,
	`dueOn` date,
	`dueMileage` decimal(14,2),
	`lastMileage` decimal(14,2),
	`source` varchar(1000) NOT NULL,
	`completedAt` datetime,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vehicle_maintenance_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_special_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`kind` enum('earthwork','monitoring') NOT NULL,
	`recordedAt` datetime NOT NULL,
	`data` json NOT NULL,
	`reason` varchar(1000) NOT NULL,
	`source` varchar(32) NOT NULL DEFAULT 'manual',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vehicle_special_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_work_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`inspectionId` int NOT NULL,
	`status` enum('reported','repairing','awaiting_acceptance','accepted','released') NOT NULL DEFAULT 'reported',
	`safetyFault` boolean NOT NULL,
	`fault` varchar(1000) NOT NULL,
	`serviceProvider` varchar(160),
	`laborHours` decimal(10,2),
	`partsDescription` varchar(1000),
	`costBearer` enum('company','owner','shared'),
	`maintenanceRecordId` bigint,
	`purchaseOrderIds` json NOT NULL,
	`stoppedAt` datetime NOT NULL,
	`repairedAt` datetime,
	`acceptedAt` datetime,
	`acceptedBy` int,
	`releasedAt` datetime,
	`releasedBy` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vehicle_work_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `vehicle_work_order_maintenance_unique` UNIQUE(`maintenanceRecordId`)
);
--> statement-breakpoint
CREATE INDEX `vehicle_grant_subject` ON `vehicle_access_grants` (`userId`,`driverBindingId`);--> statement-breakpoint
CREATE INDEX `vehicle_grant_vehicle` ON `vehicle_access_grants` (`vehicleId`,`projectId`);--> statement-breakpoint
CREATE INDEX `vehicle_assignment_range` ON `vehicle_assignments` (`vehicleId`,`effectiveFrom`);--> statement-breakpoint
CREATE INDEX `vehicle_assignment_driver_range` ON `vehicle_assignments` (`driverBindingId`,`effectiveFrom`);--> statement-breakpoint
CREATE INDEX `vehicle_assignment_project` ON `vehicle_assignments` (`projectId`);--> statement-breakpoint
CREATE INDEX `vehicle_document_vehicle` ON `vehicle_documents` (`vehicleId`,`projectId`,`kind`);--> statement-breakpoint
CREATE INDEX `vehicle_fleet_project_index` ON `vehicle_fleet_profiles` (`projectId`,`archived`);--> statement-breakpoint
CREATE INDEX `vehicle_fleet_trailer_index` ON `vehicle_fleet_profiles` (`trailerVehicleId`);--> statement-breakpoint
CREATE INDEX `vehicle_inspection_vehicle` ON `vehicle_inspections` (`vehicleId`,`projectId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `vehicle_maintenance_plan_vehicle` ON `vehicle_maintenance_plans` (`vehicleId`,`projectId`);--> statement-breakpoint
CREATE INDEX `vehicle_special_vehicle` ON `vehicle_special_records` (`vehicleId`,`projectId`,`kind`);--> statement-breakpoint
CREATE INDEX `vehicle_work_order_vehicle` ON `vehicle_work_orders` (`vehicleId`,`projectId`,`status`);