# Contributing to Pith

_This is a stub — the full contributing guide lands before the first public release (spin-off step 6)._

## Quick rules (enforced in CI)

- **No infrastructure on import.** Code under `packages/core/src/**` must not import `pg`, `ioredis`, `bullmq`, `minio`, or any module that constructs an infra client at load time. The `npm run test:smoke` gate and the `import/no-restricted-paths` lint rule enforce this.
- **Test-first.** New core modules land with their unit test. The 4-project Vitest matrix (`unit`, `integration-real`, `integration-nock`, `accuracy`) must stay green key-free on every PR.
- **No secrets, no real crawled HTML.** Scrub fixtures for PII and use synthetic HTML. The repo was carved out with fresh git history specifically so no `.env` or production body ever enters the log — keep it that way.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
```

## Reporting security issues

See [SECURITY.md](./SECURITY.md) — do **not** open a public issue for security vulnerabilities.
