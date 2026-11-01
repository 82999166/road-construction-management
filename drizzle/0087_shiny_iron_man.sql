ALTER TABLE `machines` ADD `ownerUserId` int;--> statement-breakpoint
CREATE INDEX `machines_owner_project_index` ON `machines` (`ownerUserId`,`projectId`);