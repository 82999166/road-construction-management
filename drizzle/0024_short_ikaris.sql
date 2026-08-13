CREATE TABLE `transport_vehicle_lease_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int NOT NULL,
	`projectId` int NOT NULL,
	`billingType` enum('monthly','daily','hourly','shift') NOT NULL,
	`rate` decimal(16,2) NOT NULL,
	`effectiveFrom` date NOT NULL,
	`effectiveTo` date,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transport_vehicle_lease_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `transport_vehicle_lease_rules_vehicle_status_index` ON `transport_vehicle_lease_rules` (`vehicleId`,`status`);