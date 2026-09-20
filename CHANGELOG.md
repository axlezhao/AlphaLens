# Changelog

This file records delivered changes, not a guarantee that every integration is production-ready. Prereleases may introduce breaking changes; review migrations and back up your own data before upgrading.

## Unreleased

### Added

- Added an actual research-result view for completed, failed and in-progress jobs. It renders only the persisted provider snapshot: source URL, fetched time, `as_of`, cache state, freshness, missing capabilities and warnings.
- Added snapshot-schema parsing at the API/UI boundary and unit coverage that malformed persisted JSON cannot be presented as live research.
- Labelled the landing desk and evidence graph as sample data, and removed the research overlay's unsupported claims of automated thesis, valuation and challenge generation.
- Added an isolated local D1 fixture profile, loopback-only `.invalid` development identity, synthetic Provider snapshots and an end-to-end create/execute/query/cancel verification command. It uses no real Provider, LLM or production credentials.
- Added A3.1 D1 tenant-integrity protections: validated Workspace member roles, automatic controlling-owner membership for new Workspaces, member-only owner transfer, and cross-Workspace relation guards for core research and portfolio records.
- Added bounded audit-metadata sanitization so credential-like values, raw request/content fields and prompts are excluded before audit persistence, plus a fresh local-D1 integrity verification command.
- **A3.2: request-level Workspace RBAC** — extracted `requireAuthenticatedUser`, `requireWorkspaceAccess`, `requirePortfolioAccess`, `listAccessibleWorkspaces` and `auditDenied`; unified 401 / 403 / 404 boundaries; foreign-tenant references surface the same opaque 404 as missing resources.
- **A3.2: workspace CRUD** — `GET /api/v1/workspaces`, `POST /api/v1/workspaces`, `GET /members`, `POST /members`, `PATCH /members/:userId`, `DELETE /members/:userId`; member joins respect `workspace_members.role`; controlling-owner removal is rejected both by migration guard and application check.
- **A3.2: controlling-owner transfer** — `POST /api/v1/workspaces/:workspaceId/ownership-transfer`. Only the current controlling owner (the user pointed to by `workspaces.owner_user_id`) may transfer; a former controlling owner who keeps the `owner` role is rejected with 403 `CONTROLLING_OWNER_REQUIRED`. The target must already be a member (non-members and unknown users are rejected without leaking tenants); the transfer is atomic in one batch (target promoted to `owner`, then `workspaces.owner_user_id` repointed), the previous owner stays an ordinary `owner` member, and a sanitized `workspace.ownership.transfer` audit row is written.
- **A3.2: dual-tenant integration test suite** — 32 tests covering unauthenticated rejection, fixture boundary, role matrix on research/portfolio/platform, spoofed header/body fields, cross-tenant 404 symmetry, Open API token scope/tenant binding, internal-worker workspace derivation from claimed rows, and sanitized audit persistence (no secret, cookie or bearer token written). An additional 9 `ownership-transfer.test.ts` cases cover non-owner rejection, unknown/non-member targets, self-transfer, atomic success, previous-owner retention, new-owner demotion/removal protection, and the former controlling owner being blocked from transferring again.
- Added `drizzle/0005_steady_vega.sql` protecting the controlling-owner deletion path in D1, plus `tests/helpers/d1-shim.ts` (a minimal `node:sqlite` facade for D1) and an enhanced `tests/cloudflare-loader.mjs` so route handlers can run outside the bundler.
- Extended `scripts/local/verify-tenant-integrity.sh` to assert the controlling-owner deletion guard on a separate local D1 state per run.
- **A3.3: recoverable research-job state machine** — introduced `lib/research/job-state.ts` (explicit statuses `queued`/`running`/`retrying`/`succeeded`/`failed`/`cancelled`, terminal-state protection, retryable-vs-non-retryable error classification, exponential backoff). Job events now take their sequence from an atomic counter increment committed in the same transaction as the event insert (never a racy `SELECT MAX(...)`), so a crash cannot leave a sequence gap. The worker atomically claims due jobs, recovers expired leases and enforces timeouts; cancellation always wins over a worker finalising the same job.
- **A3.3: at-least-once outbox** — `lib/outbox/` adds webhook delivery with transactional coupling to business changes, bounded retry with backoff, dead-letter + workspace-scoped requeue, and lease recovery. `lib/outbox/webhook-safety.ts` validates destination URLs (HTTPS-only, rejects private/loopback/link-local/metadata hosts, explicit local-dev loopback exception) and redacts secrets from error summaries. A new `POST /api/internal/outbox-worker` drives delivery.
- **A3.3: safe account deletion** — `lib/account/deletion.ts` adds confirmation-gated, idempotent deletion requests, cancellation, controlling-owner protection (transfer required first), a background `POST /api/internal/deletion-worker`, and soft-delete semantics (tombstone + display-name anonymization while retaining the email as a stable identifier so a deleted account cannot silently re-register). `requireAuthenticatedUser` now blocks re-authentication of deleted users.
- Added `drizzle/0006_dapper_quasar.sql`: `users.deleted_at`, `research_jobs.event_seq`, outbox/delivery lease+dead-letter+idempotency columns, `deletion_requests` scheduling/cancellation/attempt columns, and a partial unique index enforcing one open deletion request per user.
- **A3.3: lease tokens harden worker state transitions** — research jobs, webhook deliveries and deletion requests now carry a unique per-claim `lease_token`; every terminal/retry/complete/fail/requeue transition is a compare-and-set against the token, the expected status, and an unexpired lease, so a worker that lost its lease (and was reclaimed by another worker) cannot overwrite the newer worker's result or emit a misleading terminal event. Cancellation is re-checked after provider calls and before the succeeded write, and a cancelled job never enqueues a `research.completed` outbox delivery.
- **A3.3: atomic research completion and outbox** — the final `succeeded` state transition, the `succeeded` event row, and all `webhook_deliveries` fan-out for a given job are now written in the same D1 transaction (`db.batch`). A crash between state update and delivery no longer leaves a succeeded job without its business event. The same atomic batch wraps retry and failed transitions with their events. The final succeeded CAS also requires `cancel_requested_at IS NULL` so a cancel that lands between the mid-flight re-check and the update still wins.
- **A3.3: deletion execution fenced by lease token** — `executeDeletion` now accepts a full `DeletionClaim` and verifies (request id, lease token match, lease unexpired, status='processing') before touching any `users`/`workspace_members`/`workspaces` rows; a stale worker whose lease expired returns `false` without writing tombstones or deleting memberships. Cancellation is restricted to the `requested` state only; once a worker claims the request (`processing`) the cancel API returns 409 `DELETION_ALREADY_PROCESSING`. `completeDeletion` and `failDeletion` also require an unexpired lease.
- **A3.3: bounded webhook response metadata** — the raw webhook response body is no longer persisted; only the status code, byte length and a content hash are stored, so an external endpoint cannot leak sensitive data into the database.
- **A3.3: owner-only dead-letter requeue** — `POST /api/v1/webhooks/deliveries/:deliveryId/requeue` lets only the owning workspace's controlling owner requeue a dead-lettered delivery; non-owners get 403 and foreign workspaces get 404, and each requeue is audited.
- Added `drizzle/0007_brisk_aurora.sql`: `workspaces.deleted_at`, `research_jobs.lease_token`, `webhook_deliveries.lease_token` + `response_bytes`/`response_hash` (dropping `response_body`), and `deletion_requests` lease-token/next-attempt columns.

