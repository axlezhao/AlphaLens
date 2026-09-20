-- A3.3: reliability, background recovery and safe asynchronous deletion.
-- No historical migration is edited; this file only adds columns and indexes.

-- users gains a deletion tombstone so a deleted account can be blocked from
-- re-authenticating while audit rows remain referentially intact.
ALTER TABLE `users` ADD COLUMN `deleted_at` text;

-- research_jobs gains an event sequence counter so job events can be assigned
-- a collision-free, in-order sequence with an atomic UPDATE ... RETURNING
-- instead of a racy SELECT MAX(...).
ALTER TABLE `research_jobs` ADD COLUMN `event_seq` integer NOT NULL DEFAULT 0;

-- notification_outbox gains lease and retry/consume-side fields for an
-- at-least-once delivery loop with bounded retries and dead-letter.
ALTER TABLE `notification_outbox` ADD COLUMN `lease_owner` text;
ALTER TABLE `notification_outbox` ADD COLUMN `lease_expires_at` text;
ALTER TABLE `notification_outbox` ADD COLUMN `max_attempts` integer NOT NULL DEFAULT 5;
ALTER TABLE `notification_outbox` ADD COLUMN `idempotency_key` text;
ALTER TABLE `notification_outbox` ADD COLUMN `error_code` text;
ALTER TABLE `notification_outbox` ADD COLUMN `dead_lettered_at` text;

-- webhook_deliveries gains the same lease/retry/consume-side fields.
ALTER TABLE `webhook_deliveries` ADD COLUMN `lease_owner` text;
ALTER TABLE `webhook_deliveries` ADD COLUMN `lease_expires_at` text;
ALTER TABLE `webhook_deliveries` ADD COLUMN `max_attempts` integer NOT NULL DEFAULT 5;
ALTER TABLE `webhook_deliveries` ADD COLUMN `idempotency_key` text;
ALTER TABLE `webhook_deliveries` ADD COLUMN `error_code` text;
ALTER TABLE `webhook_deliveries` ADD COLUMN `dead_lettered_at` text;

-- deletion_requests gains the fields needed for a cancellable, idempotent,
-- background-executed deletion workflow.
ALTER TABLE `deletion_requests` ADD COLUMN `scheduled_for` text;
ALTER TABLE `deletion_requests` ADD COLUMN `idempotency_key` text;
ALTER TABLE `deletion_requests` ADD COLUMN `confirmation_text` text;
ALTER TABLE `deletion_requests` ADD COLUMN `cancelled_at` text;
ALTER TABLE `deletion_requests` ADD COLUMN `attempts` integer NOT NULL DEFAULT 0;
ALTER TABLE `deletion_requests` ADD COLUMN `max_attempts` integer NOT NULL DEFAULT 5;
ALTER TABLE `deletion_requests` ADD COLUMN `error_code` text;
ALTER TABLE `deletion_requests` ADD COLUMN `error_message` text;
ALTER TABLE `deletion_requests` ADD COLUMN `started_at` text;

-- A user may hold at most one open deletion request at a time. A partial
-- unique index enforces this at the database boundary while allowing any
-- number of historical (cancelled/completed/rejected) rows.
CREATE UNIQUE INDEX `deletion_requests_user_open_uq` ON `deletion_requests` (`user_id`) WHERE `status` IN ('requested', 'processing');
