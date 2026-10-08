# OWASP mapping

This file maps OWASP risks to expo-es-kit check IDs. The `security-audit` report uses it to fill the OWASP matrix. Check IDs come from:

- `secrets-and-exposure.md` (SECR-01..08, DATA-01..08)
- `injection.md` (INJ-01..16)
- `urls-and-deeplinks.md` (URL-01..08)
- `access-control.md` (ACL-01..12)
- `mobile-platform.md` (PLAT-01..10)
- `api-hardening.md` (HARD-01..10, SUP-01..05)
- the audit check files: `skills/audit/references/checks/` (AUTH-01..17, CSEC-01..14, SEC-01..13, BE-D01..15, BE-A01..17)

Coverage legend:
- **full**: static analysis of the repos can decide it.
- **partial**: static analysis finds most issues, but config outside the repo or runtime behavior can change the answer.
- **needs probe**: only a dynamic test (`probes.md`), live DB access or binary inspection can confirm it.

## How to fill the report's OWASP matrix

One row per OWASP id, for both lists. For each row:

1. Collect the mapped check IDs below and look at the findings tagged with them (confirmed or downgraded; rejected findings do not count).
2. Pick the status:
   - **❌** at least one open finding maps to the row. Show the highest severity and the finding ids (`❌ P0 · ACL-001, ACL-004`).
   - **✅** every mapped check that applies was performed, and none failed. Name the proving file or probe (`✅ lib/api/auth.ts requireAuth on all routes; BOLA probe 12/12`).
   - **⚪ n/a** the row does not apply (e.g. API10 with no third-party APIs or webhooks; M7 for an internal app distributed via MDM, documented).
   - **⚪ not checked** a needed check could not run (no API repo, no DB access, probe not allowed). Name what is missing. It also appears under "Not checked" in the report.
3. A row whose coverage is "needs probe" can only be ✅ when the probe ran (or live state was read). Otherwise it is at best "⚪ not checked (static: no issue found)".
4. Never mark ✅ because no signal fired. Absence of a signal is not evidence.

```
| OWASP | Name | Status | Evidence |
|---|---|---|---|
| API1:2023 | Broken Object Level Authorization | ❌ P0 | ACL-001 (GET /api/v1/notes/[id] service client unscoped) |
| M9 | Insecure Data Storage | ✅ | session via SecureStore adapter (lib/supabase.ts:12), SEC-01..04 pass |
```

## OWASP Mobile Top 10 (2024)

| OWASP id | Name | expo-es-kit checks | Static coverage |
|---|---|---|---|
| M1 | Improper Credential Usage | SECR-01..08 (hard-coded keys, bundle/`EXPO_PUBLIC_*`, env files, git history, EAS/CI, logs), CSEC-01..04, ACL-03 (`service-role-in-client`), AUTH-10, SEC-01, SEC-08 | full for the repo; partial for history (`--history`) and EAS/CI values (names only) |
| M2 | Inadequate Supply Chain Security | SUP-01..05, SECR-05 (EAS / CI secrets), INJ-16 (vulnerable merge libs), CSEC-14 (third-party SDK data flow), audit `deps` category | partial (needs `npm audit` / network) |
| M3 | Insecure Authentication/Authorization | AUTH-01..17, ACL-01..12, BE-A01..A03, BE-D01..D08, URL-07 (OAuth redirect URIs), PLAT-09 (attestation is not authentication) | partial; runtime authz needs probe |
| M4 | Insufficient Input/Output Validation | INJ-01..16, URL-04 (deep link validation), URL-05 (open redirect), PLAT-04 (WebView bridge), HARD-02 (body/upload validation), CSEC-08, CSEC-09, CSEC-11, BE-A04 | full for code paths; partial for server-side validation in a repo not provided |
| M5 | Insecure Communication | PLAT-05 (cleartext, ATS, network security config), PLAT-06 (pinning), CSEC-07, URL-02 (tokens in URLs), URL-08 (referrer / browser leaks), HARD-05 (HSTS) | partial (final native config after prebuild) |
| M6 | Inadequate Privacy Controls | DATA-01..08, URL-01, URL-03, ACL-06 (column exposure), CSEC-05, CSEC-14, AUTH-14 (account deletion); privacy skill (manifests, labels) | partial (third-party consoles, logs) |
| M7 | Insufficient Binary Protections | PLAT-09 (root/jailbreak, App Attest / Play Integrity), CSEC-13 (debug builds), SECR-02 (bundle strings), CSEC-11 | needs probe / binary inspection |
| M8 | Security Misconfiguration | PLAT-04 (WebView config), PLAT-07 (exported components, intent filters), PLAT-08 (backups), URL-06 (app/universal links verification), HARD-04 (CORS), HARD-05 (headers), HARD-07 (error leaks), BE-D14 (advisors), CSEC-13, SEC-12 | partial (dashboard settings, final manifests) |
| M9 | Insecure Data Storage | SEC-01..13, PLAT-10 (local DB/files encryption), PLAT-08 (backups), DATA-05 (clipboard), DATA-06 (screenshots/app switcher), INJ-05 (SQLite integrity), AUTH-08/AUTH-09 (cross-account leftovers) | full |
| M10 | Insufficient Cryptography | CSEC-10 (secure randomness), SEC-08 (hard-coded encryption keys), SEC-05 (keychain accessibility), AUTH-13 (peppered hashes, constant-time compare), PLAT-10, HARD-03 (HMAC webhook verification) | full for code; partial for server-side key handling |

