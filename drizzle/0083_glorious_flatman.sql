ALTER TABLE `labor_workers` ADD `phoneFingerprint` varchar(64);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `phoneEncrypted` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `phoneFingerprint` varchar(64);--> statement-breakpoint
ALTER TABLE `labor_workers` ADD CONSTRAINT `labor_workers_phone_fingerprint_unique` UNIQUE(`phoneFingerprint`);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_phone_fingerprint_unique` UNIQUE(`phoneFingerprint`);