### Documentation

- Added a detailed independent-platform architecture plan covering a DeepSeek-first provider-neutral LLM gateway, per-Workspace BYOK security, evidence-to-artifact research workflow, MCP integration, evaluation and staged delivery gates.
- Clarified that exposed API credentials must be revoked and that no personal model key belongs in the repository, public demo, MCP configuration or client-side storage.
- Documented the A3.1 database boundary, local validation command and its remaining HTTP-level authorization limits.
- Updated [CAPABILITIES_AND_ROADMAP.md](docs/CAPABILITIES_AND_ROADMAP.md) to record A3.2 completion (request-level RBAC + dual-tenant HTTP tests) while keeping A3.3 as the next target.
- Updated [ARCHITECTURE_AND_WORKFLOW.md](docs/ARCHITECTURE_AND_WORKFLOW.md) to note that `x-alphalens-workspace` is a selection hint validated against real membership, not an authorization grant, and that foreign-tenant lookups return 404.
- Updated [PRODUCT_ARCHITECTURE_PLAN.md](docs/PRODUCT_ARCHITECTURE_PLAN.md) to mark Phase 1 "真实证据闭环" A3.1+A3.2 as done, A3.3 still open.
- Updated [BETA_OPERATIONS_AND_DATA_GOVERNANCE.md](docs/BETA_OPERATIONS_AND_DATA_GOVERNANCE.md) to describe the minimal workspace/member management surface, audit scope and the intentionally minimal role set for beta.
- Documented A3.3 reliability boundaries: at-least-once (not exactly-once) delivery, the lease-token + compare-and-set worker model with cancellation precedence, the webhook safety model (raw response bodies are never persisted), account deletion and the personal/shared workspace distinction, and the still-open production capabilities (managed queue hosting, production OAuth/SSO, monitoring/alerting, compliance-approved retention, a notification outbox that reaches webhook-grade lease/CAS delivery).

Planned implementation work remains tracked in the [roadmap](docs/CAPABILITIES_AND_ROADMAP.md); no LLM or MCP runtime code is included in this documentation change.

## 0.5.0-beta — 2026-09-18

First packaged open-source beta of the existing research workbench. Earlier development history remains in Git; this does not imply the capabilities below were all first implemented on this date.

### Included foundation

- TypeScript web interface, D1 research/evidence models, source adapters and asynchronous snapshot collection.
- Personal workbench and deterministic portfolio calculations.
- Experimental workflow, KPI/skill registry, review/publishing and API/webhook control plane.
- Optional WorkBuddy instruction bundle.

### Repository readiness

- Repositioned AlphaLens as an independent personal project, with English and Chinese READMEs.
- Added MIT license, contribution/security/conduct policies, issue forms and a PR template.
- Added Node version guidance, a type-check script and CI for lint, types, tests and build.
- Replaced blanket P0–P3 completion claims with an implementation inventory, known gaps and measurable next milestones.
- Added public tracking issues for real research rendering, reproducible local setup, integration hardening and workflow lifecycle.

### Known limitations

Sample dashboard data is not generated research. External LLM calls, calibrated multi-agent evaluation, complete workflow lifecycle and portable self-hosting are not finished. Auth relies on a trusted hosting boundary; further security and integration testing is required. Data/provider permissions are separate from the source-code license. See [release notes](docs/releases/v0.5.0-beta.md).
