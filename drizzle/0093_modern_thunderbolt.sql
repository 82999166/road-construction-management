ALTER TABLE `inventory_transactions` ADD `originalOutboundId` bigint;--> statement-breakpoint
ALTER TABLE `inventory_transactions` ADD `costRuleVersion` varchar(32) DEFAULT 'legacy_v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `inventory_transactions` ADD `costingUnitCost` decimal(24,8);--> statement-breakpoint
ALTER TABLE `inventory_transactions` ADD `exceptionReason` varchar(500);--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `inventoryItemName` varchar(200);--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `inventoryUnit` varchar(32);--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `receiptExpectedQuantity` decimal(14,3);--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `receiptBasisReason` varchar(500);--> statement-breakpoint
CREATE INDEX `inventory_transactions_original_outbound_index` ON `inventory_transactions` (`originalOutboundId`);--> statement-breakpoint
CREATE INDEX `inventory_transactions_purchase_order_index` ON `inventory_transactions` (`purchaseOrderId`);