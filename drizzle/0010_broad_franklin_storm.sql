CREATE TABLE `department_business_scopes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`module` enum('CONSTRUCTION','LABOR','MACHINERY','TRANSPORT','PURCHASING','MEASUREMENT','FINANCE','EVIDENCE') NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`configuredBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `department_business_scopes_id` PRIMARY KEY(`id`),
	CONSTRAINT `department_business_scopes_unique` UNIQUE(`organizationId`,`module`)
);
--> statement-breakpoint
CREATE INDEX `department_business_scopes_organization_index` ON `department_business_scopes` (`organizationId`);