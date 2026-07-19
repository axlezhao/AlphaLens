CREATE TABLE `portfolio_action_conditions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`security_id` text,
	`condition_type` text NOT NULL,
	`trigger_kind` text NOT NULL,
	`severity` text NOT NULL,
	`predicate_json` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`idempotency_key` text NOT NULL,
	`triggered_at` text,
	`acknowledged_at` text,
	`as_of` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_action_conditions_idempotency_uq` ON `portfolio_action_conditions` (`portfolio_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `portfolio_action_conditions_status_idx` ON `portfolio_action_conditions` (`portfolio_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `portfolio_correlation_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`as_of` text NOT NULL,
	`lookback_days` integer NOT NULL,
	`method` text DEFAULT 'pearson' NOT NULL,
	`matrix_json` text NOT NULL,
	`coverage` real NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`input_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_correlation_input_uq` ON `portfolio_correlation_snapshots` (`portfolio_id`,`input_hash`);--> statement-breakpoint
CREATE INDEX `portfolio_correlation_asof_idx` ON `portfolio_correlation_snapshots` (`portfolio_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `portfolio_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`security_id` text NOT NULL,
	`position_type` text NOT NULL,
	`shares` real DEFAULT 0 NOT NULL,
	`average_cost` real,
	`current_price` real,
	`price_as_of` text,
	`market_value` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`benchmark_weight` real,
	`beta` real,
	`daily_volatility` real,
	`adv_usd` real,
	`sector` text,
	`industry` text,
	`factor_exposures_json` text DEFAULT '{}' NOT NULL,
	`event_tags_json` text DEFAULT '[]' NOT NULL,
	`source_id` text,
	`data_status` text DEFAULT 'user_input' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_positions_security_uq` ON `portfolio_positions` (`portfolio_id`,`security_id`,`position_type`);--> statement-breakpoint
CREATE INDEX `portfolio_positions_workspace_idx` ON `portfolio_positions` (`workspace_id`,`portfolio_id`);--> statement-breakpoint
CREATE TABLE `portfolio_return_series` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`security_id` text NOT NULL,
	`trading_date` text NOT NULL,
	`return_value` real NOT NULL,
	`source_id` text,
	`as_of` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_returns_security_date_uq` ON `portfolio_return_series` (`portfolio_id`,`security_id`,`trading_date`);--> statement-breakpoint
CREATE INDEX `portfolio_returns_portfolio_date_idx` ON `portfolio_return_series` (`portfolio_id`,`trading_date`);--> statement-breakpoint
CREATE TABLE `portfolio_risk_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`nav` real DEFAULT 0 NOT NULL,
	`max_position_weight` real DEFAULT 0.2 NOT NULL,
	`max_sector_weight` real DEFAULT 0.4 NOT NULL,
	`max_factor_exposure` real DEFAULT 0.5 NOT NULL,
	`max_event_cluster_weight` real DEFAULT 0.35 NOT NULL,
	`scenario_loss_budget_bps` integer DEFAULT 1000 NOT NULL,
	`absolute_loss_cap_bps` integer DEFAULT 2000 NOT NULL,
	`correlation_lookback_days` integer DEFAULT 60 NOT NULL,
	`exit_participation_rate` real DEFAULT 0.1 NOT NULL,
	`rules_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_risk_policies_portfolio_uq` ON `portfolio_risk_policies` (`portfolio_id`);--> statement-breakpoint
CREATE INDEX `portfolio_risk_policies_workspace_idx` ON `portfolio_risk_policies` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `portfolio_risk_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`as_of` text NOT NULL,
	`input_hash` text NOT NULL,
	`metrics_json` text NOT NULL,
	`exposures_json` text NOT NULL,
	`concentration_json` text NOT NULL,
	`liquidity_json` text NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`model_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_risk_snapshots_input_uq` ON `portfolio_risk_snapshots` (`portfolio_id`,`input_hash`);--> statement-breakpoint
CREATE INDEX `portfolio_risk_snapshots_asof_idx` ON `portfolio_risk_snapshots` (`portfolio_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `portfolio_scenario_results` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`as_of` text NOT NULL,
	`input_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scenario_id`) REFERENCES `portfolio_scenarios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_scenario_results_input_uq` ON `portfolio_scenario_results` (`portfolio_id`,`scenario_id`,`input_hash`);--> statement-breakpoint
CREATE INDEX `portfolio_scenario_results_asof_idx` ON `portfolio_scenario_results` (`portfolio_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `portfolio_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`logical_id` text NOT NULL,
	`version` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`portfolio_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`shocks_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`supersedes_id` text,
	`as_of` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_scenarios_version_uq` ON `portfolio_scenarios` (`logical_id`,`version`);--> statement-breakpoint
CREATE INDEX `portfolio_scenarios_portfolio_idx` ON `portfolio_scenarios` (`portfolio_id`,`updated_at`);