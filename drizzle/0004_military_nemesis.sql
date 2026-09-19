CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`,`created_at`);
--> statement-breakpoint
-- Backfill the ownership membership that earlier application versions created in
-- code only. The trigger below keeps new workspace creation safe for every writer.
UPDATE `workspace_members`
SET `role` = 'owner'
WHERE (`workspace_id`, `user_id`) IN (SELECT `id`, `owner_user_id` FROM `workspaces`);
--> statement-breakpoint
INSERT OR IGNORE INTO `workspace_members` (`workspace_id`, `user_id`, `role`, `created_at`)
SELECT `id`, `owner_user_id`, 'owner', `created_at` FROM `workspaces`;
--> statement-breakpoint
CREATE TRIGGER `workspace_members_role_insert_guard`
BEFORE INSERT ON `workspace_members`
FOR EACH ROW WHEN NEW.`role` NOT IN ('owner', 'editor', 'viewer')
BEGIN
  SELECT RAISE(ABORT, 'workspace_member_role_invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `workspace_members_role_update_guard`
BEFORE UPDATE OF `role` ON `workspace_members`
FOR EACH ROW WHEN NEW.`role` NOT IN ('owner', 'editor', 'viewer')
BEGIN
  SELECT RAISE(ABORT, 'workspace_member_role_invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `workspaces_create_owner_member`
AFTER INSERT ON `workspaces`
FOR EACH ROW
BEGIN
  INSERT OR IGNORE INTO `workspace_members` (`workspace_id`, `user_id`, `role`, `created_at`)
  VALUES (NEW.`id`, NEW.`owner_user_id`, 'owner', NEW.`created_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `workspaces_transfer_requires_member`
