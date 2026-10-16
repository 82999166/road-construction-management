-- 悦信云智管生产数据库结构参考快照
-- 导出时间：2026-10-16（清库后的正式结构）
-- 用途：与 drizzle/schema.ts 和 drizzle/migrations/ 一起进行结构比对。
-- 安全：不含任何业务记录、账号、口令、密钥、对象存储地址或数据库连接信息。
-- 注意：此文件仅作结构参考；不得直接作为生产恢复脚本执行。

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
-- Source table declaration: `__drizzle_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `__drizzle_migrations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `hash` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `asset_maintenance_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `asset_maintenance_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `assetType` enum('vehicle','machine') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `assetId` int NOT NULL,
  `projectId` int NOT NULL,
  `costCategory` enum('maintenance','repair') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(16,2) NOT NULL,
  `occurredAt` datetime NOT NULL,
  `serviceProvider` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meterReading` decimal(14,2) DEFAULT NULL,
  `nextDueAt` date DEFAULT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','approved','settled','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `asset_maintenance_records_asset_date_index` (`assetType`,`assetId`,`occurredAt`),
  KEY `asset_maintenance_records_project_status_index` (`projectId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `attendance_check_ins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_check_ins` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `projectId` int NOT NULL,
  `businessDate` date NOT NULL,
  `checkedInAt` datetime NOT NULL,
  `deviceFingerprintHash` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `deviceLabel` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `locationAccuracyMeters` decimal(10,2) DEFAULT NULL,
  `status` enum('normal','location_missing') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `checkedOutAt` datetime DEFAULT NULL,
  `checkoutLongitude` decimal(10,7) DEFAULT NULL,
  `checkoutLatitude` decimal(10,7) DEFAULT NULL,
  `checkoutLocationAccuracyMeters` decimal(10,2) DEFAULT NULL,
  `checkoutStatus` enum('normal','location_missing') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `checkInAddress` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `checkoutAddress` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `attendance_check_ins_user_project_date_unique` (`userId`,`projectId`,`businessDate`),
  KEY `attendance_check_ins_project_date_index` (`projectId`,`businessDate`),
  KEY `attendance_check_ins_device_index` (`deviceFingerprintHash`,`businessDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `attendance_device_bindings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_device_bindings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `deviceFingerprintHash` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `deviceLabel` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `firstBoundAt` datetime NOT NULL,
  `lastUsedAt` datetime NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `attendance_device_bindings_user_device_unique` (`userId`,`deviceFingerprintHash`),
  KEY `attendance_device_bindings_user_status_index` (`userId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `attendance_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `workerId` int NOT NULL,
  `projectId` int NOT NULL,
  `attendanceDate` date NOT NULL,
  `workHours` decimal(7,2) NOT NULL DEFAULT '0.00',
  `overtimeHours` decimal(7,2) NOT NULL DEFAULT '0.00',
  `source` enum('manual','mobile','device','import') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `evidenceId` bigint DEFAULT NULL,
  `status` enum('draft','confirmed','locked') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `note` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `attendance_worker_date_unique` (`workerId`,`attendanceDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `audit_log_chain_state`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log_chain_state` (
  `id` int NOT NULL,
  `lastSequence` bigint NOT NULL DEFAULT '0',
  `lastHash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `audit_log_integrity_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log_integrity_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `auditLogId` bigint NOT NULL,
  `sequenceNo` bigint NOT NULL,
  `previousHash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `entryHash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `integrityVersion` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'audit-chain-v1',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `audit_log_integrity_events_log_unique` (`auditLogId`),
  UNIQUE KEY `audit_log_integrity_events_sequence_unique` (`sequenceNo`),
  UNIQUE KEY `audit_log_integrity_events_hash_unique` (`entryHash`),
  CONSTRAINT `audit_log_integrity_events_log_fk` FOREIGN KEY (`auditLogId`) REFERENCES `audit_logs` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int DEFAULT NULL,
  `module` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `targetType` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `targetId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `summary` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `beforeJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `afterJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `ipAddress` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `audit_logs_module_index` (`module`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `config_publish_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `config_publish_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `settingId` int NOT NULL,
  `operation` enum('create','update','publish','disable','rollback') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `version` int NOT NULL,
  `operatorId` int NOT NULL,
  `reviewerId` int DEFAULT NULL,
  `snapshotJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `construction_daily_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `construction_daily_reports` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `reportDate` date NOT NULL,
  `workArea` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `weather` enum('sunny','cloudy','rainy','snowy','windy','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `workContent` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `safetyNotes` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `issueNotes` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `progressPercent` decimal(5,2) NOT NULL DEFAULT '0.00',
  `status` enum('draft','submitted','approved','rejected','locked') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdBy` int NOT NULL,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `reviewReply` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `construction_daily_reports_project_date_index` (`projectId`,`reportDate`),
  KEY `construction_daily_reports_project_status_index` (`projectId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `contract_tax_registrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contract_tax_registrations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `contractId` bigint NOT NULL,
  `projectId` int NOT NULL,
  `taxEntityId` bigint NOT NULL,
  `contractNoSnapshot` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `contractTypeSnapshot` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `counterpartyNameSnapshot` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `contractDate` date DEFAULT NULL,
  `contractAmountSnapshot` decimal(16,2) NOT NULL DEFAULT '0.00',
  `contractEvidenceId` bigint DEFAULT NULL,
  `taxItem` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `taxBaseAmount` decimal(16,2) DEFAULT NULL,
  `referenceTaxRate` decimal(7,4) DEFAULT NULL,
  `professionallyConfirmedTaxAmount` decimal(16,2) DEFAULT NULL,
  `paymentReference` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paymentEvidenceId` bigint DEFAULT NULL,
  `status` enum('pending_review','confirmed','handed_off','receipt_recorded','not_applicable','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending_review',
  `reviewNote` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` datetime DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `contract_tax_registrations_contract_unique` (`contractId`),
  KEY `contract_tax_registrations_entity_fk` (`taxEntityId`),
  KEY `contract_tax_registrations_contract_evidence_fk` (`contractEvidenceId`),
  KEY `contract_tax_registrations_payment_evidence_fk` (`paymentEvidenceId`),
  KEY `contract_tax_registrations_reviewer_fk` (`reviewedBy`),
  KEY `contract_tax_registrations_creator_fk` (`createdBy`),
  KEY `contract_tax_registrations_project_status_index` (`projectId`,`status`),
  CONSTRAINT `contract_tax_registrations_contract_evidence_fk` FOREIGN KEY (`contractEvidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `contract_tax_registrations_contract_fk` FOREIGN KEY (`contractId`) REFERENCES `outsource_contracts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `contract_tax_registrations_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `contract_tax_registrations_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `contract_tax_registrations_payment_evidence_fk` FOREIGN KEY (`paymentEvidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `contract_tax_registrations_reviewer_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `cross_region_construction_tax_ledgers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cross_region_construction_tax_ledgers` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `taxEntityId` bigint NOT NULL,
  `period` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectLocationSnapshot` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `taxMethodSnapshot` enum('general','small_scale','simplified','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectRegistrationReference` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `revenueIncludingTaxAmount` decimal(16,2) DEFAULT NULL,
  `subcontractDeductionAmount` decimal(16,2) DEFAULT NULL,
  `subcontractDeductionReference` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `deductionEvidenceId` bigint DEFAULT NULL,
  `prepaidVatAmount` decimal(16,2) DEFAULT NULL,
  `taxPaymentReference` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `taxPaymentEvidenceId` bigint DEFAULT NULL,
  `status` enum('pending_review','ready_for_handoff','receipt_recorded','not_applicable','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending_review',
  `reviewNote` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` datetime DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cross_region_construction_tax_project_period_unique` (`projectId`,`period`),
  KEY `cross_region_construction_tax_entity_fk` (`taxEntityId`),
  KEY `cross_region_construction_tax_deduction_evidence_fk` (`deductionEvidenceId`),
  KEY `cross_region_construction_tax_payment_evidence_fk` (`taxPaymentEvidenceId`),
  KEY `cross_region_construction_tax_reviewer_fk` (`reviewedBy`),
  KEY `cross_region_construction_tax_creator_fk` (`createdBy`),
  KEY `cross_region_construction_tax_entity_period_index` (`taxEntityId`,`period`,`status`),
  CONSTRAINT `cross_region_construction_tax_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `cross_region_construction_tax_deduction_evidence_fk` FOREIGN KEY (`deductionEvidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `cross_region_construction_tax_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `cross_region_construction_tax_payment_evidence_fk` FOREIGN KEY (`taxPaymentEvidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `cross_region_construction_tax_reviewer_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `daily_accounting_closure_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_accounting_closure_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `closureId` bigint NOT NULL,
  `projectId` int NOT NULL,
  `revision` int NOT NULL,
  `eventType` enum('closed','reopened') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `snapshotHash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `snapshotJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `performedBy` int NOT NULL,
  `performedAt` datetime NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `daily_closure_events_revision_unique` (`closureId`,`revision`,`eventType`),
  KEY `daily_closure_events_project_performed_index` (`projectId`,`performedAt`),
  CONSTRAINT `daily_closure_events_closure_fk` FOREIGN KEY (`closureId`) REFERENCES `daily_accounting_closures` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `daily_accounting_closures`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_accounting_closures` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `closingNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `closingDate` date NOT NULL,
  `totalIncome` decimal(16,2) NOT NULL DEFAULT '0.00',
  `totalExpense` decimal(16,2) NOT NULL DEFAULT '0.00',
  `recordCount` int NOT NULL DEFAULT '0',
  `invoiceCount` int NOT NULL DEFAULT '0',
  `invoiceAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `snapshotHash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `snapshotJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('closed','archived','void','reopened') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'closed',
  `closedBy` int NOT NULL,
  `closedAt` datetime NOT NULL,
  `archivedBy` int DEFAULT NULL,
  `archivedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `revision` int NOT NULL DEFAULT '1',
  `reopenedBy` int DEFAULT NULL,
  `reopenedAt` datetime DEFAULT NULL,
  `reopenReason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `daily_accounting_closures_no_unique` (`closingNo`),
  UNIQUE KEY `daily_accounting_closures_project_date_unique` (`projectId`,`closingDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `daily_project_digest_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_project_digest_runs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `scheduleId` int NOT NULL,
  `projectId` int NOT NULL,
  `businessDate` date NOT NULL,
  `status` enum('pending','completed','partial','skipped','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `summaryJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipientCount` int NOT NULL DEFAULT '0',
  `deliveredCount` int NOT NULL DEFAULT '0',
  `failedCount` int NOT NULL DEFAULT '0',
  `completedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `daily_project_digest_runs_schedule_project_date_unique` (`scheduleId`,`projectId`,`businessDate`),
  KEY `daily_project_digest_runs_schedule_date_index` (`scheduleId`,`businessDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `daily_project_digest_schedules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_project_digest_schedules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scopeKey` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `timezone` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Asia/Shanghai',
  `deliveryHour` int NOT NULL DEFAULT '20',
  `deliveryMinute` int NOT NULL DEFAULT '0',
  `includeEmptyProjects` tinyint(1) NOT NULL DEFAULT '0',
  `scheduleCronTaskUid` varchar(65) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lastAttemptedAt` datetime DEFAULT NULL,
  `lastSuccessfulBusinessDate` date DEFAULT NULL,
  `lastResultJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `createdBy` int DEFAULT NULL,
  `updatedBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `daily_project_digest_schedules_scope_unique` (`scopeKey`),
  KEY `daily_project_digest_schedules_task_uid_index` (`scheduleCronTaskUid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `data_backups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_backups` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `fileKey` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `fileName` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sha256` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `recordCount` int NOT NULL,
  `scopeVersion` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `data_backups_file_key_unique` (`fileKey`),
  KEY `data_backups_created_at_index` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `department_business_scopes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `department_business_scopes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `organizationId` int NOT NULL,
  `module` enum('CONSTRUCTION','LABOR','MACHINERY','TRANSPORT','PURCHASING','MEASUREMENT','CONTRACT','FINANCE','DIESEL','EVIDENCE') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `configuredBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `department_business_scopes_unique` (`organizationId`,`module`),
  KEY `department_business_scopes_organization_index` (`organizationId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `diesel_guideline_prices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `diesel_guideline_prices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `pricePerLiter` decimal(16,2) NOT NULL,
  `effectiveFrom` date NOT NULL,
  `effectiveTo` date DEFAULT NULL,
  `status` enum('draft','active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `diesel_guideline_prices_project_status_date_index` (`projectId`,`status`,`effectiveFrom`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `diesel_price_alert_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `diesel_price_alert_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `thresholdPercent` decimal(8,2) NOT NULL DEFAULT '10.00',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `diesel_price_alert_rules_project_unique` (`projectId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `diesel_refuel_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `diesel_refuel_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `recordNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `assetType` enum('vehicle','machine') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `vehicleId` int DEFAULT NULL,
  `machineId` int DEFAULT NULL,
  `transportTripId` bigint DEFAULT NULL,
  `supplyMethod` enum('project_supply','external_station') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `stationOrSupplierName` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `liters` decimal(12,3) NOT NULL,
  `actualUnitPrice` decimal(16,2) DEFAULT NULL,
  `appliedUnitPrice` decimal(16,2) NOT NULL,
  `amount` decimal(16,2) NOT NULL,
  `deductFromFreight` tinyint(1) NOT NULL DEFAULT '0',
  `refueledAt` datetime NOT NULL,
  `meterReading` decimal(14,2) DEFAULT NULL,
  `receiptNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `evidenceId` bigint DEFAULT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','approved','settled','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdBy` int NOT NULL,
  `approvedBy` int DEFAULT NULL,
  `approvedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `diesel_refuel_records_no_unique` (`recordNo`),
  KEY `diesel_refuel_records_project_date_index` (`projectId`,`refueledAt`),
  KEY `diesel_refuel_records_trip_status_index` (`transportTripId`,`status`),
  KEY `diesel_refuel_records_vehicle_date_index` (`vehicleId`,`refueledAt`),
  KEY `diesel_refuel_records_machine_date_index` (`machineId`,`refueledAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `employee_insurance_policies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_insurance_policies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employeeProfileId` int NOT NULL,
  `insuranceType` enum('work_injury','accident','medical','employer_liability','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `providerName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `policyReference` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `purchasedAt` date NOT NULL,
  `expiresAt` date NOT NULL,
  `status` enum('active','expired','cancelled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `employee_insurance_policies_profile_expiry_index` (`employeeProfileId`,`expiresAt`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `employee_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_profiles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int DEFAULT NULL,
  `laborWorkerId` int DEFAULT NULL,
  `projectId` int DEFAULT NULL,
  `employeeType` enum('management','operator','construction_worker') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `teamName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `employmentStatus` enum('active','suspended','left') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `joinedAt` date DEFAULT NULL,
  `leftAt` date DEFAULT NULL,
  `salaryBasis` enum('monthly','daily','hourly','piecework') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'monthly',
  `baseSalary` decimal(16,2) DEFAULT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `employee_profiles_user_index` (`userId`),
  KEY `employee_profiles_worker_index` (`laborWorkerId`),
  KEY `employee_profiles_project_type_index` (`projectId`,`employeeType`,`employmentStatus`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `evidence_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `evidence_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int DEFAULT NULL,
  `sourceType` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sourceId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fileKey` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `fileName` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mimeType` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ocrResultJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `watermarkJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `longitude` decimal(11,7) DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `capturedAt` datetime DEFAULT NULL,
  `uploadedBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `contentSha256` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contentBytes` int DEFAULT NULL,
  `retentionUntil` date DEFAULT NULL,
  `status` enum('active','deleted') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `deletedAt` datetime DEFAULT NULL,
  `deletedBy` int DEFAULT NULL,
  `deletionReason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `evidence_records_source_index` (`sourceType`,`sourceId`),
  KEY `evidence_records_project_status_created_index` (`projectId`,`status`,`createdAt`),
  KEY `evidence_records_content_hash_index` (`contentSha256`),
  KEY `evidence_records_deleted_by_fk` (`deletedBy`),
  CONSTRAINT `evidence_records_deleted_by_fk` FOREIGN KEY (`deletedBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `financial_invoice_originals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `financial_invoice_originals` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `originalFingerprint` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoiceNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoiceCode` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `counterpartyName` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoiceType` enum('vat_special','vat_normal','electronic','receipt','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `direction` enum('income','expense') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `totalAmount` decimal(16,2) NOT NULL,
  `totalTaxAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `taxRate` decimal(7,4) NOT NULL DEFAULT '0.0000',
  `issuedAt` date NOT NULL,
  `evidenceId` bigint DEFAULT NULL,
  `structuredPayloadJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `verificationStatus` enum('pending','manual_verified','external_verified','failed','not_required') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `verificationReference` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `verificationCheckedAt` datetime DEFAULT NULL,
  `redFlushOriginalId` bigint DEFAULT NULL,
  `redFlushReason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('issued','verified','void','red_flushed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'issued',
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `financial_invoice_originals_fingerprint_unique` (`originalFingerprint`),
  KEY `financial_invoice_originals_evidence_fk` (`evidenceId`),
  KEY `financial_invoice_originals_creator_fk` (`createdBy`),
  KEY `financial_invoice_originals_red_flush_fk` (`redFlushOriginalId`),
  KEY `financial_invoice_originals_status_date_index` (`status`,`issuedAt`),
  KEY `financial_invoice_originals_evidence_index` (`evidenceId`),
  KEY `financial_invoice_originals_red_flush_index` (`redFlushOriginalId`),
  CONSTRAINT `financial_invoice_originals_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `financial_invoice_originals_evidence_fk` FOREIGN KEY (`evidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `financial_invoice_originals_red_flush_fk` FOREIGN KEY (`redFlushOriginalId`) REFERENCES `financial_invoice_originals` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `financial_invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `financial_invoices` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `financialRecordId` bigint DEFAULT NULL,
  `invoiceNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoiceCode` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `counterpartyName` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoiceType` enum('vat_special','vat_normal','electronic','receipt','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `direction` enum('income','expense') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(16,2) NOT NULL,
  `taxAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `taxRate` decimal(7,4) NOT NULL DEFAULT '0.0000',
  `issuedAt` date NOT NULL,
  `verifiedAt` datetime DEFAULT NULL,
  `status` enum('issued','verified','void','red_flushed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'issued',
  `evidenceId` bigint DEFAULT NULL,
  `voidReason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `originalId` bigint DEFAULT NULL,
  `allocatedAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `allocationPurpose` enum('expense_deduction','reimbursement','income_collection','reference_only') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'expense_deduction',
  `allocationStatus` enum('active','void','red_flushed','legacy_review') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `financial_invoices_project_no_unique` (`projectId`,`invoiceNo`),
  KEY `financial_invoices_project_status_date_index` (`projectId`,`status`,`issuedAt`),
  KEY `financial_invoices_financial_record_index` (`financialRecordId`),
  KEY `financial_invoices_original_fk` (`originalId`),
  KEY `financial_invoices_original_index` (`originalId`,`allocationStatus`),
  CONSTRAINT `financial_invoices_original_fk` FOREIGN KEY (`originalId`) REFERENCES `financial_invoice_originals` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `financial_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `financial_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `recordNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int DEFAULT NULL,
  `direction` enum('income','expense') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(16,2) NOT NULL,
  `occurredAt` datetime NOT NULL,
  `settlementStatus` enum('unpaid','partial','paid','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unpaid',
  `sourceType` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sourceId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `evidenceId` bigint DEFAULT NULL,
  `remarks` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `dailyClosingId` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `financial_records_no_unique` (`recordNo`),
  KEY `financial_records_project_settlement_occurred_index` (`projectId`,`settlementStatus`,`occurredAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `freight_rate_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `freight_rate_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `materialName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `settlementUnit` enum('cubic_meter','ton','trip') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `startDistanceKm` decimal(8,3) NOT NULL DEFAULT '1.000',
  `basePricePerUnit` decimal(16,2) NOT NULL,
  `stepMeters` int NOT NULL DEFAULT '500',
  `stepIncreasePerUnit` decimal(16,2) NOT NULL DEFAULT '0.00',
  `effectiveFrom` date NOT NULL,
  `effectiveTo` date DEFAULT NULL,
  `status` enum('draft','active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `freight_rate_rules_project_index` (`projectId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `inventory_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_transactions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `requestId` bigint DEFAULT NULL,
  `purchaseOrderId` bigint DEFAULT NULL,
  `transactionNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `transactionType` enum('inbound','outbound','return') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `itemName` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `unit` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(14,3) NOT NULL,
  `unitCost` decimal(16,2) NOT NULL DEFAULT '0.00',
  `amount` decimal(16,2) NOT NULL,
  `occurredAt` datetime NOT NULL,
  `operatorId` int NOT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inventory_transactions_no_unique` (`transactionNo`),
  KEY `inventory_transactions_project_item_index` (`projectId`,`itemName`,`unit`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `labor_workers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `labor_workers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `teamName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `realName` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `identityNoEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `phoneEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `bankAccountEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `bankName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attendanceStatus` enum('pending','active','left') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `entryDate` date DEFAULT NULL,
  `exitDate` date DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `identityVerificationStatus` enum('pending','verified','rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `identityVerificationNote` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `identityVerifiedAt` datetime DEFAULT NULL,
  `identityVerifiedBy` int DEFAULT NULL,
  `workerCategory` enum('company_admin','labor_team','temporary_daily') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'labor_team',
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `labor_workers_project_index` (`projectId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `login_rate_limit_states`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_rate_limit_states` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scope` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `subjectHash` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `failureCount` int NOT NULL DEFAULT '0',
  `windowStartedAt` datetime NOT NULL,
  `lastFailureAt` datetime NOT NULL,
  `lockedUntil` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `login_rate_limit_scope_subject_unique` (`scope`,`subjectHash`),
  KEY `login_rate_limit_locked_until_index` (`lockedUntil`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `machine_cost_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `machine_cost_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `machineId` int NOT NULL,
  `projectId` int NOT NULL,
  `costType` enum('fuel','repair','overtime','mobilization','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(12,3) NOT NULL DEFAULT '0.000',
  `unitPrice` decimal(16,2) NOT NULL DEFAULT '0.00',
  `amount` decimal(16,2) NOT NULL,
  `occurredAt` datetime NOT NULL,
  `evidenceId` bigint DEFAULT NULL,
  `status` enum('draft','approved','settled','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `dieselRefuelRecordId` bigint DEFAULT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `costName` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `machine_cost_records_diesel_refuel_unique` (`dieselRefuelRecordId`),
  KEY `machine_cost_records_machine_date_index` (`machineId`,`occurredAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `machine_daily_operations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `machine_daily_operations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `machineId` int NOT NULL,
  `occurredOn` date NOT NULL,
  `operatorUserId` int DEFAULT NULL,
  `workHours` decimal(8,2) NOT NULL DEFAULT '0.00',
  `overtimeHours` decimal(8,2) NOT NULL DEFAULT '0.00',
  `outputAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `driverWageAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','submitted','approved','settled','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `machine_daily_operations_machine_project_day_unique` (`machineId`,`projectId`,`occurredOn`),
  KEY `machine_daily_operations_project_date_index` (`projectId`,`occurredOn`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `machine_lease_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `machine_lease_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `machineId` int NOT NULL,
  `projectId` int NOT NULL,
  `billingType` enum('monthly','daily','hourly','shift') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `rate` decimal(16,2) NOT NULL,
  `overtimeHourlyRate` decimal(16,2) NOT NULL DEFAULT '0.00',
  `effectiveFrom` date NOT NULL,
  `effectiveTo` date DEFAULT NULL,
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `machine_lease_rules_machine_index` (`machineId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `machine_monthly_statements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `machine_monthly_statements` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `machineId` int NOT NULL,
  `period` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `driverUserId` int DEFAULT NULL,
  `driverNameSnapshot` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ownerNameSnapshot` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `machineModelSnapshot` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `machineWorkDays` decimal(8,2) NOT NULL DEFAULT '0.00',
  `machineOvertimeHours` decimal(10,2) NOT NULL DEFAULT '0.00',
  `driverMonthlyWage` decimal(16,2) NOT NULL DEFAULT '0.00',
  `driverWorkDays` decimal(8,2) NOT NULL DEFAULT '0.00',
  `driverOvertimeHours` decimal(10,2) NOT NULL DEFAULT '0.00',
  `machineBaseOutput` decimal(16,2) NOT NULL DEFAULT '0.00',
  `machineOvertimeOutput` decimal(16,2) NOT NULL DEFAULT '0.00',
  `totalOutput` decimal(16,2) NOT NULL DEFAULT '0.00',
  `driverOvertimeWage` decimal(16,2) NOT NULL DEFAULT '0.00',
  `driverTotalWage` decimal(16,2) NOT NULL DEFAULT '0.00',
  `repairAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `fuelLiters` decimal(14,3) NOT NULL DEFAULT '0.000',
  `fuelAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `deductionAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `shareBaseAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `machineShareAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `signatureName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `signedAt` datetime DEFAULT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','submitted','approved','settled','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `leaseBillingType` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `leaseRate` decimal(16,2) NOT NULL DEFAULT '0.00',
  `machineOvertimeRate` decimal(16,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `machine_monthly_statements_machine_period_unique` (`machineId`,`projectId`,`period`),
  KEY `machine_monthly_statements_project_period_index` (`projectId`,`period`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `machine_payment_settlements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `machine_payment_settlements` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `settlementNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `machineId` int NOT NULL,
  `monthlyStatementId` bigint NOT NULL,
  `period` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `grossPayableAmount` decimal(16,2) NOT NULL,
  `fuelCostAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `repairCostAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `manualDeductionAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `netPayableAmount` decimal(16,2) NOT NULL,
  `payeeName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `payeeAccount` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paymentMethod` enum('bank_transfer','corporate_account','cash','wechat','alipay','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'bank_transfer',
  `paymentDate` date DEFAULT NULL,
  `paymentReference` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','submitted','approved','paid','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `submittedBy` int DEFAULT NULL,
  `submittedAt` datetime DEFAULT NULL,
  `approvedBy` int DEFAULT NULL,
  `approvedAt` datetime DEFAULT NULL,
  `paidBy` int DEFAULT NULL,
  `paidAt` datetime DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `machine_payment_settlements_no_unique` (`settlementNo`),
  UNIQUE KEY `machine_payment_settlements_statement_unique` (`monthlyStatementId`),
  KEY `machine_payment_settlements_project_machine_period_index` (`projectId`,`machineId`,`period`),
  KEY `machine_payment_settlements_project_status_index` (`projectId`,`status`),
  KEY `machine_payment_settlements_machine_fk` (`machineId`),
  CONSTRAINT `machine_payment_settlements_machine_fk` FOREIGN KEY (`machineId`) REFERENCES `machines` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `machine_payment_settlements_statement_fk` FOREIGN KEY (`monthlyStatementId`) REFERENCES `machine_monthly_statements` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `machines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `machines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int DEFAULT NULL,
  `code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ownership` enum('owned','leased') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `supplierName` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `plateOrAssetNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('idle','working','repairing','offsite','retired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'idle',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `operatorUserId` int DEFAULT NULL,
  `fuelTankCapacityLiters` decimal(10,2) DEFAULT NULL,
  `driverName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `driverPhoneEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `driverPhoneMasked` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `machines_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `measurement_claims`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `measurement_claims` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `claimNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `period` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `declaredAmount` decimal(16,2) NOT NULL,
  `approvedAmount` decimal(16,2) DEFAULT NULL,
  `status` enum('draft','submitted','reviewing','approved','settled','rejected','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `submittedBy` int NOT NULL,
  `accountantId` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` datetime DEFAULT NULL,
  `settledAt` datetime DEFAULT NULL,
  `reviewNote` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `measurement_claims_no_unique` (`claimNo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `measurement_takeoff_evidences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `measurement_takeoff_evidences` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `takeoffId` bigint NOT NULL,
  `evidenceId` bigint NOT NULL,
  `linkedBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `measurement_takeoff_evidences_unique` (`takeoffId`,`evidenceId`),
  KEY `measurement_takeoff_evidences_takeoff_index` (`takeoffId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `measurement_takeoff_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `measurement_takeoff_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `takeoffNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `measurementClaimId` bigint DEFAULT NULL,
  `workItem` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `workLocation` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `unit` enum('m3','m2','m','t','piece','set','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(16,3) NOT NULL,
  `unitPrice` decimal(16,2) NOT NULL DEFAULT '0.00',
  `declaredAmount` decimal(16,2) NOT NULL,
  `takeoffDate` date NOT NULL,
  `status` enum('draft','submitted','reviewing','approved','rejected','locked','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `submittedBy` int NOT NULL,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` datetime DEFAULT NULL,
  `reviewNote` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lockedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `measurement_takeoff_records_no_unique` (`takeoffNo`),
  KEY `measurement_takeoff_records_project_status_date_index` (`projectId`,`status`,`takeoffDate`),
  KEY `measurement_takeoff_records_claim_index` (`measurementClaimId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `notification_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `eventCode` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `idempotencyKey` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipientUserId` int NOT NULL,
  `title` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `deepLink` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','sent','failed','skipped','read') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `retryCount` int NOT NULL DEFAULT '0',
  `sentAt` datetime DEFAULT NULL,
  `readAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `channel` enum('legacy_wecom','official_account','in_app') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'legacy_wecom',
  `providerMessageId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `failureCode` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lastAttemptedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `notification_idempotency_unique` (`idempotencyKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `official_account_binding_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `official_account_binding_requests` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `tokenFingerprint` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiresAt` datetime NOT NULL,
  `consumedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `official_account_binding_requests_token_unique` (`tokenFingerprint`),
  KEY `official_account_binding_requests_user_index` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `official_account_bindings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `official_account_bindings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `openIdEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `openIdFingerprint` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bindingSource` enum('wechat_oauth','admin_verified') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'wechat_oauth',
  `status` enum('pending','active','unsubscribed','revoked','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `boundAt` datetime DEFAULT NULL,
  `lastVerifiedAt` datetime DEFAULT NULL,
  `lastFailureAt` datetime DEFAULT NULL,
  `failureCount` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `official_account_bindings_user_unique` (`userId`),
  UNIQUE KEY `official_account_bindings_openid_fingerprint_unique` (`openIdFingerprint`),
  KEY `official_account_bindings_status_index` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `official_account_broadcast_deliveries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `official_account_broadcast_deliveries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `broadcastId` bigint NOT NULL,
  `recipientUserId` int NOT NULL,
  `notificationRecordId` bigint DEFAULT NULL,
  `deliveryStatus` enum('pending','sent','failed','skipped') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `deliveryReason` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `providerMessageId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attemptedAt` datetime DEFAULT NULL,
  `deliveredAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `recipientNameSnapshot` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipientRoleSnapshot` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipientScopeSnapshot` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acknowledgementStatus` enum('not_required','pending','acknowledged') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `acknowledgedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `official_account_broadcast_deliveries_recipient_unique` (`broadcastId`,`recipientUserId`),
  KEY `official_account_broadcast_deliveries_status_index` (`broadcastId`,`deliveryStatus`),
  KEY `official_account_broadcast_deliveries_acknowledgement_index` (`broadcastId`,`acknowledgementStatus`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `official_account_broadcasts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `official_account_broadcasts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `broadcastNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `deepLink` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `audienceType` enum('project','organization','role') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int DEFAULT NULL,
  `organizationId` int DEFAULT NULL,
  `roleCode` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','submitted','approved','rejected','publishing','published','partial','failed','cancelled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `reviewNote` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdBy` int NOT NULL,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` datetime DEFAULT NULL,
  `publishedBy` int DEFAULT NULL,
  `publishedAt` datetime DEFAULT NULL,
  `recipientCount` int NOT NULL DEFAULT '0',
  `deliveredCount` int NOT NULL DEFAULT '0',
  `failedCount` int NOT NULL DEFAULT '0',
  `skippedCount` int NOT NULL DEFAULT '0',
  `audienceSnapshotJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `requiresAcknowledgement` tinyint(1) NOT NULL DEFAULT '1',
  `acknowledgedCount` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `official_account_broadcasts_no_unique` (`broadcastNo`),
  KEY `official_account_broadcasts_status_index` (`status`,`updatedAt`),
  KEY `official_account_broadcasts_scope_index` (`audienceType`,`projectId`,`organizationId`,`roleCode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `official_account_driver_binding_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `official_account_driver_binding_requests` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tokenFingerprint` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `openIdEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `openIdFingerprint` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiresAt` datetime NOT NULL,
  `consumedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `official_account_driver_binding_requests_token_unique` (`tokenFingerprint`),
  KEY `official_account_driver_binding_requests_openid_index` (`openIdFingerprint`,`expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `official_account_driver_bindings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `official_account_driver_bindings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `vehicleId` int NOT NULL,
  `projectId` int NOT NULL,
  `plateNoSnapshot` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `driverNameSnapshot` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `driverPhoneMaskedSnapshot` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `openIdEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `openIdFingerprint` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','revoked','disabled','unsubscribed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `boundAt` datetime DEFAULT NULL,
  `lastVerifiedAt` datetime DEFAULT NULL,
  `lastFailureAt` datetime DEFAULT NULL,
  `failureCount` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `official_account_driver_bindings_vehicle_index` (`vehicleId`,`status`),
  KEY `official_account_driver_bindings_openid_index` (`openIdFingerprint`,`status`),
  KEY `official_account_driver_bindings_project_status_index` (`projectId`,`status`),
  CONSTRAINT `official_account_driver_bindings_vehicle_fk` FOREIGN KEY (`vehicleId`) REFERENCES `transport_vehicles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `official_account_driver_notification_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `official_account_driver_notification_records` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `eventCode` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `idempotencyKey` varchar(180) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `driverBindingId` bigint DEFAULT NULL,
  `vehicleId` int NOT NULL,
  `projectId` int NOT NULL,
  `title` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `deepLink` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','sent','failed','skipped') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `retryCount` int NOT NULL DEFAULT '0',
  `sentAt` datetime DEFAULT NULL,
  `providerMessageId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `failureCode` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lastAttemptedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `official_account_driver_notifications_idempotency_unique` (`idempotencyKey`),
  KEY `official_account_driver_notifications_vehicle_status_index` (`vehicleId`,`status`),
  KEY `official_account_driver_notifications_project_created_index` (`projectId`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `organizations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `organizations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `parentId` int DEFAULT NULL,
  `code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('group','company','project_department','department','team') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `managerUserId` int DEFAULT NULL,
  `costCenterCode` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `organizations_code_unique` (`code`),
  KEY `organizations_parent_index` (`parentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `outsource_contracts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outsource_contracts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `contractNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `contractType` enum('transport','labor_subcontract','machinery_lease','material_supply','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `counterpartyName` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `counterpartyContact` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pricingMethod` enum('lump_sum','unit_price','trip','ton','m3','day','month','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `unit` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unitPrice` decimal(16,2) DEFAULT NULL,
  `contractAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `startDate` date DEFAULT NULL,
  `endDate` date DEFAULT NULL,
  `status` enum('draft','active','suspended','expired','closed','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `attachmentEvidenceId` bigint DEFAULT NULL,
  `contractSummary` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `outsource_contracts_no_unique` (`contractNo`),
  KEY `outsource_contracts_project_status_index` (`projectId`,`status`),
  KEY `outsource_contracts_project_type_index` (`projectId`,`contractType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `payroll_statements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_statements` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `workerId` int NOT NULL,
  `projectId` int NOT NULL,
  `period` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `payableAmount` decimal(16,2) NOT NULL,
  `deductionAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `actualAmount` decimal(16,2) NOT NULL,
  `bankAccountMasked` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','reviewing','approved','paid','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `accountantId` int DEFAULT NULL,
  `paidAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `submittedBy` int DEFAULT NULL,
  `submittedAt` datetime DEFAULT NULL,
  `reviewedAt` datetime DEFAULT NULL,
  `paymentReference` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `payroll_worker_project_period_unique` (`workerId`,`projectId`,`period`),
  KEY `payroll_statements_project_period_status_index` (`projectId`,`period`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `payroll_tax_withholding_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_tax_withholding_entries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `workerId` int NOT NULL,
  `projectId` int NOT NULL,
  `taxEntityId` bigint NOT NULL,
  `period` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `incomeType` enum('resident_wage_salary','labor_remuneration','nonresident_wage_salary','manual_review') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sourceGrossIncome` decimal(16,2) NOT NULL DEFAULT '0.00',
  `sourceDocumentCount` int NOT NULL DEFAULT '0',
  `cumulativeGrossIncome` decimal(16,2) NOT NULL DEFAULT '0.00',
  `cumulativeExemptIncome` decimal(16,2) NOT NULL DEFAULT '0.00',
  `employmentMonths` int NOT NULL DEFAULT '0',
  `cumulativeBasicDeduction` decimal(16,2) NOT NULL DEFAULT '0.00',
  `cumulativeSocialInsuranceDeduction` decimal(16,2) NOT NULL DEFAULT '0.00',
  `cumulativeSpecialAdditionalDeduction` decimal(16,2) NOT NULL DEFAULT '0.00',
  `cumulativeOtherDeduction` decimal(16,2) NOT NULL DEFAULT '0.00',
  `cumulativeTaxableIncome` decimal(16,2) NOT NULL DEFAULT '0.00',
  `applicableRate` decimal(7,4) DEFAULT NULL,
  `quickDeduction` decimal(16,2) DEFAULT NULL,
  `calculatedCumulativeTax` decimal(16,2) DEFAULT NULL,
  `cumulativeTaxWithheldBefore` decimal(16,2) NOT NULL DEFAULT '0.00',
  `calculatedCurrentWithholding` decimal(16,2) DEFAULT NULL,
  `externallyWithheldThisPeriod` decimal(16,2) DEFAULT NULL,
  `externalReference` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `evidenceId` bigint DEFAULT NULL,
  `calculationSnapshotJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('draft','reviewed','handed_off','receipt_recorded','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `reviewNote` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` datetime DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `payroll_tax_withholding_worker_entity_period_unique` (`workerId`,`taxEntityId`,`period`,`incomeType`),
  KEY `payroll_tax_withholding_entity_fk` (`taxEntityId`),
  KEY `payroll_tax_withholding_evidence_fk` (`evidenceId`),
  KEY `payroll_tax_withholding_reviewer_fk` (`reviewedBy`),
  KEY `payroll_tax_withholding_creator_fk` (`createdBy`),
  KEY `payroll_tax_withholding_project_period_index` (`projectId`,`period`,`status`),
  CONSTRAINT `payroll_tax_withholding_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `payroll_tax_withholding_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `payroll_tax_withholding_evidence_fk` FOREIGN KEY (`evidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `payroll_tax_withholding_reviewer_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `payroll_tax_withholding_worker_fk` FOREIGN KEY (`workerId`) REFERENCES `labor_workers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `positions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `positions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `positions_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `project_risk_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_risk_alerts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `businessDate` date NOT NULL,
  `category` enum('construction','attendance','fuel','transport') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `severity` enum('notice','warning','critical') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'warning',
  `ruleCode` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sourceType` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sourceId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `evidenceJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `status` enum('open','acknowledged','in_rectification','resolved','ignored') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `notifiedAt` datetime DEFAULT NULL,
  `acknowledgedBy` int DEFAULT NULL,
  `acknowledgedAt` datetime DEFAULT NULL,
  `resolvedBy` int DEFAULT NULL,
  `resolvedAt` datetime DEFAULT NULL,
  `resolutionNote` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `assigneeUserId` int DEFAULT NULL,
  `assignedBy` int DEFAULT NULL,
  `assignedAt` datetime DEFAULT NULL,
  `dueAt` datetime DEFAULT NULL,
  `rectificationNote` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rectifiedBy` int DEFAULT NULL,
  `rectifiedAt` datetime DEFAULT NULL,
  `lastEscalatedAt` datetime DEFAULT NULL,
  `escalationCount` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `project_risk_alerts_unique` (`projectId`,`ruleCode`,`sourceId`,`businessDate`),
  KEY `project_risk_alerts_project_status_date_index` (`projectId`,`status`,`businessDate`),
  KEY `project_risk_alerts_project_due_status_index` (`projectId`,`dueAt`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `project_risk_briefings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_risk_briefings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `period` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `summaryJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `alertSnapshotJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `generatedBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `project_risk_briefings_project_period_index` (`projectId`,`period`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `project_risk_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_risk_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `maxFuelFillRatio` decimal(6,3) NOT NULL DEFAULT '1.100',
  `maxTransportSpeedKmh` decimal(8,2) NOT NULL DEFAULT '80.00',
  `maxTransportDurationMinutes` int NOT NULL DEFAULT '360',
  `maxOpenCheckInHours` int NOT NULL DEFAULT '14',
  `maxPendingReportHours` int NOT NULL DEFAULT '24',
  `createdBy` int DEFAULT NULL,
  `updatedBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `overdueEscalationEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `overdueEscalationHourChina` int NOT NULL DEFAULT '9',
  `overdueEscalationCronTaskUid` varchar(65) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `project_risk_rules_project_unique` (`projectId`),
  KEY `project_risk_rules_overdue_cron_task_index` (`overdueEscalationCronTaskUid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `project_tax_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_tax_profiles` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `taxEntityId` bigint NOT NULL,
  `projectLocation` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `taxMethod` enum('general','small_scale','simplified','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'general',
  `contractExTaxAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `contractTaxRate` decimal(7,4) NOT NULL DEFAULT '0.0000',
  `crossRegionConstruction` tinyint(1) NOT NULL DEFAULT '0',
  `subcontractDeductionMethod` enum('not_applicable','supporting_document','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_applicable',
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','archived') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `project_tax_profiles_project_unique` (`projectId`),
  KEY `project_tax_profiles_entity_fk` (`taxEntityId`),
  KEY `project_tax_profiles_creator_fk` (`createdBy`),
  KEY `project_tax_profiles_entity_index` (`taxEntityId`,`status`),
  CONSTRAINT `project_tax_profiles_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `project_tax_profiles_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `projects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `projects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `parentId` int DEFAULT NULL,
  `organizationId` int DEFAULT NULL,
  `code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `nodeType` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectType` enum('highway','railway','municipal','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('planning','active','suspended','completed','archived') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'planning',
  `startDate` date DEFAULT NULL,
  `endDate` date DEFAULT NULL,
  `costCenterCode` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `projects_code_unique` (`code`),
  KEY `projects_parent_index` (`parentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `purchase_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  `isFixed` tinyint(1) NOT NULL DEFAULT '1',
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `purchase_categories_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_orders` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `orderNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `requestId` bigint DEFAULT NULL,
  `projectId` int NOT NULL,
  `supplierId` int DEFAULT NULL,
  `amount` decimal(16,2) NOT NULL,
  `orderedAt` datetime NOT NULL,
  `status` enum('draft','confirmed','received','closed','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdBy` int NOT NULL,
  `confirmedBy` int DEFAULT NULL,
  `confirmedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `procurementMode` enum('request','small_direct','imported') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'request',
  `categoryId` int DEFAULT NULL,
  `itemDescription` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `evidenceId` bigint DEFAULT NULL,
  `ocrSummary` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `quantity` decimal(16,3) DEFAULT NULL,
  `unitPrice` decimal(16,2) DEFAULT NULL,
  `hasInvoice` tinyint(1) NOT NULL DEFAULT '0',
  `invoiceEvidenceId` bigint DEFAULT NULL,
  `assetType` enum('vehicle','machine') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `assetId` int DEFAULT NULL,
  `assetDeductionReference` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `assetDeductedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `purchase_orders_no_unique` (`orderNo`),
  KEY `purchase_orders_request_index` (`requestId`),
  KEY `purchase_orders_project_index` (`projectId`,`status`),
  KEY `purchase_orders_mode_index` (`projectId`,`procurementMode`,`status`),
  KEY `purchase_orders_asset_index` (`projectId`,`assetType`,`assetId`,`status`),
  KEY `purchase_orders_asset_deduction_index` (`projectId`,`assetType`,`assetId`,`assetDeductionReference`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `purchase_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_requests` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `requestNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `categoryId` int NOT NULL,
  `requesterId` int NOT NULL,
  `amount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('draft','submitted','approved','ordered','received','stocked','closed','rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `approvedBy` int DEFAULT NULL,
  `approvedAt` datetime DEFAULT NULL,
  `stockedBy` int DEFAULT NULL,
  `stockedAt` datetime DEFAULT NULL,
  `closedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `purchase_requests_no_unique` (`requestNo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `rfid_card_write_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rfid_card_write_jobs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `jobNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `vehicleId` int NOT NULL,
  `cardId` bigint NOT NULL,
  `writerDeviceId` int DEFAULT NULL,
  `action` enum('issue','rewrite','revoke') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `payloadFingerprint` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `payloadVersion` int NOT NULL,
  `status` enum('prepared','confirmed','failed','cancelled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'prepared',
  `failureReason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `preparedBy` int NOT NULL,
  `confirmedBy` int DEFAULT NULL,
  `confirmedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `payloadEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `executionMode` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual_confirmation',
  `bridgeTokenHash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bridgeTokenExpiresAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rfid_card_write_jobs_no_unique` (`jobNo`),
  KEY `rfid_card_write_jobs_card_created_index` (`cardId`,`createdAt`),
  KEY `rfid_card_write_jobs_project_status_index` (`projectId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `rfid_writer_devices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rfid_writer_devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `deviceCode` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `displayName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `connectionMode` enum('manual_placeholder','usb','serial','network') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual_placeholder',
  `status` enum('active','disabled','maintenance') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lastConfirmedAt` datetime DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rfid_writer_devices_project_code_unique` (`projectId`,`deviceCode`),
  KEY `rfid_writer_devices_project_status_index` (`projectId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `roleId` int NOT NULL,
  `permissionId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_permissions_unique` (`roleId`,`permissionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `sensitive_data_access_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sensitive_data_access_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `projectId` int DEFAULT NULL,
  `module` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `dataCategory` enum('full_payment_account','raw_location_coordinate','identity_document','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `accessPurpose` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `targetType` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `targetId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recordCount` int NOT NULL DEFAULT '0',
  `result` enum('granted','denied','exported','reviewed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'granted',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `sensitive_data_access_logs_user_fk` (`userId`),
  KEY `sensitive_data_access_logs_user_time_index` (`userId`,`createdAt`),
  KEY `sensitive_data_access_logs_project_category_time_index` (`projectId`,`dataCategory`,`createdAt`),
  CONSTRAINT `sensitive_data_access_logs_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `subcontract_packages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subcontract_packages` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `packageNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `measurementTakeoffId` bigint DEFAULT NULL,
  `subcontractTeamId` bigint NOT NULL,
  `workItem` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `workLocation` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unit` enum('m3','m2','m','t','piece','set','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(16,3) NOT NULL,
  `upstreamUnitPrice` decimal(16,2) NOT NULL DEFAULT '0.00',
  `subcontractUnitPrice` decimal(16,2) NOT NULL DEFAULT '0.00',
  `upstreamAmount` decimal(16,2) NOT NULL,
  `subcontractAmount` decimal(16,2) NOT NULL,
  `marginAmount` decimal(16,2) NOT NULL,
  `status` enum('draft','allocated','confirmed','settled','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `allocatedAt` datetime DEFAULT NULL,
  `settledAt` datetime DEFAULT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `priceExceptionReason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confirmedBy` int DEFAULT NULL,
  `confirmedAt` datetime DEFAULT NULL,
  `priceExceptionReviewedBy` int DEFAULT NULL,
  `priceExceptionReviewedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `subcontract_packages_no_unique` (`packageNo`),
  KEY `subcontract_packages_project_status_index` (`projectId`,`status`),
  KEY `subcontract_packages_team_index` (`subcontractTeamId`),
  KEY `subcontract_packages_takeoff_index` (`measurementTakeoffId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `subcontract_payment_settlements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subcontract_payment_settlements` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `settlementNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `packageId` bigint NOT NULL,
  `subcontractTeamId` bigint NOT NULL,
  `packageNoSnapshot` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `workItemSnapshot` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantitySnapshot` decimal(16,3) NOT NULL,
  `unitSnapshot` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `grossPayableAmount` decimal(16,2) NOT NULL,
  `manualDeductionAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `netPayableAmount` decimal(16,2) NOT NULL,
  `invoiceStatus` enum('missing','attached','verified','rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'missing',
  `invoiceNo` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoiceEvidenceId` bigint DEFAULT NULL,
  `payeeName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `payeeAccount` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paymentMethod` enum('bank_transfer','corporate_account','cash','wechat','alipay','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'bank_transfer',
  `paymentDate` date DEFAULT NULL,
  `paymentReference` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','submitted','approved','paid','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `submittedBy` int DEFAULT NULL,
  `submittedAt` datetime DEFAULT NULL,
  `approvedBy` int DEFAULT NULL,
  `approvedAt` datetime DEFAULT NULL,
  `paidBy` int DEFAULT NULL,
  `paidAt` datetime DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `subcontract_payment_settlements_no_unique` (`settlementNo`),
  UNIQUE KEY `subcontract_payment_settlements_package_unique` (`packageId`),
  KEY `subcontract_payment_settlements_team_fk` (`subcontractTeamId`),
  KEY `subcontract_payment_settlements_project_status_index` (`projectId`,`status`),
  KEY `subcontract_payment_settlements_team_index` (`subcontractTeamId`),
  CONSTRAINT `subcontract_payment_settlements_package_fk` FOREIGN KEY (`packageId`) REFERENCES `subcontract_packages` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `subcontract_payment_settlements_team_fk` FOREIGN KEY (`subcontractTeamId`) REFERENCES `subcontract_teams` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `subcontract_teams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subcontract_teams` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `teamName` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `contactName` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contactPhoneEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `contactPhoneMasked` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','suspended','closed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `subcontract_teams_project_name_unique` (`projectId`,`teamName`),
  KEY `subcontract_teams_project_status_index` (`projectId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `suppliers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `organizationId` int DEFAULT NULL,
  `name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `unifiedSocialCreditCode` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contactName` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contactPhoneMasked` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `suppliers_organization_index` (`organizationId`),
  KEY `suppliers_name_index` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `system_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `module` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `system_permissions_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `system_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('system','business') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'business',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `isSystem` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `system_roles_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `system_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `settingKey` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `displayName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `valueJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `secretEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `valuePreview` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isSensitive` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('draft','published','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `version` int NOT NULL DEFAULT '1',
  `updatedBy` int DEFAULT NULL,
  `publishedAt` datetime DEFAULT NULL,
  `remarks` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `system_settings_key_unique` (`settingKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `tax_auxiliary_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tax_auxiliary_entries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `taxEntityId` bigint NOT NULL,
  `period` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `entryType` enum('vat_input','vat_output','subcontract_deduction','stamp_duty','payroll_handoff','cross_region_prepayment','book_tax_difference','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sourceType` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sourceId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subject` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `taxBaseAmount` decimal(16,2) DEFAULT NULL,
  `referenceTaxRate` decimal(7,4) DEFAULT NULL,
  `reportedTaxAmount` decimal(16,2) DEFAULT NULL,
  `documentReference` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `evidenceId` bigint DEFAULT NULL,
  `status` enum('pending','handed_off','receipt_recorded','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `notes` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `tax_auxiliary_entries_entity_fk` (`taxEntityId`),
  KEY `tax_auxiliary_entries_evidence_fk` (`evidenceId`),
  KEY `tax_auxiliary_entries_creator_fk` (`createdBy`),
  KEY `tax_auxiliary_entries_project_period_type_index` (`projectId`,`period`,`entryType`,`status`),
  KEY `tax_auxiliary_entries_source_index` (`sourceType`,`sourceId`),
  CONSTRAINT `tax_auxiliary_entries_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `tax_auxiliary_entries_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `tax_auxiliary_entries_evidence_fk` FOREIGN KEY (`evidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `tax_entity_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tax_entity_profiles` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `entityName` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `taxpayerIdentifier` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `taxMethod` enum('general','small_scale','simplified','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'general',
  `registeredLocation` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','suspended','archived') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tax_entity_profiles_identifier_unique` (`taxpayerIdentifier`),
  KEY `tax_entity_profiles_creator_fk` (`createdBy`),
  KEY `tax_entity_profiles_status_index` (`status`),
  CONSTRAINT `tax_entity_profiles_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `tax_handoff_batches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tax_handoff_batches` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `batchNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `taxEntityId` bigint NOT NULL,
  `period` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `handoffType` enum('vat_invoice','financial_ledger','payroll','contract_tax','cross_region','combined') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `format` enum('csv') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'csv',
  `recordCount` int NOT NULL DEFAULT '0',
  `snapshotHash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `snapshotJson` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `receiptReference` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `receiptEvidenceId` bigint DEFAULT NULL,
  `status` enum('generated','handed_off','receipt_recorded','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'generated',
  `generatedBy` int NOT NULL,
  `generatedAt` datetime NOT NULL,
  `receiptRecordedBy` int DEFAULT NULL,
  `receiptRecordedAt` datetime DEFAULT NULL,
  `notes` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tax_handoff_batches_no_unique` (`batchNo`),
  KEY `tax_handoff_batches_entity_fk` (`taxEntityId`),
  KEY `tax_handoff_batches_receipt_evidence_fk` (`receiptEvidenceId`),
  KEY `tax_handoff_batches_generator_fk` (`generatedBy`),
  KEY `tax_handoff_batches_receipt_recorder_fk` (`receiptRecordedBy`),
  KEY `tax_handoff_batches_project_period_index` (`projectId`,`period`,`handoffType`,`status`),
  CONSTRAINT `tax_handoff_batches_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `tax_handoff_batches_generator_fk` FOREIGN KEY (`generatedBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `tax_handoff_batches_receipt_evidence_fk` FOREIGN KEY (`receiptEvidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `tax_handoff_batches_receipt_recorder_fk` FOREIGN KEY (`receiptRecordedBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `temporary_daily_wage_settlements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `temporary_daily_wage_settlements` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `workerId` int NOT NULL,
  `projectId` int NOT NULL,
  `settlementDate` date NOT NULL,
  `payableAmount` decimal(16,2) NOT NULL,
  `deductionAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `actualAmount` decimal(16,2) NOT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','reviewing','approved','paid','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `submittedBy` int DEFAULT NULL,
  `submittedAt` datetime DEFAULT NULL,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` datetime DEFAULT NULL,
  `paidBy` int DEFAULT NULL,
  `paidAt` datetime DEFAULT NULL,
  `paymentReference` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `temporary_daily_wage_worker_date_unique` (`workerId`,`settlementDate`),
  KEY `temporary_daily_wage_project_date_index` (`projectId`,`settlementDate`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `transport_card_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transport_card_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tripId` bigint NOT NULL,
  `vehicleId` int NOT NULL,
  `projectId` int NOT NULL,
  `eventType` enum('load','unload') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `source` enum('card_reader','manual_review','offline_replay') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'card_reader',
  `idempotencyKey` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `deviceId` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cardFingerprint` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payloadFingerprint` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `occurredAt` datetime NOT NULL,
  `receivedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `validationStatus` enum('accepted','duplicate','rejected','needs_review') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'accepted',
  `validationReason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` datetime DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `siteId` int DEFAULT NULL,
  `operatorUserId` int DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transport_card_events_idempotency_unique` (`idempotencyKey`),
  KEY `transport_card_events_trip_type_index` (`tripId`,`eventType`),
  KEY `transport_card_events_vehicle_occurred_index` (`vehicleId`,`occurredAt`),
  KEY `transport_card_events_site_event_index` (`siteId`,`eventType`,`occurredAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `transport_reader_devices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transport_reader_devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `siteId` int NOT NULL,
  `deviceCode` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `displayName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','disabled','maintenance') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transport_reader_devices_project_code_unique` (`projectId`,`deviceCode`),
  KEY `transport_reader_devices_site_status_index` (`siteId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `transport_route_presets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transport_route_presets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `loadSiteId` int NOT NULL,
  `unloadSiteId` int NOT NULL,
  `freightRuleId` int NOT NULL,
  `presetDistanceKm` decimal(10,3) NOT NULL,
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `isDefault` tinyint(1) NOT NULL DEFAULT '0',
  `minimumTransitMinutes` int NOT NULL DEFAULT '10',
  `unloadGeofenceMeters` int NOT NULL DEFAULT '300',
  `minimumTransitEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `unloadGeofenceEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `unloadOnlyCloseEnabled` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `transport_route_presets_project_sites_unique` (`projectId`,`loadSiteId`,`unloadSiteId`),
  KEY `transport_route_presets_project_status_index` (`projectId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `transport_sites`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transport_sites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `siteType` enum('load','unload') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `administratorUserId` int DEFAULT NULL,
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `minimumTransitMinutes` int NOT NULL DEFAULT '10',
  `minimumTransitEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `unloadGeofenceMeters` int NOT NULL DEFAULT '300',
  `unloadGeofenceEnabled` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `transport_sites_project_type_name_unique` (`projectId`,`siteType`,`name`),
  KEY `transport_sites_project_type_status_index` (`projectId`,`siteType`,`status`),
  KEY `transport_sites_administrator_index` (`administratorUserId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `transport_trips`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transport_trips` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tripNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `vehicleId` int NOT NULL,
  `projectId` int NOT NULL,
  `freightRuleId` int NOT NULL,
  `startAt` datetime NOT NULL,
  `endAt` datetime DEFAULT NULL,
  `actualDistanceKm` decimal(10,3) DEFAULT NULL,
  `volumeCubicMeters` decimal(12,3) DEFAULT NULL,
  `weightTons` decimal(12,3) DEFAULT NULL,
  `calculatedUnitPrice` decimal(16,2) DEFAULT NULL,
  `calculatedAmount` decimal(16,2) DEFAULT NULL,
  `routeSnapshot` json DEFAULT NULL,
  `evidenceId` bigint DEFAULT NULL,
  `status` enum('draft','submitted','verified','settled','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `loadConfirmedAt` datetime DEFAULT NULL,
  `unloadConfirmedAt` datetime DEFAULT NULL,
  `loadEventId` bigint DEFAULT NULL,
  `unloadEventId` bigint DEFAULT NULL,
  `exceptionStatus` enum('none','open','resolved') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none',
  `fuelDeductionAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `netSettlementAmount` decimal(16,2) DEFAULT NULL,
  `fuelSettlementSnapshot` json DEFAULT NULL,
  `loadSiteId` int DEFAULT NULL,
  `unloadSiteId` int DEFAULT NULL,
  `loadConfirmedBy` int DEFAULT NULL,
  `unloadConfirmedBy` int DEFAULT NULL,
  `invoiceMode` enum('nfc_card','plate_photo') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'nfc_card',
  `nfcTransitKey` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activeVehicleTransitKey` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transport_trips_no_unique` (`tripNo`),
  UNIQUE KEY `transport_trips_project_active_vehicle_transit_unique` (`projectId`,`activeVehicleTransitKey`),
  KEY `transport_trips_vehicle_date_index` (`vehicleId`,`startAt`),
  KEY `transport_trips_project_load_site_index` (`projectId`,`loadSiteId`,`startAt`),
  KEY `transport_trips_project_unload_site_index` (`projectId`,`unloadSiteId`,`startAt`),
  KEY `transport_trips_nfc_transit_key_index` (`projectId`,`nfcTransitKey`),
  KEY `transport_trips_project_status_start_index` (`projectId`,`status`,`startAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `transport_vehicle_lease_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transport_vehicle_lease_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `vehicleId` int NOT NULL,
  `projectId` int NOT NULL,
  `billingType` enum('monthly','daily','hourly','shift') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `rate` decimal(16,2) NOT NULL,
  `effectiveFrom` date NOT NULL,
  `effectiveTo` date DEFAULT NULL,
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `transport_vehicle_lease_rules_vehicle_status_index` (`vehicleId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `transport_vehicle_rfid_cards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transport_vehicle_rfid_cards` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `vehicleId` int DEFAULT NULL,
  `writerDeviceId` int DEFAULT NULL,
  `cardUidFingerprint` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `cardUidMasked` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `driverPhoneEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `driverPhoneMasked` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payloadVersion` int NOT NULL DEFAULT '1',
  `status` enum('active','suspended','revoked') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `issuedAt` datetime DEFAULT NULL,
  `lastWrittenAt` datetime DEFAULT NULL,
  `revokedAt` datetime DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `managementCode` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transport_vehicle_rfid_cards_uid_unique` (`cardUidFingerprint`),
  UNIQUE KEY `transport_vehicle_rfid_cards_project_management_code_unique` (`projectId`,`managementCode`),
  KEY `transport_vehicle_rfid_cards_vehicle_status_index` (`vehicleId`,`status`),
  KEY `transport_vehicle_rfid_cards_project_status_index` (`projectId`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `transport_vehicle_settlement_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transport_vehicle_settlement_items` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `settlementId` bigint NOT NULL,
  `tripId` bigint NOT NULL,
  `tripNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tripDate` date NOT NULL,
  `volumeCubicMeters` decimal(14,3) NOT NULL DEFAULT '0.000',
  `grossFreightAmount` decimal(16,2) NOT NULL,
  `fuelDeductionAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `netPayableAmount` decimal(16,2) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transport_vehicle_settlement_items_trip_unique` (`tripId`),
  KEY `transport_vehicle_settlement_items_settlement_index` (`settlementId`),
  CONSTRAINT `transport_vehicle_settlement_items_settlement_fk` FOREIGN KEY (`settlementId`) REFERENCES `transport_vehicle_settlements` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `transport_vehicle_settlement_items_trip_fk` FOREIGN KEY (`tripId`) REFERENCES `transport_trips` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `transport_vehicle_settlements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transport_vehicle_settlements` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `settlementNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `projectId` int NOT NULL,
  `vehicleId` int NOT NULL,
  `periodStart` date NOT NULL,
  `periodEnd` date NOT NULL,
  `tripCount` int NOT NULL,
  `totalVolumeCubicMeters` decimal(14,3) NOT NULL DEFAULT '0.000',
  `grossFreightAmount` decimal(16,2) NOT NULL,
  `fuelDeductionAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `netPayableAmount` decimal(16,2) NOT NULL,
  `payeeName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `payeeAccount` varchar(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paymentMethod` enum('bank_transfer','corporate_account','cash','wechat','alipay','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'bank_transfer',
  `paymentDate` date DEFAULT NULL,
  `paymentReference` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remarks` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('draft','submitted','approved','paid','void') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `submittedBy` int DEFAULT NULL,
  `submittedAt` datetime DEFAULT NULL,
  `approvedBy` int DEFAULT NULL,
  `approvedAt` datetime DEFAULT NULL,
  `paidBy` int DEFAULT NULL,
  `paidAt` datetime DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transport_vehicle_settlements_no_unique` (`settlementNo`),
  KEY `transport_vehicle_settlements_project_vehicle_period_index` (`projectId`,`vehicleId`,`periodStart`,`periodEnd`),
  KEY `transport_vehicle_settlements_project_status_index` (`projectId`,`status`),
  KEY `transport_vehicle_settlements_vehicle_fk` (`vehicleId`),
  CONSTRAINT `transport_vehicle_settlements_vehicle_fk` FOREIGN KEY (`vehicleId`) REFERENCES `transport_vehicles` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `transport_vehicles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transport_vehicles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `plateNo` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `ownerName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `driverUserId` int DEFAULT NULL,
  `boxLengthMeters` decimal(8,3) NOT NULL,
  `boxWidthMeters` decimal(8,3) NOT NULL,
  `boxHeightMeters` decimal(8,3) NOT NULL,
  `loadFactor` decimal(5,3) NOT NULL DEFAULT '1.000',
  `payloadTons` decimal(10,3) DEFAULT NULL,
  `status` enum('active','suspended','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `organizationId` int DEFAULT NULL,
  `vehicleType` enum('dump_truck','tractor','mixer','flatbed','pickup','suv','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'dump_truck',
  `ownership` enum('owned','leased','trip_settlement') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'owned',
  `fuelTankCapacityLiters` decimal(10,2) DEFAULT NULL,
  `driverName` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `driverPhoneEncrypted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `driverPhoneMasked` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `transport_vehicles_plate_unique` (`plateNo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `user_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `permissionId` int NOT NULL,
  `grantedBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_permissions_unique` (`userId`,`permissionId`),
  KEY `user_permissions_user_index` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `user_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_profiles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `employeeNo` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phoneMasked` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `organizationId` int DEFAULT NULL,
  `positionId` int DEFAULT NULL,
  `status` enum('pending','active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_profiles_user_unique` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `user_role_assignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_role_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `roleId` int NOT NULL,
  `organizationId` int DEFAULT NULL,
  `projectId` int DEFAULT NULL,
  `validFrom` datetime DEFAULT NULL,
  `validTo` datetime DEFAULT NULL,
  `status` enum('active','revoked','expired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `grantedBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_role_assignments_user_index` (`userId`),
  KEY `user_role_assignments_role_index` (`roleId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
-- Source table declaration: `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `openId` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `email` varchar(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `loginMethod` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` enum('user','admin') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `lastSignedIn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `localUsername` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `localPasswordHash` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `localAccountStatus` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `localPasswordChangeRequired` tinyint(1) NOT NULL DEFAULT '0',
  `localLoginMode` enum('pc','mobile','both') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'both',
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_openId_unique` (`openId`),
  UNIQUE KEY `users_local_username_unique` (`localUsername`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

