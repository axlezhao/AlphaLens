# Changelog

This file records delivered changes, not a guarantee that every integration is production-ready. Prereleases may introduce breaking changes; review migrations and back up your own data before upgrading.

## Unreleased

### Added

- Added an actual research-result view for completed, failed and in-progress jobs. It renders only the persisted provider snapshot: source URL, fetched time, `as_of`, cache state, freshness, missing capabilities and warnings.
- Added snapshot-schema parsing at the API/UI boundary and unit coverage that malformed persisted JSON cannot be presented as live research.
- Labelled the landing desk and evidence graph as sample data, and removed the research overlay's unsupported claims of automated thesis, valuation and challenge generation.

### Documentation

- Added a detailed independent-platform architecture plan covering a DeepSeek-first provider-neutral LLM gateway, per-Workspace BYOK security, evidence-to-artifact research workflow, MCP integration, evaluation and staged delivery gates.
- Clarified that exposed API credentials must be revoked and that no personal model key belongs in the repository, public demo, MCP configuration or client-side storage.

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
