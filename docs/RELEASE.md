# Release checklist (`@use-pith/core`)

These are the **maintainer go-live actions** — the things that can't be done from a code change (they need credentials, account creation, or external services). The repo itself is publish-ready once `npm pack --dry-run` is clean (verified in CI on every PR).

## One-time setup (before the first release)

1. **npm org — DONE.** The preferred `@pith` scope was unavailable (a dormant org owns it), so the package publishes under **`@use-pith/core`** (org `use-pith`, created at https://www.npmjs.com/org/create). For reference: orgs can't be created from the CLI — `npm org` only manages members of an *existing* org (`set`/`rm`/`ls`); use the web UI. Run `npm login` locally so you can `npm view` / dry-run (the publish itself runs in CI with `NPM_TOKEN`).

   Scope-name ladder (if a future scope is unavailable, update `packages/core/package.json` `name` + the README install snippets + the badge URLs): `@use-pith/core` → `@pith-core/core` → unscoped `pith-core`.

2. **GitHub org + repo.** Create the `pith-core` org (the `pith` handle is a personal account — unavailable), push this repo as `pith-core/pith`, and add the `NPM_TOKEN` secret (a classic automation token with publish scope) at **Settings → Secrets and variables → Actions**. Provenance also needs the build to originate from GitHub (the `release.yml` workflow sets `id-token: write`).

3. **Trademark check.** Run a live/dead search at [tmsearch.uspto.gov](https://tmsearch.uspto.gov/) for the mark **"PITH"** in **IC 009** (software) and **IC 042** (SaaS/tech services). Web search surfaced no notable tech brand named "Pith"; confirm there's no LIVE registration before the public announcement. (This is legal due-diligence — not something the repo can do for you.)

4. **Naming collision heads-up (optional, courteous).** [`github.com/abhisekjha/pith`](https://github.com/abhisekjha/pith) (~96★) is a Claude-Code context-compression tool — same name, adjacent ecosystem, different function. Consider a friendly note to its maintainer, since search results will overlap. Pith's README leads with the web-extraction function to minimize confusion.

## Per-release

1. **Update `CHANGELOG.md`** under a new `## [x.y.z] - YYYY-MM-DD` heading.
2. **Bump `version`** in `packages/core/package.json` (and the root for consistency). Use semver: `0.x` while the API may shift.
3. **Commit**, then tag:
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
4. The **`release`** GitHub Action (`.github/workflows/release.yml`) fires on the `v*` tag: `npm ci` → `npm run build` → `npm publish --provenance --access public` from `packages/core`. Confirm the run is green and the npm page shows the new version with provenance attestation.
5. Sanity-check the published package: `npm view @use-pith/core version` and a clean-room `npm install @use-pith/core` + `node -e "import('@use-pith/core').then(m=>m.createEngine())"`.

## Domains (optional, for a landing page)

Most short domains are parked/premium (`pith.com`, `pith.ai`, `pith.io`, `pith.so`, `pith.sh`, `pith.run`). Low-friction options: `pith-core.dev` or `usepith.com`. Defer until there's a site to host.
