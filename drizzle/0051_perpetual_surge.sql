ALTER TABLE `purchase_orders` ADD `hasInvoice` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD `invoiceEvidenceId` bigint;