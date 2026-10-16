ALTER TABLE `purchase_orders` ADD `assetDeductionReference` varchar(64);--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `assetDeductedAt` datetime;--> statement-breakpoint
CREATE INDEX `purchase_orders_asset_deduction_index` ON `purchase_orders` (`projectId`,`assetType`,`assetId`,`assetDeductionReference`);