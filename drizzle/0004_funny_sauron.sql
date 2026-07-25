ALTER TABLE `labor_workers` ADD `identityVerificationStatus` enum('pending','verified','rejected') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `labor_workers` ADD `identityVerificationNote` varchar(500);--> statement-breakpoint
ALTER TABLE `labor_workers` ADD `identityVerifiedAt` datetime;--> statement-breakpoint
ALTER TABLE `labor_workers` ADD `identityVerifiedBy` int;