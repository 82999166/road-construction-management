CREATE TABLE `daily_accounting_closure_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`closureId` bigint NOT NULL,
	`projectId` int NOT NULL,
	`revision` int NOT NULL,
	`eventType` enum('closed','reopened') NOT NULL,
	`snapshotHash` varchar(64),
	`snapshotJson` text,
	`reason` varchar(500),
	`performedBy` int NOT NULL,
	`performedAt` datetime NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_accounting_closure_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_closure_events_revision_unique` UNIQUE(`closureId`,`revision`,`eventType`)
);
--> statement-breakpoint
ALTER TABLE `daily_accounting_closures` MODIFY COLUMN `status` enum('closed','archived','void','reopened') NOT NULL DEFAULT 'closed';--> statement-breakpoint
ALTER TABLE `daily_accounting_closures` ADD `revision` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_accounting_closures` ADD `reopenedBy` int;--> statement-breakpoint
ALTER TABLE `daily_accounting_closures` ADD `reopenedAt` datetime;--> statement-breakpoint
ALTER TABLE `daily_accounting_closures` ADD `reopenReason` varchar(500);--> statement-breakpoint
INSERT INTO `daily_accounting_closure_events` (`closureId`, `projectId`, `revision`, `eventType`, `snapshotHash`, `snapshotJson`, `reason`, `performedBy`, `performedAt`)
SELECT closure.`id`, closure.`projectId`, closure.`revision`, 'closed', closure.`snapshotHash`, closure.`snapshotJson`, '历史日结迁移：保留既有封存快照', closure.`closedBy`, closure.`closedAt`
FROM `daily_accounting_closures` AS closure
WHERE NOT EXISTS (
  SELECT 1
  FROM `daily_accounting_closure_events` AS event
  WHERE event.`closureId` = closure.`id`
    AND event.`revision` = closure.`revision`
    AND event.`eventType` = 'closed'
);--> statement-breakpoint
ALTER TABLE `daily_accounting_closure_events` ADD CONSTRAINT `daily_closure_events_closure_fk` FOREIGN KEY (`closureId`) REFERENCES `daily_accounting_closures`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `daily_closure_events_project_performed_index` ON `daily_accounting_closure_events` (`projectId`,`performedAt`);
