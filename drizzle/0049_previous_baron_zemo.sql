CREATE TABLE `outsource_contracts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`contractNo` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`contractType` enum('transport','labor_subcontract','machinery_lease','material_supply','other') NOT NULL,
	`counterpartyName` varchar(200) NOT NULL,
	`counterpartyContact` varchar(100),
	`pricingMethod` enum('lump_sum','unit_price','trip','ton','m3','day','month','other') NOT NULL,
	`unit` varchar(32),
	`unitPrice` decimal(16,2),
	`contractAmount` decimal(16,2) NOT NULL DEFAULT '0',
	`startDate` date,
	`endDate` date,
	`status` enum('draft','active','suspended','expired','closed','void') NOT NULL DEFAULT 'draft',
	`attachmentEvidenceId` bigint,
	`contractSummary` varchar(1000),
	`remarks` varchar(500),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `outsource_contracts_id` PRIMARY KEY(`id`),
	CONSTRAINT `outsource_contracts_no_unique` UNIQUE(`contractNo`)
);
--> statement-breakpoint
CREATE INDEX `outsource_contracts_project_status_index` ON `outsource_contracts` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `outsource_contracts_project_type_index` ON `outsource_contracts` (`projectId`,`contractType`);