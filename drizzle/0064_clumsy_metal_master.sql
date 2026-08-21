-- 审计整改：全局发票原件 + 项目分摊。
-- 历史项目内票据先回填原件指纹；若同一原件历史累计分摊超过原件金额，则仅标为 legacy_review，绝不静默删除或篡改会计资料。

CREATE TABLE `financial_invoice_originals` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `originalFingerprint` varchar(128) NOT NULL,
  `invoiceNo` varchar(64) NOT NULL,
  `invoiceCode` varchar(64),
  `counterpartyName` varchar(200) NOT NULL,
  `invoiceType` enum('vat_special','vat_normal','electronic','receipt','other') NOT NULL,
  `direction` enum('income','expense') NOT NULL,
  `totalAmount` decimal(16,2) NOT NULL,
  `totalTaxAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  `taxRate` decimal(7,4) NOT NULL DEFAULT '0.0000',
  `issuedAt` date NOT NULL,
  `evidenceId` bigint,
  `structuredPayloadJson` text,
  `verificationStatus` enum('pending','manual_verified','external_verified','failed','not_required') NOT NULL DEFAULT 'pending',
  `verificationReference` varchar(200),
  `verificationCheckedAt` datetime,
  `redFlushOriginalId` bigint,
  `redFlushReason` varchar(500),
  `status` enum('issued','verified','void','red_flushed') NOT NULL DEFAULT 'issued',
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `financial_invoice_originals_id` PRIMARY KEY (`id`),
  CONSTRAINT `financial_invoice_originals_fingerprint_unique` UNIQUE (`originalFingerprint`),
  CONSTRAINT `financial_invoice_originals_evidence_fk` FOREIGN KEY (`evidenceId`) REFERENCES `evidence_records` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `financial_invoice_originals_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `financial_invoice_originals_red_flush_fk` FOREIGN KEY (`redFlushOriginalId`) REFERENCES `financial_invoice_originals` (`id`) ON DELETE RESTRICT
);
CREATE INDEX `financial_invoice_originals_status_date_index` ON `financial_invoice_originals` (`status`,`issuedAt`);
CREATE INDEX `financial_invoice_originals_evidence_index` ON `financial_invoice_originals` (`evidenceId`);
CREATE INDEX `financial_invoice_originals_red_flush_index` ON `financial_invoice_originals` (`redFlushOriginalId`);

ALTER TABLE `financial_invoices`
  ADD COLUMN `originalId` bigint NULL,
  ADD COLUMN `allocatedAmount` decimal(16,2) NOT NULL DEFAULT '0.00',
  ADD COLUMN `allocationPurpose` enum('expense_deduction','reimbursement','income_collection','reference_only') NOT NULL DEFAULT 'expense_deduction',
  ADD COLUMN `allocationStatus` enum('active','void','red_flushed','legacy_review') NOT NULL DEFAULT 'active';

INSERT INTO `financial_invoice_originals` (
  `originalFingerprint`, `invoiceNo`, `invoiceCode`, `counterpartyName`, `invoiceType`, `direction`,
  `totalAmount`, `totalTaxAmount`, `taxRate`, `issuedAt`, `evidenceId`, `status`, `createdBy`
)
SELECT
  SHA2(CONCAT_WS('|', COALESCE(`invoiceCode`, ''), `invoiceNo`, `counterpartyName`, `direction`, DATE_FORMAT(`issuedAt`, '%Y-%m-%d'), CAST(`amount` AS CHAR), CAST(`taxAmount` AS CHAR)), 256),
  MIN(`invoiceNo`), MAX(`invoiceCode`), MIN(`counterpartyName`), MIN(`invoiceType`), MIN(`direction`),
  MAX(`amount`), MAX(`taxAmount`), MAX(`taxRate`), MIN(`issuedAt`), MIN(`evidenceId`), MIN(`status`), MIN(`createdBy`)
FROM `financial_invoices`
GROUP BY SHA2(CONCAT_WS('|', COALESCE(`invoiceCode`, ''), `invoiceNo`, `counterpartyName`, `direction`, DATE_FORMAT(`issuedAt`, '%Y-%m-%d'), CAST(`amount` AS CHAR), CAST(`taxAmount` AS CHAR)), 256);

UPDATE `financial_invoices` fi
JOIN `financial_invoice_originals` fio ON fio.`originalFingerprint` = SHA2(CONCAT_WS('|', COALESCE(fi.`invoiceCode`, ''), fi.`invoiceNo`, fi.`counterpartyName`, fi.`direction`, DATE_FORMAT(fi.`issuedAt`, '%Y-%m-%d'), CAST(fi.`amount` AS CHAR), CAST(fi.`taxAmount` AS CHAR)), 256)
SET fi.`originalId` = fio.`id`, fi.`allocatedAmount` = fi.`amount`,
    fi.`allocationStatus` = CASE WHEN fi.`status` = 'void' THEN 'void' WHEN fi.`status` = 'red_flushed' THEN 'red_flushed' ELSE 'active' END;

UPDATE `financial_invoices` fi
JOIN (
  SELECT allocation.`originalId`
  FROM `financial_invoices` allocation
  INNER JOIN `financial_invoice_originals` original ON original.`id` = allocation.`originalId`
  WHERE allocation.`allocationStatus` = 'active'
  GROUP BY allocation.`originalId`, original.`totalAmount`
  HAVING SUM(allocation.`allocatedAmount`) > original.`totalAmount`
) duplicated ON duplicated.`originalId` = fi.`originalId`
SET fi.`allocationStatus` = 'legacy_review'
WHERE fi.`allocationStatus` = 'active';

ALTER TABLE `financial_invoices`
  ADD CONSTRAINT `financial_invoices_original_fk` FOREIGN KEY (`originalId`) REFERENCES `financial_invoice_originals` (`id`) ON DELETE RESTRICT;
CREATE INDEX `financial_invoices_original_index` ON `financial_invoices` (`originalId`,`allocationStatus`);
