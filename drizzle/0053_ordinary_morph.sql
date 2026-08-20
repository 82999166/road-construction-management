ALTER TABLE `rfid_card_write_jobs` ADD `payloadEncrypted` text;--> statement-breakpoint
ALTER TABLE `rfid_card_write_jobs` ADD `executionMode` varchar(32) DEFAULT 'manual_confirmation' NOT NULL;--> statement-breakpoint
ALTER TABLE `rfid_card_write_jobs` ADD `bridgeTokenHash` varchar(64);--> statement-breakpoint
ALTER TABLE `rfid_card_write_jobs` ADD `bridgeTokenExpiresAt` datetime;