-- 审计整改：财税辅助台账与正式财务/电子税务局资料交接。
-- 本迁移只建立真实业务资料的归集、快照与回执引用能力；绝不在系统内虚构税额、申报状态或税务机关回执。

CREATE TABLE `tax_entity_profiles` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `entityName` varchar(200) NOT NULL,
  `taxpayerIdentifier` varchar(64) NOT NULL,
  `taxMethod` enum('general','small_scale','simplified','other') NOT NULL DEFAULT 'general',
  `registeredLocation` varchar(300),
  `status` enum('active','suspended','archived') NOT NULL DEFAULT 'active',
  `remarks` varchar(500),
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tax_entity_profiles_id` PRIMARY KEY (`id`),
  CONSTRAINT `tax_entity_profiles_identifier_unique` UNIQUE (`taxpayerIdentifier`),
  CONSTRAINT `tax_entity_profiles_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
CREATE INDEX `tax_entity_profiles_status_index` ON `tax_entity_profiles` (`status`);

CREATE TABLE `project_tax_profiles` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `taxEntityId` bigint NOT NULL,
  `projectLocation` varchar(300) NOT NULL,
  `taxMethod` enum('general','small_scale','simplified','other') NOT NULL DEFAULT 'general',
  `contractExTaxAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `contractTaxRate` decimal(7,4) NOT NULL DEFAULT '0.0000',
  `crossRegionConstruction` boolean NOT NULL DEFAULT FALSE,
  `subcontractDeductionMethod` enum('not_applicable','supporting_document','other') NOT NULL DEFAULT 'not_applicable',
  `remarks` varchar(500),
  `status` enum('active','archived') NOT NULL DEFAULT 'active',
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `project_tax_profiles_id` PRIMARY KEY (`id`),
  CONSTRAINT `project_tax_profiles_project_unique` UNIQUE (`projectId`),
  CONSTRAINT `project_tax_profiles_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `project_tax_profiles_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
CREATE INDEX `project_tax_profiles_entity_index` ON `project_tax_profiles` (`taxEntityId`,`status`);

CREATE TABLE `tax_auxiliary_entries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `projectId` int NOT NULL,
  `taxEntityId` bigint NOT NULL,
  `period` varchar(7) NOT NULL,
  `entryType` enum('vat_input','vat_output','subcontract_deduction','stamp_duty','payroll_handoff','cross_region_prepayment','book_tax_difference','other') NOT NULL,
  `sourceType` varchar(64),
  `sourceId` varchar(128),
  `subject` varchar(300) NOT NULL,
  `amount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `taxBaseAmount` decimal(16,2),
  `referenceTaxRate` decimal(7,4),
  `reportedTaxAmount` decimal(16,2),
  `documentReference` varchar(200),
  `evidenceId` bigint,
  `status` enum('pending','handed_off','receipt_recorded','void') NOT NULL DEFAULT 'pending',
  `notes` varchar(1000),
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tax_auxiliary_entries_id` PRIMARY KEY (`id`),
  CONSTRAINT `tax_auxiliary_entries_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `tax_auxiliary_entries_evidence_fk` FOREIGN KEY (`evidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `tax_auxiliary_entries_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
CREATE INDEX `tax_auxiliary_entries_project_period_type_index` ON `tax_auxiliary_entries` (`projectId`,`period`,`entryType`,`status`);
CREATE INDEX `tax_auxiliary_entries_source_index` ON `tax_auxiliary_entries` (`sourceType`,`sourceId`);

CREATE TABLE `tax_handoff_batches` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `batchNo` varchar(64) NOT NULL,
  `projectId` int NOT NULL,
  `taxEntityId` bigint NOT NULL,
  `period` varchar(7) NOT NULL,
  `handoffType` enum('vat_invoice','financial_ledger','payroll','contract_tax','cross_region','combined') NOT NULL,
  `format` enum('csv') NOT NULL DEFAULT 'csv',
  `recordCount` int NOT NULL DEFAULT 0,
  `snapshotHash` varchar(64) NOT NULL,
  `snapshotJson` text NOT NULL,
  `receiptReference` varchar(200),
  `receiptEvidenceId` bigint,
  `status` enum('generated','handed_off','receipt_recorded','void') NOT NULL DEFAULT 'generated',
  `generatedBy` int NOT NULL,
  `generatedAt` datetime NOT NULL,
  `receiptRecordedBy` int,
  `receiptRecordedAt` datetime,
  `notes` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tax_handoff_batches_id` PRIMARY KEY (`id`),
  CONSTRAINT `tax_handoff_batches_no_unique` UNIQUE (`batchNo`),
  CONSTRAINT `tax_handoff_batches_entity_fk` FOREIGN KEY (`taxEntityId`) REFERENCES `tax_entity_profiles` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `tax_handoff_batches_receipt_evidence_fk` FOREIGN KEY (`receiptEvidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `tax_handoff_batches_generator_fk` FOREIGN KEY (`generatedBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `tax_handoff_batches_receipt_recorder_fk` FOREIGN KEY (`receiptRecordedBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT
);
CREATE INDEX `tax_handoff_batches_project_period_index` ON `tax_handoff_batches` (`projectId`,`period`,`handoffType`,`status`);
