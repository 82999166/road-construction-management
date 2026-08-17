ALTER TABLE `machines` ADD `driverName` varchar(128);--> statement-breakpoint
ALTER TABLE `machines` ADD `driverPhoneEncrypted` text;--> statement-breakpoint
ALTER TABLE `machines` ADD `driverPhoneMasked` varchar(32);