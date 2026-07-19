CREATE TABLE `catalyst_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`security_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`refresh_interval_minutes` integer DEFAULT 360 NOT NULL,
	`last_refresh_at` text,
	`next_refresh_at` text NOT NULL,
	`last_status` text DEFAULT 'never' NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalyst_subscriptions_workspace_security_uq` ON `catalyst_subscriptions` (`workspace_id`,`security_id`);--> statement-breakpoint
CREATE INDEX `catalyst_subscriptions_due_idx` ON `catalyst_subscriptions` (`enabled`,`next_refresh_at`);--> statement-breakpoint
CREATE TABLE `earnings_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`security_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`workflow_type` text NOT NULL,
	`fiscal_period` text NOT NULL,
	`event_at` text,
	`status` text NOT NULL,
	`research_job_id` text,
	`expectations_json` text DEFAULT '{}' NOT NULL,
	`output_json` text,
	`as_of` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`research_job_id`) REFERENCES `research_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `earnings_workflows_idempotency_uq` ON `earnings_workflows` (`workspace_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `earnings_workflows_security_idx` ON `earnings_workflows` (`security_id`,`event_at`);--> statement-breakpoint
CREATE TABLE `investment_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`security_id` text NOT NULL,
	`template_id` text,
	`thesis_logical_id` text,
	`review_type` text NOT NULL,
	`decision` text NOT NULL,
	`confidence` real NOT NULL,
	`expected_outcome` text,
	`actual_outcome` text,
	`outcome_score` real,
	`biases_json` text DEFAULT '[]' NOT NULL,
	`lessons` text,
	`next_action` text,
	`as_of` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `review_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `investment_reviews_workspace_user_idx` ON `investment_reviews` (`workspace_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_type` text NOT NULL,
	`label` text NOT NULL,
	`destination_hint` text NOT NULL,
	`secret_ciphertext` text,
	`secret_iv` text,
	`enabled` integer DEFAULT true NOT NULL,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_channels_workspace_idx` ON `notification_channels` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`event_key` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`provider_message_id` text,
	`delivered_at` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_outbox_event_uq` ON `notification_outbox` (`channel_id`,`event_key`);--> statement-breakpoint
CREATE INDEX `notification_outbox_queue_idx` ON `notification_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `notification_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`security_id` text,
	`event_types_json` text DEFAULT '[]' NOT NULL,
	`lead_minutes` integer DEFAULT 1440 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_rules_workspace_idx` ON `notification_rules` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `peer_group_members` (
	`peer_group_id` text NOT NULL,
	`security_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`metrics_as_of` text,
	`source_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`peer_group_id`, `security_id`),
	FOREIGN KEY (`peer_group_id`) REFERENCES `peer_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `peer_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`anchor_security_id` text NOT NULL,
	`name` text NOT NULL,
	`metric_keys_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`anchor_security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `peer_groups_anchor_idx` ON `peer_groups` (`workspace_id`,`anchor_security_id`);--> statement-breakpoint
CREATE TABLE `review_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`schema_json` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_templates_workspace_idx` ON `review_templates` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `thesis_falsifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`logical_id` text NOT NULL,
	`version` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`thesis_logical_id` text NOT NULL,
	`label` text NOT NULL,
	`metric` text,
	`operator` text DEFAULT 'manual' NOT NULL,
	`threshold` real,
	`unit` text,
	`evaluation_window` text,
	`status` text DEFAULT 'untriggered' NOT NULL,
	`current_value` real,
	`note` text,
	`supersedes_id` text,
	`as_of` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thesis_falsifiers_logical_version_uq` ON `thesis_falsifiers` (`logical_id`,`version`);--> statement-breakpoint
CREATE INDEX `thesis_falsifiers_thesis_idx` ON `thesis_falsifiers` (`workspace_id`,`thesis_logical_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `watchlist_items` (
	`watchlist_id` text NOT NULL,
	`security_id` text NOT NULL,
	`added_by_user_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`added_at` text NOT NULL,
	PRIMARY KEY(`watchlist_id`, `security_id`),
	FOREIGN KEY (`watchlist_id`) REFERENCES `watchlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `watchlist_items_security_idx` ON `watchlist_items` (`security_id`);--> statement-breakpoint
CREATE TABLE `watchlists` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `watchlists_workspace_idx` ON `watchlists` (`workspace_id`,`updated_at`);