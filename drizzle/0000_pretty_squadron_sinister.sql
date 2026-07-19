CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`actor_user_id` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`request_id` text NOT NULL,
	`ip_hash` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_workspace_created_idx` ON `audit_logs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `catalysts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`security_id` text NOT NULL,
	`source_id` text,
	`title` text NOT NULL,
	`event_type` text NOT NULL,
	`event_at` text,
	`date_status` text NOT NULL,
	`status` text NOT NULL,
	`as_of` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `catalysts_security_event_idx` ON `catalysts` (`security_id`,`event_at`);--> statement-breakpoint
CREATE TABLE `deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` text NOT NULL,
	`completed_at` text,
	`reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`logical_id` text NOT NULL,
	`version` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`security_id` text NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`claim` text NOT NULL,
	`excerpt` text,
	`value_json` text,
	`observed_at` text NOT NULL,
	`as_of` text NOT NULL,
	`confidence` real NOT NULL,
	`supersedes_id` text,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_logical_version_uq` ON `evidence` (`logical_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_workspace_hash_uq` ON `evidence` (`workspace_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `evidence_security_asof_idx` ON `evidence` (`security_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`research_job_id` text NOT NULL,
	`trace_id` text NOT NULL,
	`model_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`provider` text NOT NULL,
	`request_hash` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`status` text NOT NULL,
	`error_code` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`research_job_id`) REFERENCES `research_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`base_currency` text DEFAULT 'USD' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `portfolios_workspace_idx` ON `portfolios` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `provider_state` (
	`provider` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`circuit_opened_at` text,
	`last_success_at` text,
	`last_failure_at` text,
	`last_error` text,
	`latency_ms` integer,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `research_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_job_events_seq_uq` ON `research_job_events` (`job_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `research_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`security_id` text NOT NULL,
	`question` text NOT NULL,
	`status` text NOT NULL,
	`as_of` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`trace_id` text NOT NULL,
	`model_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`snapshot_json` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`next_run_at` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`timeout_at` text NOT NULL,
	`cancel_requested_at` text,
	`started_at` text,
	`completed_at` text,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_jobs_idempotency_uq` ON `research_jobs` (`workspace_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `research_jobs_queue_idx` ON `research_jobs` (`status`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`research_job_id` text,
	`reviewer_user_id` text NOT NULL,
	`verdict` text NOT NULL,
	`confidence_bucket` text,
	`score` real,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`research_job_id`) REFERENCES `research_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `securities` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`ticker` text NOT NULL,
	`exchange` text DEFAULT 'US' NOT NULL,
	`cik` text,
	`issuer_name` text,
	`ir_base_url` text,
	`ir_feed_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_workspace_ticker_uq` ON `securities` (`workspace_id`,`ticker`,`exchange`);--> statement-breakpoint
CREATE TABLE `source_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`body_json` text NOT NULL,
	`content_type` text NOT NULL,
	`fetched_at` text NOT NULL,
	`fresh_until` text NOT NULL,
	`stale_until` text NOT NULL,
	`etag` text,
	`last_modified` text
);
--> statement-breakpoint
CREATE INDEX `source_cache_provider_idx` ON `source_cache` (`provider`,`fresh_until`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`source_type` text NOT NULL,
	`title` text NOT NULL,
	`canonical_url` text NOT NULL,
	`publisher` text NOT NULL,
	`published_at` text,
	`accessed_at` text NOT NULL,
	`as_of` text NOT NULL,
	`stale_at` text NOT NULL,
	`is_stale` integer DEFAULT false NOT NULL,
	`license_scope` text NOT NULL,
	`content_hash` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_workspace_hash_uq` ON `sources` (`workspace_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `sources_freshness_idx` ON `sources` (`provider`,`stale_at`);--> statement-breakpoint
CREATE TABLE `theses` (
	`id` text PRIMARY KEY NOT NULL,
	`logical_id` text NOT NULL,
	`version` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`security_id` text NOT NULL,
	`statement` text NOT NULL,
	`status` text NOT NULL,
	`conviction` real NOT NULL,
	`falsifiers_json` text DEFAULT '[]' NOT NULL,
	`supersedes_id` text,
	`as_of` text NOT NULL,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `theses_logical_version_uq` ON `theses` (`logical_id`,`version`);--> statement-breakpoint
CREATE INDEX `theses_security_idx` ON `theses` (`security_id`);--> statement-breakpoint
CREATE TABLE `thesis_evidence` (
	`thesis_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`relationship` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`thesis_id`, `evidence_id`),
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`deletion_requested_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_members_user_idx` ON `workspace_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
