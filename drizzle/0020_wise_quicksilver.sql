ALTER TABLE `purchase_orders` MODIFY COLUMN `requestId` bigint;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `procurementMode` enum('request','small_direct') DEFAULT 'request' NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `categoryId` int;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `itemDescription` varchar(500);--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `evidenceId` bigint;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `ocrSummary` varchar(500);--> statement-breakpoint
ALTER TABLE `purchase_orders` MODIFY `requestId` bigint NULL;--> statement-breakpoint
CREATE INDEX `purchase_orders_mode_index` ON `purchase_orders` (`projectId`,`procurementMode`,`status`);
