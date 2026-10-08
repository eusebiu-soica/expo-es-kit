# Security audit methodology

How the `security` skill turns scan signals into a scored, evidence-backed `security-audit` report. It complements `shared/contract.md` and does not replace it: severities, caps, verdict and Finding JSON come from the contract.

## 1. Threat model in 10 lines

1. **Assets:** user sessions and refresh tokens, personal and sensitive data (health, finance, messages, media), server secrets (service role / secret key, Stripe, LLM and email keys), money flows (payments, credits, entitlements), and the integrity of business state.
2. **Attacker A, the user-attacker:** has the decompiled app (every endpoint, public key, request shape), a valid account, unlimited requests and curl. This is the default attacker.
3. **Attacker B, other parties:** other apps on the device (deep links, custom schemes, clipboard), a network observer, someone holding a lost or shared device, and malicious content (links, HTML, documents, LLM input).
4. **Attacker C, the supply chain:** compromised packages, install scripts, CI secrets and leaked git history.
5. **Direct-db trust boundary:** PostgREST/RPC/Storage/Realtime with the public key **plus RLS**. Every table, view, function and bucket in exposed schemas is an API endpoint.
6. **API trust boundary:** route handlers (Next.js on Vercel, Supabase Edge, Expo API Routes) that verify the JWT and authorize every object. Behind them, the DB is usually reached with a privileged client, so the route **is** the policy.
7. **Hybrid:** both of the above. The extra risk is a table that is "meant to be API-only" but still has client policies or grants.
8. **On the device:** nothing in the bundle, `EXPO_PUBLIC_*`, `app.config` or `eas.json` is secret. Device storage is trusted only through SecureStore / the Keychain / the Keystore.
9. **Third parties:** webhook senders, OAuth providers, LLMs and URLs fetched by the server send input that is untrusted until verified.
10. **Out of scope unless asked:** physical attacks on an unlocked device, nation-state network interception, and infrastructure you do not control (the Supabase/Vercel platforms themselves).

Write the 10 lines for the concrete app at the top of the report: name its real assets, its `backend.mode`, its API framework and its roles.

## 2. Inputs and modes

Run `scripts/scan.mjs` (`backend.mode`, `appMigrations.*`, `api.*`) and `scripts/security-scan.mjs` (`inputSurfaces`, `rls`, `sqlDynamic`, `urlParams`, `webHardening`, `supplyChain`, `hits`, opt-in `gitHistorySecrets` with `--history`). Query the full JSON by path, and do not paste it into context.

| | Quick | Deep |
|---|---|---|
| Who | One agent does every area | Specialist passes per area group in parallel, then a verification pass |
| Breadth | Every P0/P1 signal; sample of 3–5 routes, tables and input surfaces per area, chosen by risk | Every route, table, RPC, bucket and input surface with a sink |
| Matrices | Access matrix for the sampled resources; input→sink table for the top surfaces | Full access matrix, full input→sink table, full OWASP matrix |
| Verification | The auditor confirms a P0/P1 by reading the cited line plus its call sites | An independent verifier re-reads every P0/P1 and sets `verified` |
| Probes | Never | Only with `--probe` after explicit confirmation (see `probes.md`) |

Suggested deep split, in five groups:
1. secrets + data-exposure
2. access-control
3. injection + url-exposure
4. auth + platform
5. api-hardening + supply-chain

Every group reads the shared wrappers once (§4) and returns contract-shaped findings with `area` set.

## 3. Order of work

Work through the areas in this order. Each one changes how the next ones are judged.

1. **secrets** (`secrets-and-exposure.md`): a leaked service key makes every later control moot. It is the first P0 to look for, and it means "rotate".
2. **access-control** (`access-control.md`): build the access matrix. It defines which injection or URL issue actually crosses a boundary.
3. **injection** (`injection.md`): trace inputs to sinks, using the matrix to rank them (privileged sink > user-scoped sink > client-only).
4. **url-exposure** (`urls-and-deeplinks.md`): tokens and PII in URLs, deep links, redirects.
5. **auth** (`skills/audit/references/checks/auth-sessions.md`, `skills/backend/references/auth-sessions.md`): AUTH-* checks, plus cross-account cache leaks.
6. **platform** (`mobile-platform.md`): device-side controls.
7. **api-hardening** (`api-hardening.md`): rate limits, validation, webhooks, headers, errors.
8. **supply-chain** (`api-hardening.md`, SUP-*): lockfile, audit, install scripts.
9. **data-exposure** (`secrets-and-exposure.md`, DATA-*): runs alongside secrets and is scored on its own.

Area → contract category for findings:

| Area | Category |
|---|---|
| secrets, data-exposure | `client-security` (or `backend` when the leak is server-side: API logs, error bodies) |
| access-control | `backend`; client cache leaks go to `auth-sessions` |
| injection | `backend` for server/DB sinks; `client-security` for device/web sinks |
| url-exposure | `client-security`; tokens in URLs go to `auth-sessions` |
| auth | `auth-sessions` |
| platform | `client-security`; at-rest storage goes to `secure-storage` |
| api-hardening | `backend` |
| supply-chain | `client-security` for the app repo, `backend` for the API repo |

## 4. Evidence bar

- **Signals are not findings.** A rule hit or scan path tells you where to look. Every finding needs `file`, `line`, an `evidence` snippet you read, and a one-line source→sink or actor→action story in `impact`.
- **Read shared code first.** Read these before judging any single file:
  - the API client
  - the Supabase client factory
  - the auth helper / `requireAuth`
  - the handler wrapper
  - `middleware.ts` / `proxy.ts` (Next.js 16) and its matchers
  - `api.sharedHelpers`
  - the validation helper
  - the RLS helper functions

  A guard in the wrapper clears 40 route hits at once, and a bug in it is one finding with a blast radius, not 40 findings.
