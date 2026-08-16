CREATE TABLE `diesel_guideline_prices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`pricePerLiter` decimal(16,2) NOT NULL,
	`effectiveFrom` date NOT NULL,
	`effectiveTo` date,
	`status` enum('draft','active','disabled') NOT NULL DEFAULT 'draft',
	`remarks` varchar(500),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `diesel_guideline_prices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `diesel_refuel_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`recordNo` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`assetType` enum('vehicle','machine') NOT NULL,
	`vehicleId` int,
	`machineId` int,
	`transportTripId` bigint,
	`supplyMethod` enum('project_supply','external_station') NOT NULL,
	`stationOrSupplierName` varchar(160),
	`liters` decimal(12,3) NOT NULL,
	`actualUnitPrice` decimal(16,2),
	`appliedUnitPrice` decimal(16,2) NOT NULL,
	`amount` decimal(16,2) NOT NULL,
	`deductFromFreight` boolean NOT NULL DEFAULT false,
	`refueledAt` datetime NOT NULL,
	`meterReading` decimal(14,2),
	`receiptNo` varchar(64),
	`evidenceId` bigint,
	`remarks` varchar(500),
	`status` enum('draft','approved','settled','void') NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`approvedBy` int,
	`approvedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `diesel_refuel_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `diesel_refuel_records_no_unique` UNIQUE(`recordNo`)
);
--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `fuelDeductionAmount` decimal(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `netSettlementAmount` decimal(16,2);--> statement-breakpoint
ALTER TABLE `transport_trips` ADD `fuelSettlementSnapshot` json;--> statement-breakpoint
CREATE INDEX `diesel_guideline_prices_project_status_date_index` ON `diesel_guideline_prices` (`projectId`,`status`,`effectiveFrom`);--> statement-breakpoint
CREATE INDEX `diesel_refuel_records_project_date_index` ON `diesel_refuel_records` (`projectId`,`refueledAt`);--> statement-breakpoint
CREATE INDEX `diesel_refuel_records_trip_status_index` ON `diesel_refuel_records` (`transportTripId`,`status`);--> statement-breakpoint
CREATE INDEX `diesel_refuel_records_vehicle_date_index` ON `diesel_refuel_records` (`vehicleId`,`refueledAt`);--> statement-breakpoint
CREATE INDEX `diesel_refuel_records_machine_date_index` ON `diesel_refuel_records` (`machineId`,`refueledAt`);