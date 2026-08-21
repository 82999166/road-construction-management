CREATE TABLE `audit_log_chain_state` (
	`id` int NOT NULL,
	`lastSequence` bigint NOT NULL DEFAULT 0,
	`lastHash` varchar(64) NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `audit_log_chain_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log_integrity_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`auditLogId` bigint NOT NULL,
	`sequenceNo` bigint NOT NULL,
	`previousHash` varchar(64) NOT NULL,
	`entryHash` varchar(64) NOT NULL,
	`integrityVersion` varchar(32) NOT NULL DEFAULT 'audit-chain-v1',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_integrity_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `audit_log_integrity_events_log_unique` UNIQUE(`auditLogId`),
	CONSTRAINT `audit_log_integrity_events_sequence_unique` UNIQUE(`sequenceNo`),
	CONSTRAINT `audit_log_integrity_events_hash_unique` UNIQUE(`entryHash`)
);
--> statement-breakpoint
CREATE TABLE `sensitive_data_access_logs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int,
	`module` varchar(64) NOT NULL,
	`dataCategory` enum('full_payment_account','raw_location_coordinate','identity_document','other') NOT NULL,
	`accessPurpose` varchar(300) NOT NULL,
	`targetType` varchar(64),
	`targetId` varchar(128),
	`recordCount` int NOT NULL DEFAULT 0,
	`result` enum('granted','denied','exported','reviewed') NOT NULL DEFAULT 'granted',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sensitive_data_access_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `evidence_records` ADD `contentSha256` varchar(64);--> statement-breakpoint
ALTER TABLE `evidence_records` ADD `contentBytes` int;--> statement-breakpoint
ALTER TABLE `evidence_records` ADD `retentionUntil` date;--> statement-breakpoint
ALTER TABLE `evidence_records` ADD `status` enum('active','deleted') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `evidence_records` ADD `deletedAt` datetime;--> statement-breakpoint
ALTER TABLE `evidence_records` ADD `deletedBy` int;--> statement-breakpoint
ALTER TABLE `evidence_records` ADD `deletionReason` varchar(500);--> statement-breakpoint
ALTER TABLE `audit_log_integrity_events` ADD CONSTRAINT `audit_log_integrity_events_log_fk` FOREIGN KEY (`auditLogId`) REFERENCES `audit_logs`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sensitive_data_access_logs` ADD CONSTRAINT `sensitive_data_access_logs_user_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sensitive_data_access_logs_user_time_index` ON `sensitive_data_access_logs` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `sensitive_data_access_logs_project_category_time_index` ON `sensitive_data_access_logs` (`projectId`,`dataCategory`,`createdAt`);--> statement-breakpoint
ALTER TABLE `evidence_records` ADD CONSTRAINT `evidence_records_deleted_by_fk` FOREIGN KEY (`deletedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `evidence_records_project_status_created_index` ON `evidence_records` (`projectId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `evidence_records_content_hash_index` ON `evidence_records` (`contentSha256`);--> statement-breakpoint
INSERT INTO `audit_log_chain_state` (`id`, `lastSequence`, `lastHash`) VALUES (1, 0, SHA2('audit-chain-v1:genesis:2026-08-21', 256));--> statement-breakpoint
-- TiDB 不支持 CREATE TRIGGER；审计链由 server/services/auditIntegrity.ts 在同一事务中受控追加，
-- 并由管理员校验接口验证序号、前序哈希和链末锚点。业务路由不得更新或删除 audit_logs。
