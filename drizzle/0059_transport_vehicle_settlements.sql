CREATE TABLE `transport_vehicle_settlements` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `settlementNo` varchar(64) NOT NULL,
  `projectId` int NOT NULL,
  `vehicleId` int NOT NULL,
  `periodStart` date NOT NULL,
  `periodEnd` date NOT NULL,
  `tripCount` int NOT NULL,
  `totalVolumeCubicMeters` decimal(14,3) NOT NULL DEFAULT '0',
  `grossFreightAmount` decimal(16,2) NOT NULL,
  `fuelDeductionAmount` decimal(16,2) NOT NULL DEFAULT '0',
  `netPayableAmount` decimal(16,2) NOT NULL,
  `payeeName` varchar(128) NOT NULL,
  `payeeAccount` varchar(160),
  `paymentMethod` enum('bank_transfer','corporate_account','cash','wechat','alipay','other') NOT NULL DEFAULT 'bank_transfer',
  `paymentDate` date,
  `paymentReference` varchar(128),
  `remarks` varchar(500),
  `status` enum('draft','submitted','approved','paid','void') NOT NULL DEFAULT 'draft',
  `submittedBy` int,
  `submittedAt` datetime,
  `approvedBy` int,
  `approvedAt` datetime,
  `paidBy` int,
  `paidAt` datetime,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `transport_vehicle_settlements_id` PRIMARY KEY(`id`),
  CONSTRAINT `transport_vehicle_settlements_no_unique` UNIQUE(`settlementNo`)
);
--> statement-breakpoint
CREATE INDEX `transport_vehicle_settlements_project_vehicle_period_index` ON `transport_vehicle_settlements` (`projectId`,`vehicleId`,`periodStart`,`periodEnd`);
--> statement-breakpoint
CREATE INDEX `transport_vehicle_settlements_project_status_index` ON `transport_vehicle_settlements` (`projectId`,`status`);
--> statement-breakpoint
CREATE TABLE `transport_vehicle_settlement_items` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `settlementId` bigint NOT NULL,
  `tripId` bigint NOT NULL,
  `tripNo` varchar(64) NOT NULL,
  `tripDate` date NOT NULL,
  `volumeCubicMeters` decimal(14,3) NOT NULL DEFAULT '0',
  `grossFreightAmount` decimal(16,2) NOT NULL,
  `fuelDeductionAmount` decimal(16,2) NOT NULL DEFAULT '0',
  `netPayableAmount` decimal(16,2) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `transport_vehicle_settlement_items_id` PRIMARY KEY(`id`),
  CONSTRAINT `transport_vehicle_settlement_items_trip_unique` UNIQUE(`tripId`)
);
--> statement-breakpoint
CREATE INDEX `transport_vehicle_settlement_items_settlement_index` ON `transport_vehicle_settlement_items` (`settlementId`);
