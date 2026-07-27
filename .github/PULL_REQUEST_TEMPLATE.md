## Summary

<!-- What does this change do, and why? Link any issues (#NNN). -->

## Checklist

- [ ] **Tests added or updated** in the right project (`unit`, `smoke`, `integration-nock`, `integration-real`, or `accuracy`). Bug fixes must include a regression test.
- [ ] **`npm run typecheck`, `npm run lint`, and the full suite pass locally with no API keys set.** The key-free projects (`unit`, `integration-nock`, `smoke`) must pass with zero environment; key-gated suites (`integration-real`, `accuracy`) may skip when `PITH_*` / `EXTRACTION_*` / `BRAVE_*` keys are absent.
- [ ] **No secrets, credentials, or PII committed** — no API keys in fixtures/configs, and no real crawled HTML or site snapshots checked into the repo.
- [ ] **"No infrastructure on import" respected** — no `pg`, `ioredis`, `bullmq`, `minio`, or other infra clients imported anywhere under `src/` (the lint rule + smoke gate must stay green).
- [ ] **Docs updated if the public API changed** — `docs/ARCHITECTURE.md`, the OpenAPI spec, `README.md`, and `CHANGELOG.md` where applicable.
- [ ] **`CHANGELOG.md` `[Unreleased]`** entry added for user-facing changes.

## Notes for reviewers

<!-- Anything reviewers should pay attention to — design trade-offs, screenshots, how you tested. -->
