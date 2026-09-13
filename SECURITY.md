# Security Policy

ModWrench handles API tokens. We take that seriously — what it does with them is written down in [TRUST.md](TRUST.md), with the commands to check each claim yourself. If you've found a vulnerability or believe the trust posture is being violated, this document tells you how to reach us privately.

## Reporting a vulnerability

**Please do not file a public issue.** Vulnerabilities are reported privately so we can patch and ship a fix before anyone weaponizes the disclosure.

How to report:

1. **GitHub Private Vulnerability Reporting** — preferred. Use the [Report a vulnerability](https://github.com/171county/modwrench/security/advisories/new) button on the repo's Security tab. This creates a private advisory only the maintainers can see.
2. **GitHub issue** — for anything that is NOT sensitive. If you are unsure whether it is sensitive, use the private advisory above instead.

When you report, please include:

- A description of the vulnerability and its potential impact
- Reproduction steps (as minimal as possible — proof-of-concept code is great)
- Which version / commit SHA you found it in
- Whether you've already disclosed it to anyone else
- Your preferred name/handle for credit, or `anonymous` if you want no public mention

We will acknowledge receipt within 72 hours. We will not threaten legal action against good-faith security researchers operating within the terms of this policy.

## Scope

In scope:

- The `@modwrench/*` npm packages
- The MCP servers' protocol surface (anything reachable via stdio / Streamable HTTP)
- Credential handling, especially the OAuth flows in `@modwrench/nexus` and `@modwrench/modio`
- The OS keychain integration in `@modwrench/core`
- The CLI binaries (`modwrench`, `modwrench-nexus`, `modwrench-modio`, `modwrench-thunderstore`, `modwrench-workbench`, `modwrench-remote`)
- The bundled GitHub Actions workflows in this repo

Reports for upstream projects:

- Vulnerabilities in the upstream platforms themselves (Nexus Mods, mod.io, Thunderstore, GitHub)
- Vulnerabilities in `@modelcontextprotocol/sdk` (report to Anthropic)
- Vulnerabilities in `@napi-rs/keyring` (report to napi-rs)
- Vulnerabilities in transitive npm dependencies — file a Dependabot alert or report to the upstream package

## How we handle credentials

For transparency, the rules ModWrench's code enforces:

1. **OAuth tokens live in the OS keychain only.** Windows Credential Manager, macOS Keychain, or Linux libsecret. We use [`@napi-rs/keyring`](https://github.com/napi-rs/keyring-rs/tree/main/crates/keyring-node) to access the platform-native APIs. Tokens are never written to a file ModWrench creates.
2. **Your credentials are read from the OS credential manager only.** Whether it's an OAuth token or a raw API key, you place it in your OS credential manager (service `modwrench-<platform>`); the server only reads it. The credential loader has no environment-variable, `.env`, or file fallback. Writes happen only in `auth key` / `auth login` / `auth logout`, and only against that same credential manager.

   One narrow exception, stated rather than omitted: `auth login nexus` reads `NEXUS_OAUTH_CLIENT_ID` and `NEXUS_OAUTH_CLIENT_SECRET` from the environment. Those are OAuth *application* credentials that Nexus issues to whoever operates an application — they are not your account credential, and your key still never comes from the environment.
3. **No telemetry. Ever.** ModWrench makes no outbound network connections except to the platforms whose APIs you've configured (Nexus Mods, mod.io, Thunderstore, GitHub for LOOT masterlist fetches). There is no analytics endpoint. One call follows a URL rather than a fixed host: `nexus_file_preview` fetches the `content_preview_link` that the Nexus API returns for a file, with no credential attached (`packages/nexus/src/register.ts`).
4. **Logs go to stderr as JSON.** API keys and OAuth tokens are never logged. If you find one in a log line, that's a vulnerability — report it.
5. **The repo enforces secret-scanning at the GitHub layer** (partner patterns + push protection) plus a custom [gitleaks workflow](.github/workflows/gitleaks.yml) that catches Nexus and mod.io key shapes specifically. Commits containing credential-shaped strings are blocked before landing.

## Supported versions

ModWrench is pre-1.0. We support the latest commit on `main` and the most recent published release (when one exists). We will not backport security fixes to older releases until we've shipped a 1.0 with a documented LTS policy.

## Coordinated disclosure timeline

Our default timeline is **90 days from receipt to public disclosure**. Faster disclosure is fine if a fix is available sooner; slower disclosure is fine if the patch requires more time and the vulnerability is not being actively exploited. We will coordinate with you on the actual schedule once we've assessed the report.

We will not embargo a fix for marketing reasons or to align with a release. Security fixes ship as soon as they're ready, with the advisory published alongside the release.

## Credit

Security researchers who report vulnerabilities responsibly will be credited (with their consent) in:

- The GitHub Security Advisory
- The release notes for the patched version
- A `SECURITY-CREDITS.md` file once we have more than one entry

There is no bug bounty program. ModWrench is funded by nobody — there's no money to pay out. We will be loud and clear about your work in public if you'd like the credit.

## Questions

If you're unsure whether something is in scope, please reach out before disclosing publicly. The cost of asking is much lower than the cost of an avoidable incident.

Thank you for caring about this project's trust posture. Modders deserve tools they can trust, and you help keep that promise honest.
