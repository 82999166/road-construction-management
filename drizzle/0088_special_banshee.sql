ALTER TABLE `department_business_scopes` MODIFY COLUMN `organizationId` int;--> statement-breakpoint
ALTER TABLE `department_business_scopes` ADD `projectId` int;--> statement-breakpoint
ALTER TABLE `department_business_scopes` ADD CONSTRAINT `department_business_scopes_project_module_unique` UNIQUE(`projectId`,`module`);--> statement-breakpoint
CREATE INDEX `department_business_scopes_project_index` ON `department_business_scopes` (`projectId`);