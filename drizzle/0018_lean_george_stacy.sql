CREATE TABLE `official_account_binding_requests` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenFingerprint` varchar(64) NOT NULL,
	`expiresAt` datetime NOT NULL,
	`consumedAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `official_account_binding_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `official_account_binding_requests_token_unique` UNIQUE(`tokenFingerprint`)
);
--> statement-breakpoint
CREATE INDEX `official_account_binding_requests_user_index` ON `official_account_binding_requests` (`userId`);