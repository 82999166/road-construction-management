CREATE TABLE `login_rate_limit_states` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope` varchar(64) NOT NULL,
	`subjectHash` varchar(128) NOT NULL,
	`failureCount` int NOT NULL DEFAULT 0,
	`windowStartedAt` datetime NOT NULL,
	`lastFailureAt` datetime NOT NULL,
	`lockedUntil` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `login_rate_limit_states_id` PRIMARY KEY(`id`),
	CONSTRAINT `login_rate_limit_scope_subject_unique` UNIQUE(`scope`,`subjectHash`)
);
--> statement-breakpoint
CREATE INDEX `login_rate_limit_locked_until_index` ON `login_rate_limit_states` (`lockedUntil`);