## OWASP API Security Top 10 (2023)

Implementation guidance for each row is in `skills/backend/references/api-security-checklist.md`. In direct-db mode, PostgREST + RLS + RPCs are the API.

| OWASP id | Name | expo-es-kit checks | Static coverage |
|---|---|---|---|
| API1:2023 | Broken Object Level Authorization | ACL-02, ACL-03, ACL-07, ACL-09, ACL-10, ACL-11, ACL-12, INJ-01 (filter injection removing scope), INJ-12 (storage keys), BE-A02, BE-A08, BE-D01..D05, BE-D11 | partial → needs probe (BOLA swap, RLS two-user) for ✅ |
| API2:2023 | Broken Authentication | AUTH-04, AUTH-05, AUTH-07, AUTH-11, AUTH-13, AUTH-15..17, ACL-08 (decode-only / `user_metadata`), BE-A01, URL-02, HARD-06 (cookies) | partial; token probes for ✅ |
| API3:2023 | Broken Object Property Level Authorization | ACL-05 (mass assignment), ACL-06 (column exposure), INJ-16 (merges), BE-A04, BE-D09, DATA-07 (error messages) | full for routes in repo; partial for live column grants |
| API4:2023 | Unrestricted Resource Consumption | HARD-01 (rate limits), HARD-02 (body/upload limits), HARD-08 (timeouts), INJ-02 (unbounded pattern scans), INJ-13 (ReDoS), INJ-14 (LLM cost), BE-A06, BE-A07, AUTH-11 | partial; burst and oversized-body probes for ✅ |
| API5:2023 | Broken Function Level Authorization | ACL-04, ACL-10 (definer RPCs, `execute` grants), ACL-08, BE-A03, BE-A10 (cron/internal routes) | partial; probe admin routes with a user token |
| API6:2023 | Unrestricted Access to Sensitive Business Flows | HARD-01, HARD-09 (idempotency), AUTH-11, AUTH-13, PLAT-09 (attestation on abuse-prone flows), BE-A12 | partial (business context needed) |
| API7:2023 | Server Side Request Forgery | INJ-11, INJ-14 (LLM tools that fetch URLs), BE-A17 | full for code paths |
| API8:2023 | Security Misconfiguration | HARD-04, HARD-05, HARD-06, HARD-07, ACL-01, ACL-10 (views `security_invoker`, `search_path`), BE-D07, BE-D08, BE-D14, BE-A11, BE-A13, SECR-06 (server env never reaches a client), SECR-07 (third-party key restrictions) | partial (dashboard / platform settings) |
| API9:2023 | Improper Inventory Management | ACL-01 (exposed surface inventory), BE-A14, BE-A15, HARD-10 (logging/monitoring), access matrix completeness | partial (deployed vs repo diff needs access) |
| API10:2023 | Unsafe Consumption of APIs | HARD-03 (webhook signatures), HARD-09 (idempotent events), INJ-09 (third-party content in HTML), INJ-14 (LLM output), INJ-11, BE-A09, BE-A17 | full for code paths |

