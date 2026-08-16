ALTER TABLE `attendance_check_ins` ADD `checkedOutAt` datetime;--> statement-breakpoint
ALTER TABLE `attendance_check_ins` ADD `checkoutLongitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `attendance_check_ins` ADD `checkoutLatitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `attendance_check_ins` ADD `checkoutLocationAccuracyMeters` decimal(10,2);--> statement-breakpoint
ALTER TABLE `attendance_check_ins` ADD `checkoutStatus` enum('normal','location_missing');
ALTER TABLE `attendance_check_ins` ADD `checkoutStatus` enum('normal','location_missing');
