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
- **A3.2: dual-tenant integration test suite** — 32 new tests covering unauthenticated rejection, fixture boundary, role matrix on research/portfolio/platform, spoofed header/body fields, cross-tenant 404 symmetry, Open API token scope/tenant binding, internal-worker workspace derivation from claimed rows, and sanitized audit persistence (no secret, cookie or bearer token written).
- Added `drizzle/0005_steady_vega.sql` protecting the controlling-owner deletion path in D1, plus `tests/helpers/d1-shim.ts` (a minimal `node:sqlite` facade for D1) and an enhanced `tests/cloudflare-loader.mjs` so route handlers can run outside the bundler.
- Extended `scripts/local/verify-tenant-integrity.sh` to assert the controlling-owner deletion guard on a separate local D1 state per run.

### Documentation

- Added a detailed independent-platform architecture plan covering a DeepSeek-first provider-neutral LLM gateway, per-Workspace BYOK security, evidence-to-artifact research workflow, MCP integration, evaluation and staged delivery gates.
- Clarified that exposed API credentials must be revoked and that no personal model key belongs in the repository, public demo, MCP configuration or client-side storage.
- Documented the A3.1 database boundary, local validation command and its remaining HTTP-level authorization limits.
- Updated [CAPABILITIES_AND_ROADMAP.md](docs/CAPABILITIES_AND_ROADMAP.md) to record A3.2 completion (request-level RBAC + dual-tenant HTTP tests) while keeping A3.3 as the next target.
- Updated [ARCHITECTURE_AND_WORKFLOW.md](docs/ARCHITECTURE_AND_WORKFLOW.md) to note that `x-alphalens-workspace` is a selection hint validated against real membership, not an authorization grant, and that foreign-tenant lookups return 404.
- Updated [PRODUCT_ARCHITECTURE_PLAN.md](docs/PRODUCT_ARCHITECTURE_PLAN.md) to mark Phase 1 "真实证据闭环" A3.1+A3.2 as done, A3.3 still open.
- Updated [BETA_OPERATIONS_AND_DATA_GOVERNANCE.md](docs/BETA_OPERATIONS_AND_DATA_GOVERNANCE.md) to describe the minimal workspace/member management surface, audit scope and the intentionally minimal role set for beta.

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
