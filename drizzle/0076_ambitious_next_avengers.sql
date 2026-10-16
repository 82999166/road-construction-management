ALTER TABLE `purchase_orders` ADD `assetType` enum('vehicle','machine');--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `assetId` int;--> statement-breakpoint
CREATE INDEX `purchase_orders_asset_index` ON `purchase_orders` (`projectId`,`assetType`,`assetId`,`status`);