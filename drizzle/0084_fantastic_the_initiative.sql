ALTER TABLE `inventory_transactions` ADD `evidenceId` bigint;--> statement-breakpoint
CREATE INDEX `inventory_transactions_evidence_index` ON `inventory_transactions` (`evidenceId`);