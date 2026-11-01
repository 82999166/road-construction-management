ALTER TABLE `transport_vehicle_settlements` ADD `assetDeductionAmount` decimal(16,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `transport_vehicle_usage_records` ADD `settlementId` bigint;--> statement-breakpoint
CREATE INDEX `transport_vehicle_usage_records_settlement_index` ON `transport_vehicle_usage_records` (`settlementId`);