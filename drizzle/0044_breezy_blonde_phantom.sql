ALTER TABLE `transport_vehicles` ADD `driverName` varchar(128);--> statement-breakpoint
ALTER TABLE `transport_vehicles` ADD `driverPhoneEncrypted` text;--> statement-breakpoint
ALTER TABLE `transport_vehicles` ADD `driverPhoneMasked` varchar(32);