- **Trace across repos.** For API mode, follow the app call (`inputSurfaces[].sinks`) to the route file by path and method. A missing check on one side may be done on the other: the server side is what counts.
- **Prove exploitability, or downgrade.** A P0 needs a concrete path: who (anon / any user / member), how (request or call), and what they get. If one link is inferred rather than read, set `confidence: medium`. Quick mode then downgrades it one level as `unverified`.
- **Live state beats migrations.** Migrations can drift from the database. Use the Supabase MCP (`execute_sql` read-only, `get_advisors`) or a schema dump when available. Otherwise say "migrations only" in Not checked.
- **Respect documented decisions.** Read `CLAUDE.md`, `docs/architecture/*`, `SECURITY.md`, ADRs and inline `// security:` comments. A documented, reasoned decision turns a P1/P2 into an accepted risk (`status: "wontfix"`, listed under "Accepted risks"). Anon read access on a public catalog is one example. A P0 is always reported, even if documented, with the note "documented as accepted".
- **One root cause, one finding.** Group repeated instances under the shared cause and list the affected files in `evidence`.
- **Never print secret values or full tokens.** Show the variable name, the key prefix (`sb_secret_…`), or a redacted snippet.

Finding JSON is the contract shape plus the optional `"area": "secrets | injection | url-exposure | access-control | auth | platform | api-hardening | data-exposure | supply-chain"`. Finding ids use the area prefixes `SECR INJ URL ACL PLAT HARD DATA SUP`, numbered per report (`ACL-001`); auth findings keep `AUTH`. Check IDs such as `INJ-01` are stable references used in the text and in the OWASP matrix.

## 5. Area scoring

Score each area 0–10 in 0.5 steps with the general anchors in `skills/audit/references/scoring-rubric.md`. Apply the contract caps per area:

- a confirmed **P0** in the area → **≤ 4**
- a confirmed **P1** → **≤ 7**
- stacking: 2 independent P1s → ≤ 6.5; 3+ → ≤ 6
- `unverified` P0/P1 do not cap, but cost up to 1 point by judgment
- an area where key checks could not be performed (e.g. no API repo, no DB access) scores at most **8**, with the reason in "Not checked"

An area is `n/a` only when it truly does not apply:
- `access-control` / `api-hardening` with `backend.mode = none` and no API
- `injection` never (a WebView, search box or deep link always exists); score it high when clean

**Overall security score** = Σ(area score × weight) / Σ(weight) over non-`n/a` areas, one decimal.

| Area | Weight |
|---|---|
| secrets | 1.5 |
| access-control | 1.5 |
| injection | 1.5 |
| auth | 1.5 |
| url-exposure | 1.0 |
| data-exposure | 1.0 |
| platform | 1.0 |
| api-hardening | 1.0 |
| supply-chain | 0.5 |

Area scores are for this report only. When the same findings feed a regular audit, they are re-scored there under their contract categories.

## 6. Verdict

Same rules as the contract:
- **NO-GO** when there is any confirmed P0.
- **GO WITH RISKS** when there is no P0 but there is a confirmed P1 (all security findings live in `secure-storage`, `client-security`, `auth-sessions` or `backend`), or the overall score is < 7.
- **GO** otherwise.

Print the verdict with the top fixes, ordered by severity, then blast radius, then effort.

## 7. Report sections specific to `security-audit`

1. **Threat model:** the 10 lines, made concrete.
2. **Area table:** score, status icon, key finding and top suggestion per area.
3. **Access matrix:** see `access-control.md`.
4. **Input→sink table:** see `injection.md`.
5. **OWASP matrix:** Mobile Top 10 2024 + API Top 10 2023, see `owasp-mapping.md`.
6. **Findings:** grouped by area, P0 first.
7. **Accepted risks:** documented decisions.
8. **Not checked.**
9. **Probe results:** only when `--probe` ran.

## 8. "Not checked" discipline

Static analysis cannot prove the following. List each item that applies, with the reason and the probe or action that would close it:

- **Live DB state.** Policies, grants, buckets and Realtime settings applied outside migrations (dashboard edits). Close it with Supabase MCP `get_advisors` plus the §11 SQL in `direct-db-supabase.md`, or with the RLS two-user probe.
- **Dashboard-only settings.** Auth rate limits, redirect URL allow-list, leaked-password protection, Realtime "public access", Vercel deployment protection, WAF rules.
- **Runtime authorization.** BOLA/BFLA behavior of deployed routes, especially through dynamic dispatch or generic handlers. Close it with BOLA swap and token probes.
- **Rate limits and body limits** actually enforced by the platform. Close it with burst and oversized-body probes.
- **Logs and third parties.** Whether URLs, tokens or PII appear in Vercel/Supabase/Sentry/analytics logs. Close it with the log-marker probe, or by asking the user to search their logs.
- **Native build output.** Final `AndroidManifest.xml`, `Info.plist`, entitlements and ATS after config plugins run. These need a prebuild or binary inspection.
- **Binary protections.** Obfuscation, tamper and root detection, and attestation effectiveness.
- **Secrets in git history** when `--history` was not run, or in CI/EAS env values (names only are visible).
- **Dependencies.** Transitive vulnerabilities when `npm audit` could not run (offline, mismatched `node_modules`).
- **Third-party consoles.** OAuth client settings, Stripe/RevenueCat webhook configuration, email provider DKIM/SPF.

Never award an area above 8 when its "Not checked" list contains a P0-class unknown. An example is access-control with no DB access and no migrations.
