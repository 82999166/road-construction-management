ALTER TABLE `personnel_people` ADD `salaryPayerType` varchar(24);--> statement-breakpoint
ALTER TABLE `personnel_people` ADD `salaryPayerName` varchar(128);--> statement-breakpoint
ALTER TABLE `personnel_salary_history` ADD `salaryPayerType` varchar(24);--> statement-breakpoint
ALTER TABLE `personnel_salary_history` ADD `salaryPayerName` varchar(128);