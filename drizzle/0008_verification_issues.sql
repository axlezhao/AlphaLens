-- Phase 1: automated verification of research artifact versions.
-- verification_issues records problems found by the draft checks; artifact
-- versions record when and by which verifier version they were checked; and a
-- research-job draft artifact is linked to its job (one draft per job).
-- No historical migration is edited.

CREATE TABLE `verification_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`artifact_version_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`check_code` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`subject_json` text DEFAULT '{}' NOT NULL,
	`message` text NOT NULL,
	`verifier_version` text NOT NULL,
	`resolution_note` text,
	`resolved_by_user_id` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_version_id`) REFERENCES `research_artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_issues_version_fingerprint_uq` ON `verification_issues` (`artifact_version_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `verification_issues_open_idx` ON `verification_issues` (`workspace_id`,`artifact_version_id`,`status`);--> statement-breakpoint
ALTER TABLE `research_artifact_versions` ADD `verified_at` text;--> statement-breakpoint
ALTER TABLE `research_artifact_versions` ADD `verifier_version` text;--> statement-breakpoint
ALTER TABLE `research_artifacts` ADD `research_job_id` text REFERENCES research_jobs(id);--> statement-breakpoint
CREATE UNIQUE INDEX `research_artifacts_research_job_uq` ON `research_artifacts` (`research_job_id`) WHERE "research_artifacts"."research_job_id" IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `verification_issues_tenant_insert_guard`
BEFORE INSERT ON `verification_issues`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `research_artifact_versions` WHERE `id` = NEW.`artifact_version_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'verification_issue_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `verification_issues_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `artifact_version_id` ON `verification_issues`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `research_artifact_versions` WHERE `id` = NEW.`artifact_version_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'verification_issue_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `research_artifacts_job_tenant_insert_guard`
BEFORE INSERT ON `research_artifacts`
FOR EACH ROW WHEN NEW.`research_job_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `research_jobs` WHERE `id` = NEW.`research_job_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'research_artifact_job_workspace_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `research_artifacts_job_tenant_update_guard`
BEFORE UPDATE OF `workspace_id`, `research_job_id` ON `research_artifacts`
FOR EACH ROW WHEN NEW.`research_job_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `research_jobs` WHERE `id` = NEW.`research_job_id` AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'research_artifact_job_workspace_mismatch');
END;
