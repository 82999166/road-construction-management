CREATE TABLE `business_document_number_allocations` (
	`requestHash` varchar(64) NOT NULL,
	`moduleCode` varchar(2) NOT NULL,
	`actorKey` varchar(16) NOT NULL,
	`scopeHash` varchar(64) NOT NULL,
	`number` varchar(36),
	`prefix` varchar(32),
	`sequence` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `business_document_number_allocations_requestHash` PRIMARY KEY(`requestHash`),
	CONSTRAINT `business_document_number_unique` UNIQUE(`number`),
	CONSTRAINT `business_document_prefix_sequence_unique` UNIQUE(`prefix`,`sequence`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `business_document_number_counters` (
	`prefix` varchar(32) NOT NULL,
	`lastSequence` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `business_document_number_counters_prefix` PRIMARY KEY(`prefix`)
) ENGINE=InnoDB;
