# Contributing to Pith

Thanks for considering a contribution. Pith is an open-source web-for-LLMs engine carved out of a production platform; the goal is a clean, embeddable core with zero infrastructure by default.

## Quick rules (enforced in CI)

- **No infrastructure on import.** Code under `packages/core/src/**` must not import `pg`, `ioredis`, `bullmq`, `minio`, `kafkajs`, or anything that constructs an infra client at load time. The `test:smoke` gate and the `import/no-restricted-paths` lint rule enforce this. Host concerns go behind a port (see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)).
- **Test-first.** New core modules land with their unit test. The 5-project Vitest matrix must stay green, **key-free**, on every PR.
- **No secrets, no real crawled HTML.** Scrub fixtures for PII and use synthetic HTML. This repo has a fresh git history precisely so no `.env` or production body ever enters the log — keep it that way. `gitleaks` runs on every push/PR.

## Development

```bash
git clone … && cd pith
npm install                 # workspaces install
npm run typecheck
npm run lint
npm test                    # all 5 projects, green key-free
```

### The test matrix

`npm test` runs all five projects. They're split so the gate can stay key-free and hermetic on PRs:

| Project | What | When |
|---|---|---|
| `unit` | pure-function tests, no network | every PR |
| `smoke` | the "no infra on import" invariant | every PR |
| `integration-real` | real loopback fetch/crawl/HTTP/MCP, still key-free | every PR |
| `integration-nock` | HTTP-mocked adapter variants | every PR |
| `accuracy` | the 20-fixture extraction benchmark | nightly only (key-gated via `EXTRACTION_API_KEY`); `describe.skipIf` keeps it a no-op in PR CI |

Run one: `npm run test:unit` / `test:smoke` / `test:integration:real` / `test:integration:nock` / `test:accuracy`.

## Adding a fixture

Accuracy fixtures live in `packages/core/tests/accuracy/extractionFixtures.ts`. Keep them **synthetic** (use `example.test` domains, the `555` phone prefix, fictional names/brands) — never paste real crawled HTML or real PII. A fixture that exercises a new field type (string/number/boolean) is the most useful addition. Update `expected` in lockstep with the input.

## Commit & PR style

- Conventional-ish prefixes are appreciated (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) but not hard-enforced.
- One logical change per PR; include tests; keep the matrix green.
- The PR template asks you to confirm: tests added to the right project, `typecheck`/`lint`/`test` green key-free, no secrets/PII/real HTML, the no-infra invariant respected, docs updated if the public API changed.

## Architecture context

Before touching engine logic, read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — especially the port table and the load-bearing invariants (budget `spentCents`, crawl child-before-success ordering, the freshness tightening rule). Match the surrounding code's style and comment density.

## Releases

Releases are cut by tagging (`v0.x.0`); the `release` workflow builds and publishes `@use-pith/core` with npm provenance. Maintainer steps are in [`docs/RELEASE.md`](./docs/RELEASE.md).

## Reporting security issues

See [`SECURITY.md`](./SECURITY.md) — do **not** open a public issue for security vulnerabilities.