## Row notes (common mistakes)

- **M3 vs API1/API5:** in direct-db mode the app's "authorization" is RLS, so M3, API1 and API5 share the same evidence: access matrix, two-user test and definer-function review. Do not mark M3 ✅ just because the client has an auth gate on its screens. Client-side route guards are UX, not authorization.
- **M1 and the Supabase public key:** the anon / publishable key in the bundle is not a credential leak (see CSEC-02). M1 fails on server secrets, signing material, user tokens in logs, or credentials in git history.
- **M4 covers both directions:** input validation (INJ-*, deep links) and output encoding (WebView HTML, emails, markdown, LLM output). A route with zod on input but raw HTML in its email template still fails M4.
- **M5 and pinning:** missing certificate pinning alone is not ❌. PLAT-06 is a deliberate trade-off (rotation risk). Cleartext traffic in release builds or tokens in URLs are ❌.
- **M7 is rarely ✅ statically:** Hermes bytecode is not obfuscation. Without binary inspection or attestation evidence, use "⚪ not checked", or ⚪ n/a when the documented risk profile excludes it.
- **API4 / API6 need numbers:** a rate limiter in code is not proof. Record the configured limits (route + window + key) and, with `--probe`, the observed 429 threshold.
- **API9 inventory:** the access matrix plus the route list (`api.*`), Edge Functions with their `verify_jwt` mode, and the RPCs executable by `anon`/`authenticated` together form the inventory. A route or RPC missing from it is itself a finding (ACL-01).
- **API10 includes LLMs and webhooks:** third-party responses, webhook bodies and model output are untrusted input. HARD-03 (signature) and HARD-09 (idempotent event table) are both required for ✅.
- **One finding, several rows:** a single finding may mark several rows ❌. For example, a service-role route without an owner filter marks API1, M3 and MASVS-AUTH. List it in each row, but count it once in scores.

## OWASP MASVS v2 (short mapping)

MASVS v2.1 groups controls into eight categories (MASVS-PRIVACY was added in v2.1). Use this mapping when a user or reviewer asks for MASVS rather than the Top 10.

| MASVS | Focus | Check IDs |
|---|---|---|
| MASVS-STORAGE | Sensitive data at rest, no leaks to logs/backups/clipboard | SEC-01..13, PLAT-08, PLAT-10, DATA-01, DATA-05, DATA-08 |
| MASVS-CRYPTO | Strong crypto, proper key management, secure randomness | CSEC-10, SEC-08, SEC-05, AUTH-13, PLAT-10 |
| MASVS-AUTH | Secure auth and authorization, sessions, local auth (biometrics) | AUTH-01..17, ACL-01..12, BE-A01..A03, URL-07 |
| MASVS-NETWORK | TLS everywhere, pinning where justified | PLAT-05, PLAT-06, CSEC-07, URL-02 |
| MASVS-PLATFORM | IPC, deep links, WebViews, UI (screenshots, keyboard, autofill) | URL-04, URL-05, URL-06, PLAT-01..04, PLAT-07, CSEC-08, CSEC-09, CSEC-12, INJ-07 |
| MASVS-CODE | Up-to-date platform, dependency hygiene, input validation | SUP-01..05, INJ-01..16, CSEC-11, CSEC-13, HARD-02 |
| MASVS-RESILIENCE | Anti-tampering, integrity, attestation, anti-debugging | PLAT-09, CSEC-13, SECR-02 (strings in bundle) |
| MASVS-PRIVACY | Data minimization, transparency, user control | DATA-01..08, URL-01, URL-03, CSEC-14, AUTH-14, privacy skill outputs |

MASVS-RESILIENCE is optional for most apps (MAS profile "R"). Mark it ⚪ n/a unless the app handles payments, high-value content or regulated data, or the user asks for it.
