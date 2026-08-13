ALTER TABLE `official_account_broadcast_deliveries` ADD `recipientNameSnapshot` varchar(128);--> statement-breakpoint
ALTER TABLE `official_account_broadcast_deliveries` ADD `recipientNameSnapshot` varchar(128);--> statement-breakpoint
ALTER TABLE `official_account_broadcast_deliveries` ADD `recipientRoleSnapshot` varchar(300);--> statement-breakpoint
ALTER TABLE `official_account_broadcast_deliveries` ADD `recipientScopeSnapshot` varchar(500);--> statement-breakpoint
ALTER TABLE `official_account_broadcast_deliveries` ADD `acknowledgementStatus` enum('not_required','pending','acknowledged') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `official_account_broadcast_deliveries` ADD `acknowledgedAt` datetime;--> statement-breakpoint
ALTER TABLE `official_account_broadcasts` ADD `requiresAcknowledgement` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `official_account_broadcasts` ADD `acknowledgedCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `official_account_broadcast_deliveries_acknowledgement_index` ON `official_account_broadcast_deliveries` (`broadcastId`,`acknowledgementStatus`);
