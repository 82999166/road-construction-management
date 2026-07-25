CREATE TABLE `inventory_transactions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`requestId` bigint,
	`purchaseOrderId` bigint,
	`transactionNo` varchar(64) NOT NULL,
	`transactionType` enum('inbound','outbound','return') NOT NULL,
	`itemName` varchar(200) NOT NULL,
	`unit` varchar(32) NOT NULL,
	`quantity` decimal(14,3) NOT NULL,
	`unitCost` decimal(16,2) NOT NULL DEFAULT '0',
	`amount` decimal(16,2) NOT NULL,
	`occurredAt` datetime NOT NULL,
	`operatorId` int NOT NULL,
	`remarks` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventory_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_transactions_no_unique` UNIQUE(`transactionNo`)
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`orderNo` varchar(64) NOT NULL,
	`requestId` bigint NOT NULL,
	`projectId` int NOT NULL,
	`supplierId` int,
	`amount` decimal(16,2) NOT NULL,
	`orderedAt` datetime NOT NULL,
	`status` enum('draft','confirmed','received','closed','void') NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `purchase_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchase_orders_no_unique` UNIQUE(`orderNo`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int,
	`name` varchar(200) NOT NULL,
	`unifiedSocialCreditCode` varchar(64),
	`contactName` varchar(64),
	`contactPhoneMasked` varchar(32),
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `measurement_claims` ADD `reviewedBy` int;--> statement-breakpoint
ALTER TABLE `measurement_claims` ADD `reviewedAt` datetime;--> statement-breakpoint
ALTER TABLE `measurement_claims` ADD `settledAt` datetime;--> statement-breakpoint
ALTER TABLE `measurement_claims` ADD `reviewNote` varchar(500);--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `approvedBy` int;--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `approvedAt` datetime;--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `stockedBy` int;--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `stockedAt` datetime;--> statement-breakpoint
ALTER TABLE `purchase_requests` ADD `closedAt` datetime;--> statement-breakpoint
CREATE INDEX `inventory_transactions_project_item_index` ON `inventory_transactions` (`projectId`,`itemName`,`unit`);--> statement-breakpoint
CREATE INDEX `purchase_orders_request_index` ON `purchase_orders` (`requestId`);--> statement-breakpoint
CREATE INDEX `purchase_orders_project_index` ON `purchase_orders` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `suppliers_organization_index` ON `suppliers` (`organizationId`);--> statement-breakpoint
CREATE INDEX `suppliers_name_index` ON `suppliers` (`name`);