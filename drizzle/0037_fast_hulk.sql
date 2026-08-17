ALTER TABLE `project_risk_alerts` MODIFY COLUMN `status` enum('open','acknowledged','in_rectification','resolved','ignored') NOT NULL DEFAULT 'open';--> statement-breakpoint
ALTER TABLE `project_risk_alerts` ADD `assigneeUserId` int;--> statement-breakpoint
ALTER TABLE `project_risk_alerts` ADD `assignedBy` int;--> statement-breakpoint
ALTER TABLE `project_risk_alerts` ADD `assignedAt` datetime;--> statement-breakpoint
ALTER TABLE `project_risk_alerts` ADD `dueAt` datetime;--> statement-breakpoint
ALTER TABLE `project_risk_alerts` ADD `rectificationNote` varchar(1000);--> statement-breakpoint
ALTER TABLE `project_risk_alerts` ADD `rectifiedBy` int;--> statement-breakpoint
ALTER TABLE `project_risk_alerts` ADD `rectifiedAt` datetime;--> statement-breakpoint
ALTER TABLE `project_risk_alerts` ADD `lastEscalatedAt` datetime;--> statement-breakpoint
ALTER TABLE `project_risk_alerts` ADD `escalationCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_risk_rules` ADD `overdueEscalationEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_risk_rules` ADD `overdueEscalationHourChina` int DEFAULT 9 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_risk_rules` ADD `overdueEscalationCronTaskUid` varchar(65);--> statement-breakpoint
CREATE INDEX `project_risk_alerts_project_due_status_index` ON `project_risk_alerts` (`projectId`,`dueAt`,`status`);--> statement-breakpoint
CREATE INDEX `project_risk_rules_overdue_cron_task_index` ON `project_risk_rules` (`overdueEscalationCronTaskUid`);