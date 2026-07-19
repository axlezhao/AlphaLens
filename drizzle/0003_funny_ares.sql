CREATE TABLE `api_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`secret_hash` text NOT NULL,
	`scopes_json` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`expires_at` text,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_clients_secret_hash_uq` ON `api_clients` (`secret_hash`);--> statement-breakpoint
CREATE INDEX `api_clients_workspace_idx` ON `api_clients` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`artifact_version_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`reviewer_user_id` text,
	`required_role` text DEFAULT 'editor' NOT NULL,
	`status` text NOT NULL,
	`decision_note` text,
	`decided_by_user_id` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_version_id`) REFERENCES `research_artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `approval_requests_status_idx` ON `approval_requests` (`workspace_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `arbitration_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`workflow_run_id` text NOT NULL,
	`step_run_id` text,
	`rubric_version` text NOT NULL,
	`selected_candidate_id` text,
	`candidate_scores_json` text NOT NULL,
	`explanation_json` text NOT NULL,
	`dissent_json` text DEFAULT '[]' NOT NULL,
	`confidence` real NOT NULL,
	`as_of` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_run_id`) REFERENCES `workflow_step_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `arbitration_decisions_run_idx` ON `arbitration_decisions` (`workflow_run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `benchmark_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`suite_id` text NOT NULL,
	`name` text NOT NULL,
	`input_json` text NOT NULL,
	`expected_json` text NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`as_of` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suite_id`) REFERENCES `benchmark_suites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `benchmark_cases_suite_idx` ON `benchmark_cases` (`suite_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `benchmark_suites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`rubric_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `benchmark_suites_workspace_slug_uq` ON `benchmark_suites` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `evaluation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`suite_id` text NOT NULL,
	`workflow_version_id` text,
	`skill_version_id` text,
	`status` text NOT NULL,
	`scores_json` text,
	`explanations_json` text,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`passed_count` integer DEFAULT 0 NOT NULL,
	`model_version` text,
	`prompt_version` text,
	`as_of` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suite_id`) REFERENCES `benchmark_suites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_version_id`) REFERENCES `research_workflow_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skill_version_id`) REFERENCES `research_skill_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evaluation_runs_suite_idx` ON `evaluation_runs` (`suite_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `kpi_model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`logical_id` text NOT NULL,
	`version` integer NOT NULL,
	`kpi_model_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`semver` text NOT NULL,
	`metrics_json` text NOT NULL,
	`validation_rules_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`checksum` text NOT NULL,
	`supersedes_id` text,
	`published_at` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`kpi_model_id`) REFERENCES `kpi_models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kpi_model_versions_logical_uq` ON `kpi_model_versions` (`logical_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `kpi_model_versions_semver_uq` ON `kpi_model_versions` (`kpi_model_id`,`semver`);--> statement-breakpoint
CREATE TABLE `kpi_models` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`sector` text NOT NULL,
	`industry` text,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kpi_models_workspace_slug_uq` ON `kpi_models` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `kpi_models_sector_idx` ON `kpi_models` (`workspace_id`,`sector`);--> statement-breakpoint
CREATE TABLE `provider_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`category` text NOT NULL,
	`provider` text NOT NULL,
	`capability` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`license_scope` text NOT NULL,
	`allowed_use` text NOT NULL,
	`max_latency_ms` integer,
	`max_cost_usd` real,
	`freshness_seconds` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_routes_workspace_capability_uq` ON `provider_routes` (`workspace_id`,`capability`,`provider`);--> statement-breakpoint
CREATE INDEX `provider_routes_category_idx` ON `provider_routes` (`workspace_id`,`category`,`priority`);--> statement-breakpoint
CREATE TABLE `research_artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_json` text NOT NULL,
	`source_snapshot_json` text DEFAULT '{}' NOT NULL,
	`checksum` text NOT NULL,
	`status` text NOT NULL,
	`as_of` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`supersedes_id` text,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `research_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_artifact_versions_uq` ON `research_artifact_versions` (`artifact_id`,`version`);--> statement-breakpoint
CREATE INDEX `research_artifact_versions_status_idx` ON `research_artifact_versions` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `research_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`workflow_run_id` text,
	`security_id` text,
	`logical_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`title` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_artifacts_workspace_logical_uq` ON `research_artifacts` (`workspace_id`,`logical_id`);--> statement-breakpoint
CREATE INDEX `research_artifacts_run_idx` ON `research_artifacts` (`workflow_run_id`);--> statement-breakpoint
CREATE TABLE `research_skill_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`logical_id` text NOT NULL,
	`version` integer NOT NULL,
	`skill_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`semver` text NOT NULL,
	`manifest_json` text NOT NULL,
	`instructions` text NOT NULL,
	`input_schema_json` text DEFAULT '{}' NOT NULL,
	`output_schema_json` text DEFAULT '{}' NOT NULL,
	`permissions_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`checksum` text NOT NULL,
	`supersedes_id` text,
	`published_at` text,
	`validation_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `research_skills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_skill_versions_logical_uq` ON `research_skill_versions` (`logical_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `research_skill_versions_semver_uq` ON `research_skill_versions` (`skill_id`,`semver`);--> statement-breakpoint
CREATE TABLE `research_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`publisher_user_id` text NOT NULL,
	`visibility` text DEFAULT 'workspace' NOT NULL,
	`category` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`publisher_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_skills_workspace_slug_uq` ON `research_skills` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `research_skills_marketplace_idx` ON `research_skills` (`visibility`,`category`,`updated_at`);--> statement-breakpoint
CREATE TABLE `research_workflow_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`logical_id` text NOT NULL,
	`version` integer NOT NULL,
	`workflow_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`semver` text NOT NULL,
	`definition_json` text NOT NULL,
	`input_schema_json` text DEFAULT '{}' NOT NULL,
	`output_schema_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`checksum` text NOT NULL,
	`supersedes_id` text,
	`published_at` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `research_workflows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_workflow_versions_logical_uq` ON `research_workflow_versions` (`logical_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `research_workflow_versions_semver_uq` ON `research_workflow_versions` (`workflow_id`,`semver`);--> statement-breakpoint
CREATE INDEX `research_workflow_versions_workflow_idx` ON `research_workflow_versions` (`workflow_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `research_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`owner_user_id` text NOT NULL,
	`visibility` text DEFAULT 'workspace' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_workflows_workspace_slug_uq` ON `research_workflows` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `research_workflows_workspace_idx` ON `research_workflows` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `skill_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`skill_version_id` text NOT NULL,
	`installed_by_user_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`granted_permissions_json` text DEFAULT '{}' NOT NULL,
	`installed_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_version_id`) REFERENCES `research_skill_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`installed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_installations_workspace_skill_uq` ON `skill_installations` (`workspace_id`,`skill_version_id`);--> statement-breakpoint
CREATE INDEX `skill_installations_workspace_idx` ON `skill_installations` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `team_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`artifact_version_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`parent_id` text,
	`anchor_json` text DEFAULT '{}' NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by_user_id` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_version_id`) REFERENCES `research_artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `team_comments_artifact_idx` ON `team_comments` (`artifact_version_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`response_status` integer,
	`response_body` text,
	`delivered_at` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `webhook_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_deliveries_event_uq` ON `webhook_deliveries` (`subscription_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_queue_idx` ON `webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `webhook_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`endpoint_url` text NOT NULL,
	`event_types_json` text NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`secret_iv` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_delivery_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_subscriptions_workspace_idx` ON `webhook_subscriptions` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`workflow_version_id` text NOT NULL,
	`security_id` text,
	`requested_by_user_id` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`context_json` text DEFAULT '{}' NOT NULL,
	`as_of` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`trace_id` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_version_id`) REFERENCES `research_workflow_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_runs_idempotency_uq` ON `workflow_runs` (`workspace_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `workflow_runs_status_idx` ON `workflow_runs` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `workflow_step_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`workflow_run_id` text NOT NULL,
	`node_key` text NOT NULL,
	`node_type` text NOT NULL,
	`agent_role` text,
	`objective` text,
	`depends_on_json` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`research_job_id` text,
	`output_json` text,
	`evidence_ids_json` text DEFAULT '[]' NOT NULL,
	`score_json` text,
	`model_version` text,
	`prompt_version` text,
	`started_at` text,
	`completed_at` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`research_job_id`) REFERENCES `research_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_step_runs_node_uq` ON `workflow_step_runs` (`workflow_run_id`,`node_key`);--> statement-breakpoint
CREATE INDEX `workflow_step_runs_status_idx` ON `workflow_step_runs` (`workflow_run_id`,`status`);