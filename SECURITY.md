# Security Policy

_This policy is distinct from any policy of the source project Pith was extracted from._

## Reporting a vulnerability

Please report security vulnerabilities **privately**. Do not open a public GitHub issue.

**Preferred channel:** GitHub's **"Report a vulnerability"** feature on the [pith-core/pith](https://github.com/pith-core/pith/security/advisories/new) repository (Security → Advisories → New draft advisory). This routes directly to the maintainers and supports coordinated disclosure. (A dedicated `security@` email will be added once a domain is set up; until then, GitHub Advisories is the canonical channel.)

Please include:

- A description of the issue and its impact.
- Steps to reproduce, including any proof-of-concept.
- Affected versions/commits.

We will acknowledge receipt within a reasonable window and coordinate a fix and disclosure timeline with you.

## Scope

Pith is an engine that fetches and transforms web content. In scope: the package source under `packages/`, its dependencies as declared, and the published artifacts. Out of scope: vulnerabilities in third-party providers (OpenAI-compatible endpoints, Brave Search), host infrastructure consumers choose to run, or self-inflicted issues from misconfiguration (e.g. disabling the SSRF guard).

## Hardening defaults (by design)

- The SSRF guard runs on **every** fetch tier, including headless redirects and sub-resources.
- The OSS package ships with **no default API keys and no default billable endpoint** — extraction/search throw `NotConfiguredError` until a provider is explicitly configured.
- `robots.txt` compliance is on by default and fails open (spec-compliant) only when unreachable.
