-- A3.3: lease tokens for research jobs, webhook deliveries and deletion
-- requests, plus bounded webhook response metadata (no raw response body).
-- No historical migration is edited; this file only adds/changes columns.

-- workspaces gains a tombstone so a deleted account's personal workspace can be
-- marked deleted without breaking the user-id foreign key.
ALTER TABLE `workspaces` ADD COLUMN `deleted_at` text;

-- research_jobs: a per-claim lease token so a worker must prove it still holds
-- the lease before any terminal/retry transition (not rely on the job id).
ALTER TABLE `research_jobs` ADD COLUMN `lease_token` text;

-- webhook_deliveries: the same lease-token guard for complete/fail/requeue.
ALTER TABLE `webhook_deliveries` ADD COLUMN `lease_token` text;

-- webhook_deliveries: replace the persisted raw response body with bounded,
-- non-sensitive metadata (byte length and a content hash). The raw body is
-- deliberately dropped so external endpoints cannot leak sensitive data into
-- the database.
ALTER TABLE `webhook_deliveries` ADD COLUMN `response_bytes` integer;
ALTER TABLE `webhook_deliveries` ADD COLUMN `response_hash` text;
ALTER TABLE `webhook_deliveries` DROP COLUMN `response_body`;

-- deletion_requests: lease token + next-attempt for a recoverable, at-least-once
-- deletion worker with bounded retries and backoff.
ALTER TABLE `deletion_requests` ADD COLUMN `lease_token` text;
ALTER TABLE `deletion_requests` ADD COLUMN `lease_owner` text;
ALTER TABLE `deletion_requests` ADD COLUMN `lease_expires_at` text;
ALTER TABLE `deletion_requests` ADD COLUMN `next_attempt_at` text;
