# Security policy

AlphaLens is an experimental beta. It has not undergone an independent security audit and should not be exposed as a public, multi-tenant financial service without additional hardening. Only the latest `main` and the current beta are considered for fixes; older snapshots have no maintenance guarantee.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/axlezhao/AlphaLens/security/advisories/new). Do not open a public issue containing exploit details, credentials or private research. If private reporting is unavailable, use a private contact method listed on [the maintainer's profile](https://github.com/axlezhao); do not post sensitive details while waiting for a channel.

Include the affected commit/version, impacted component, a minimal sanitized reproduction, expected/observed behavior and potential impact. Test only against your own isolated environment. Do not probe the hosted preview, access another user's records, or send test payloads to third-party providers without authorization.

There is no bug bounty or guaranteed response SLA. Coordinate disclosure with the maintainer and avoid exposing affected users before a fix or mitigation is available.

## Deployment trust boundaries

- Current session authentication relies on identity headers supplied by a trusted hosting proxy. A self-hosted deployment must strip user-supplied identity headers and validate authentication before supplying trusted identity. Never expose that header trust directly to the internet.
- Keep provider keys and connector encryption/signing secrets server-side, outside version control. Rotate leaked credentials immediately; deleting a commit is not sufficient.
- Treat webhook/IR destinations and external documents as untrusted. Current URL checks are not a complete DNS/rebinding/IPv6 defense; use network egress restrictions and harden validation before accepting arbitrary destinations.
- Skill permission declarations are not a sandbox. Do not install or run untrusted skills with secrets or privileged tools.
- Multi-tenant access, deletion, worker recovery and webhook delivery require integration/adversarial testing before production use. Local throttles do not enforce a global provider budget.
- Do not use historical `as_of` labels as proof of point-in-time correctness, or heuristic quality scores as investment confidence.

See [the roadmap](docs/CAPABILITIES_AND_ROADMAP.md) and [operations guide](docs/BETA_OPERATIONS_AND_DATA_GOVERNANCE.md) for known limitations. Code licensing does not grant rights to third-party data.
