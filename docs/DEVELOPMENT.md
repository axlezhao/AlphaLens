# Development and verification

## Supported contributor setup

Use Node.js 24 (`.nvmrc`) and pnpm 11.9.0 (`packageManager` in `package.json`). The package engine minimum is broader, but CI targets Node 24. `private: true` prevents accidental npm publication; it does not make the GitHub repository private.

```bash
npm install --global pnpm@11.9.0
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Visit the address printed by Vite/Vinext. The UI includes bundled sample data. This setup is for UI development, not a claim that every backend action works without infrastructure. Do not commit `.env.local` or copy production credentials into a demo.

## Verified local fixture workflow

For a repeatable local research path, use the fixture profile instead of any real Provider or production authentication setup:

```bash
cp .dev.vars.example .dev.vars
pnpm db:local:migrate
pnpm local:verify:e2e
pnpm db:local:verify-integrity
```

The command migrates `alphalens-local` in local Miniflare state, starts a temporary loopback-only development server, creates/executes/queries a synthetic research job, creates/cancels a second job, then stops the server. No `--remote` flag, provider key, LLM key, email key or production account is used. See [the detailed fixture guide](LOCAL_FIXTURE_WORKFLOW.md).

Fixture authentication is an explicit and deliberately narrow development seam: it requires both fixture variables, a loopback request and a `.invalid` email. It never trusts a browser-provided identity header and must not be enabled in any deployed environment.

## What needs additional infrastructure?

| Operation | Requirement |
| --- | --- |
| Read the sample interface / deterministic tests | Node/pnpm and installed dependencies |
| Persist workspace, watchlist or research records | A bound D1 database with all checked-in migrations applied in order; `pnpm db:local:migrate` provides an isolated local profile |
| Authenticate browser requests | Trusted hosting identity integration; local fixture profile provides a loopback-only `.invalid` test identity, not a production login |
| Execute/recover queued and scheduled work | Internal worker endpoints and scheduled invocation with a shared secret |
| Fetch SEC / issuer documents | Network access, a real monitored User-Agent contact, approved issuer feed configuration |
| Market quote / consensus | Your own authorized provider credentials and explicit license acknowledgement |
| Deliver notifications / webhooks | Authorized accounts/endpoints, encryption/signing secrets, worker scheduling |

See [operations](BETA_OPERATIONS_AND_DATA_GOVERNANCE.md) for binding, variable and endpoint details. The existing `.openai/hosting.json` identifies the original hosted project; it is not a portable deployment credential or an instruction to reuse that project. The placeholder database ID in `vite.config.ts` is not a production database.

There is a verified fixture-backed local bootstrap flow, but there is not yet a standalone multi-user self-hosted authentication flow. Do not work around this by trusting identity headers from a browser. Keep development services bound to your local machine and use isolated data. A3.2 delivered request-level Workspace RBAC, member administration, and atomic controlling-owner transfer; A3.3 delivered the recoverable research-job state machine (per-claim lease token, compare-and-set transitions, and state + event + outbox written in one atomic transaction with deterministic cancellation to a terminal `cancelled` state), the at-least-once webhook outbox (lease token + compare-and-set, raw response bodies never persisted), and the safe background account-deletion workflow (personal/shared workspace distinction, lease recovery, atomic fencing of side effects). The notification outbox still lacks webhook-grade lease/CAS delivery. A managed queue host, production OAuth/SSO and monitoring/alerting remain [the next milestone](CAPABILITIES_AND_ROADMAP.md).

## Checks

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm test
```

`pnpm test` runs unit tests, builds the Worker, and runs the rendered-HTML test using a test-only Cloudflare module loader. Node may warn that the custom loader is experimental. The loader stubs the runtime for the SSR assertion; it is not a production runtime or a database integration test.

The GitHub Actions workflow installs the frozen lockfile, runs lint/type checks, then runs `pnpm test`. It uses no provider credentials or production database, and does not deploy. Add fixtures with redistribution rights rather than introducing network dependencies into unit tests.

`pnpm local:verify:e2e` is an explicit local acceptance command because it launches a loopback Worker and D1 emulator. It has been manually validated against all five checked-in migrations; it never performs a remote database operation.

`pnpm db:local:verify-integrity` applies every migration to a fresh temporary local D1 state, then verifies that invalid member roles, cross-workspace research/portfolio records and ownership transfer to a non-member are rejected at the database boundary. It creates no remote database and requires no `.dev.vars` or Provider credentials. It validates selected core relations, not every API authorization path; A3.2 request-level RBAC, member administration, ownership transfer and dual-tenant HTTP tests live in the unit suite (`tests/workspace-access.test.ts`, `tests/tenant-isolation.test.ts`, `tests/ownership-transfer.test.ts`), and A3.3 reliability tests live in `tests/research-job-reliability.test.ts`, `tests/outbox-reliability.test.ts` and `tests/account-deletion.test.ts`.

## Schema changes

Edit `db/schema.ts`, generate a new migration with `pnpm db:generate`, and review the SQL and journal together. Never edit an already-applied migration to alter an existing deployment. Test new migrations against an isolated database and plan recovery before applying them to persistent data. The local schema files are not a production backup.

## Common misunderstandings

- TypeScript/JavaScript is not Java; changing languages will not fix missing data provenance or workflow state transitions.
- A successful build or a green CI badge does not validate data licensing, authentication trust, current provider availability or research conclusions.
- `as_of` is recorded metadata, not an automatic historical-data query constraint across all providers.
- The current research runner returns source snapshots, not LLM-written investment reports. The homepage thesis example is not its output.
- `pnpm start` uses the project's Vinext runtime; ordinary Node hosting is not a drop-in replacement for D1, Worker bindings or authentication.

For proposed changes, follow [CONTRIBUTING.md](../CONTRIBUTING.md). Keep current behavior and target architecture clearly separated in documentation.
