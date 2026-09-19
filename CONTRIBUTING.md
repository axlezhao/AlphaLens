# Contributing to AlphaLens

Thank you for helping make research more reviewable. This is an experimental, independently maintained project; focused fixes and reproducible reports are especially useful. English and Chinese contributions are welcome.

## Before starting

- Read the [README](README.md), [capability inventory](docs/CAPABILITIES_AND_ROADMAP.md), [development guide](docs/DEVELOPMENT.md), and [Code of Conduct](CODE_OF_CONDUCT.md).
- Open an issue before a major feature, new provider, dependency, or architecture change. Link the agreed acceptance criteria in your PR.
- Report vulnerabilities privately using [SECURITY.md](SECURITY.md), not in a public issue.

## Development workflow

1. Fork and clone the repository; use Node.js 24 and pnpm 11.9.0.
2. Install with `pnpm install --frozen-lockfile` and create a focused branch.
3. Implement the smallest useful change and regression test. Do not mix unrelated formatting or refactors.
4. Run `pnpm run lint`, `pnpm run typecheck`, and `pnpm test`.
5. Open a PR explaining the behavior change, evidence of testing, remaining limitations, and related issue.

Use your own Git author identity. Dependency updates must include the lockfile. Database changes must add a reviewed migration; do not rewrite already-applied migrations. CI checks deterministic behavior, not live integration reliability.

## Research and data rules

- Every new external source needs an explicit permitted-use boundary, provenance, timestamps, freshness/error behavior, and tests with redistributable fixtures.
- Preserve the distinction between facts, expectations, inferences, user views, and unverified claims. Missing data must stay missing, not silently turn into zero or a sample value.
- Record units, currencies, fiscal periods and valuation assumptions. Include numerical golden cases and tests against look-ahead leakage where applicable.
- Do not add brokerage order execution. AlphaLens produces research and human-reviewable action conditions only.
- Do not commit provider keys, live tokens, personal holdings, private research, production database dumps, or restricted third-party datasets. Sanitize screenshots and logs too.

## Documentation and review

Update README and the relevant architecture, operations and roadmap files when behavior changes. Clearly distinguish designed, implemented, tested and live-verified features. Add delivered changes to `CHANGELOG.md` under Unreleased.

Review prioritizes correct data boundaries, reproducibility, tenant safety and clear failure states over the number of features. Maintainer capacity varies; no response or release SLA is promised.

By contributing, you agree that your contribution is provided under the repository's MIT license and that you have the right to submit it. Third-party material must retain required notices and have compatible permissions.
