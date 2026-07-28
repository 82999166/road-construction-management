ALTER TABLE `users` ADD `localUsername` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `localPasswordHash` varchar(256);--> statement-breakpoint
ALTER TABLE `users` ADD `localAccountStatus` enum('active','disabled') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `localPasswordChangeRequired` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_local_username_unique` UNIQUE(`localUsername`);