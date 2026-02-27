CREATE TABLE `chat_messages` (
    `id` varchar(36) NOT NULL,
    `session_id` varchar(36) NOT NULL,
    `user_id` int UNSIGNED NOT NULL,
    `seq` int NOT NULL,
    `role` varchar(16) NOT NULL,
    `content` json NOT NULL,
    `created_at` datetime NOT NULL,
    `request_id` varchar(64) NOT NULL,
    CONSTRAINT `chat_messages_id` PRIMARY KEY (`id`),
    CONSTRAINT `uq_messages_session_seq` UNIQUE (`session_id`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `chat_session_summaries` (
    `id` varchar(36) NOT NULL,
    `session_id` varchar(36) NOT NULL,
    `user_id` int UNSIGNED NOT NULL,
    `covered_to_seq` int NOT NULL,
    `summary_message` json NOT NULL,
    `created_at` datetime NOT NULL,
    CONSTRAINT `chat_session_summaries_id` PRIMARY KEY (`id`),
    CONSTRAINT `uq_summary_session_covered` UNIQUE (
        `session_id`,
        `covered_to_seq`
    )
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
    `id` varchar(36) NOT NULL,
    `user_id` int UNSIGNED NOT NULL,
    `title` varchar(255),
    `created_at` datetime NOT NULL,
    `updated_at` datetime NOT NULL,
    `next_seq` int NOT NULL DEFAULT 0,
    `meta` json,
    `lock_token` varchar(64),
    `lock_until` datetime,
    `summary_seq` int NOT NULL DEFAULT -1,
    CONSTRAINT `chat_sessions_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_messages_session_request` ON `chat_messages` (`session_id`, `request_id`);
--> statement-breakpoint
CREATE INDEX `idx_messages_session_user` ON `chat_messages` (`session_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_updated` ON `chat_sessions` (`user_id`, `updated_at`);