BEFORE UPDATE OF `owner_user_id` ON `workspaces`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `workspace_members`
  WHERE `workspace_id` = OLD.`id` AND `user_id` = NEW.`owner_user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_owner_must_be_member');
END;
--> statement-breakpoint
CREATE TRIGGER `workspace_owner_cannot_be_demoted`
BEFORE UPDATE OF `role` ON `workspace_members`
FOR EACH ROW WHEN NEW.`role` != 'owner' AND OLD.`user_id` = (
  SELECT `owner_user_id` FROM `workspaces` WHERE `id` = OLD.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_owner_cannot_be_demoted');
END;
--> statement-breakpoint
CREATE TRIGGER `research_jobs_tenant_insert_guard`
BEFORE INSERT ON `research_jobs`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
) OR NOT EXISTS (
  SELECT 1 FROM `workspace_members` WHERE `workspace_id` = NEW.`workspace_id` AND `user_id` = NEW.`requested_by_user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'research_job_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `research_jobs_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `security_id`, `requested_by_user_id` ON `research_jobs`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
) OR NOT EXISTS (
  SELECT 1 FROM `workspace_members` WHERE `workspace_id` = NEW.`workspace_id` AND `user_id` = NEW.`requested_by_user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'research_job_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `evidence_tenant_insert_guard`
BEFORE INSERT ON `evidence`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
) OR NOT EXISTS (
  SELECT 1 FROM `sources` WHERE `id` = NEW.`source_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'evidence_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `evidence_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `security_id`, `source_id` ON `evidence`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
) OR NOT EXISTS (
  SELECT 1 FROM `sources` WHERE `id` = NEW.`source_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'evidence_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `theses_tenant_insert_guard`
BEFORE INSERT ON `theses`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'thesis_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `theses_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `security_id` ON `theses`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'thesis_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `catalysts_tenant_insert_guard`
BEFORE INSERT ON `catalysts`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
) OR (NEW.`source_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `sources` WHERE `id` = NEW.`source_id` AND `workspace_id` = NEW.`workspace_id`
))
BEGIN
  SELECT RAISE(ABORT, 'catalyst_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `catalysts_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `security_id`, `source_id` ON `catalysts`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
) OR (NEW.`source_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `sources` WHERE `id` = NEW.`source_id` AND `workspace_id` = NEW.`workspace_id`
))
BEGIN
  SELECT RAISE(ABORT, 'catalyst_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `model_calls_tenant_insert_guard`
BEFORE INSERT ON `model_calls`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `research_jobs` WHERE `id` = NEW.`research_job_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'model_call_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `model_calls_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `research_job_id` ON `model_calls`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `research_jobs` WHERE `id` = NEW.`research_job_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'model_call_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `reviews_tenant_insert_guard`
BEFORE INSERT ON `reviews`
FOR EACH ROW WHEN (NEW.`research_job_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `research_jobs` WHERE `id` = NEW.`research_job_id` AND `workspace_id` = NEW.`workspace_id`
)) OR NOT EXISTS (
  SELECT 1 FROM `workspace_members` WHERE `workspace_id` = NEW.`workspace_id` AND `user_id` = NEW.`reviewer_user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'review_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `reviews_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `research_job_id`, `reviewer_user_id` ON `reviews`
FOR EACH ROW WHEN (NEW.`research_job_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `research_jobs` WHERE `id` = NEW.`research_job_id` AND `workspace_id` = NEW.`workspace_id`
)) OR NOT EXISTS (
  SELECT 1 FROM `workspace_members` WHERE `workspace_id` = NEW.`workspace_id` AND `user_id` = NEW.`reviewer_user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'review_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `thesis_evidence_tenant_insert_guard`
BEFORE INSERT ON `thesis_evidence`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `theses` t JOIN `evidence` e ON e.`id` = NEW.`evidence_id`
  WHERE t.`id` = NEW.`thesis_id` AND t.`workspace_id` = e.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'thesis_evidence_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `thesis_evidence_tenant_update_guard`
BEFORE UPDATE OF `thesis_id`, `evidence_id` ON `thesis_evidence`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `theses` t JOIN `evidence` e ON e.`id` = NEW.`evidence_id`
  WHERE t.`id` = NEW.`thesis_id` AND t.`workspace_id` = e.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'thesis_evidence_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_positions_tenant_insert_guard`
BEFORE INSERT ON `portfolio_positions`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
) OR NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
) OR (NEW.`source_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `sources` WHERE `id` = NEW.`source_id` AND `workspace_id` = NEW.`workspace_id`
))
BEGIN
  SELECT RAISE(ABORT, 'portfolio_position_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_positions_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `portfolio_id`, `security_id`, `source_id` ON `portfolio_positions`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
) OR NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
) OR (NEW.`source_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `sources` WHERE `id` = NEW.`source_id` AND `workspace_id` = NEW.`workspace_id`
))
BEGIN
  SELECT RAISE(ABORT, 'portfolio_position_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_returns_tenant_insert_guard`
BEFORE INSERT ON `portfolio_return_series`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
) OR NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_return_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_returns_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `portfolio_id`, `security_id`, `source_id` ON `portfolio_return_series`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
) OR NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_return_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_policy_tenant_insert_guard`
BEFORE INSERT ON `portfolio_risk_policies`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_policy_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_policy_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `portfolio_id` ON `portfolio_risk_policies`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_policy_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_correlation_tenant_insert_guard`
BEFORE INSERT ON `portfolio_correlation_snapshots`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_correlation_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_correlation_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `portfolio_id` ON `portfolio_correlation_snapshots`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_correlation_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_scenarios_tenant_insert_guard`
BEFORE INSERT ON `portfolio_scenarios`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_scenario_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_scenarios_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `portfolio_id` ON `portfolio_scenarios`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_scenario_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_scenario_results_tenant_insert_guard`
BEFORE INSERT ON `portfolio_scenario_results`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
) OR NOT EXISTS (
  SELECT 1 FROM `portfolio_scenarios` WHERE `id` = NEW.`scenario_id` AND `workspace_id` = NEW.`workspace_id` AND `portfolio_id` = NEW.`portfolio_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_scenario_result_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_scenario_results_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `portfolio_id`, `scenario_id` ON `portfolio_scenario_results`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
) OR NOT EXISTS (
  SELECT 1 FROM `portfolio_scenarios` WHERE `id` = NEW.`scenario_id` AND `workspace_id` = NEW.`workspace_id` AND `portfolio_id` = NEW.`portfolio_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_scenario_result_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_risk_snapshots_tenant_insert_guard`
BEFORE INSERT ON `portfolio_risk_snapshots`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_risk_snapshot_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_risk_snapshots_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `portfolio_id` ON `portfolio_risk_snapshots`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'portfolio_risk_snapshot_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_action_conditions_tenant_insert_guard`
BEFORE INSERT ON `portfolio_action_conditions`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
) OR (NEW.`security_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
))
BEGIN
  SELECT RAISE(ABORT, 'portfolio_action_condition_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_action_conditions_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `portfolio_id`, `security_id` ON `portfolio_action_conditions`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `portfolios` WHERE `id` = NEW.`portfolio_id` AND `workspace_id` = NEW.`workspace_id`
) OR (NEW.`security_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `securities` WHERE `id` = NEW.`security_id` AND `workspace_id` = NEW.`workspace_id`
))
BEGIN
  SELECT RAISE(ABORT, 'portfolio_action_condition_workspace_mismatch');
END;
