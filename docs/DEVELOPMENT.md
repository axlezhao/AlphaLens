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

## What needs additional infrastructure?

| Operation | Requirement |
| --- | --- |
| Read the sample interface / deterministic tests | Node/pnpm and installed dependencies |
| Persist workspace, watchlist or research records | A bound D1 database with all checked-in migrations applied in order |
| Authenticate browser requests | Trusted hosting identity integration; current app expects Sites-provided identity |
| Execute/recover queued and scheduled work | Internal worker endpoints and scheduled invocation with a shared secret |
| Fetch SEC / issuer documents | Network access, a real monitored User-Agent contact, approved issuer feed configuration |
| Market quote / consensus | Your own authorized provider credentials and explicit license acknowledgement |
| Deliver notifications / webhooks | Authorized accounts/endpoints, encryption/signing secrets, worker scheduling |

See [operations](BETA_OPERATIONS_AND_DATA_GOVERNANCE.md) for binding, variable and endpoint details. The existing `.openai/hosting.json` identifies the original hosted project; it is not a portable deployment credential or an instruction to reuse that project. The placeholder database ID in `vite.config.ts` is not a production database.

There is not yet a verified standalone self-hosted authentication/bootstrap flow. Do not work around this by trusting identity headers from a browser. Keep development services bound to your local machine and use isolated data. A reproducible local fixture-backed backend is a [priority milestone](CAPABILITIES_AND_ROADMAP.md).

## Checks

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm test
```

`pnpm test` runs unit tests, builds the Worker, and runs the rendered-HTML test using a test-only Cloudflare module loader. Node may warn that the custom loader is experimental. The loader stubs the runtime for the SSR assertion; it is not a production runtime or a database integration test.

The GitHub Actions workflow installs the frozen lockfile, runs lint/type checks, then runs `pnpm test`. It uses no provider credentials or production database, and does not deploy. Add fixtures with redistribution rights rather than introducing network dependencies into unit tests.

## Schema changes

Edit `db/schema.ts`, generate a new migration with `pnpm db:generate`, and review the SQL and journal together. Never edit an already-applied migration to alter an existing deployment. Test new migrations against an isolated database and plan recovery before applying them to persistent data. The local schema files are not a production backup.

## Common misunderstandings

- TypeScript/JavaScript is not Java; changing languages will not fix missing data provenance or workflow state transitions.
- A successful build or a green CI badge does not validate data licensing, authentication trust, current provider availability or research conclusions.
- `as_of` is recorded metadata, not an automatic historical-data query constraint across all providers.
- The current research runner returns source snapshots, not LLM-written investment reports. The homepage thesis example is not its output.
- `pnpm start` uses the project's Vinext runtime; ordinary Node hosting is not a drop-in replacement for D1, Worker bindings or authentication.

For proposed changes, follow [CONTRIBUTING.md](../CONTRIBUTING.md). Keep current behavior and target architecture clearly separated in documentation.
