---
name: security
description: "In-depth security audit of an Expo / React Native app and its backend: secret leaks (code, bundle, env, git history), SQL/PostgREST and other injection traced from every input to its sink, sensitive data in URLs and deep links, cross-user/tenant access (IDOR, RLS), auth, platform and API hardening. Scored per area with an OWASP matrix. Use for a security audit, pentest prep, \"is my app secure\", or injection/IDOR/leak checks."
argument-hint: "[appPath] [--api=<apiRepoPath>] [--quick|--deep] [--history] [--probe] [--only=<areas>] [--out=<report.md>]"
---

# expo-es-kit · security

You produce an evidence-based security audit: one score per area, an OWASP coverage matrix, the access matrix, the input→sink table and findings with `file:line`. **You never modify app code, never touch production and never print a secret.** The only files you write are the report `.md` and `.json`.

## 0. Locate the plugin and parse the arguments

- `PLUGIN_ROOT` is two levels above this SKILL.md (the base directory shown when the skill loaded). If unknown, run
  `find ~/.claude/plugins ~/.codex ~/.cursor/plugins ~/.agents -type f -path '*expo-es-kit*/scripts/security-scan.mjs' 2>/dev/null | head -1` and strip `/scripts/security-scan.mjs`.
- Read `PLUGIN_ROOT/shared/contract.md` (severities, caps, verdict, Finding JSON with `area`, the **Security audit** section) and `PLUGIN_ROOT/skills/security/references/methodology.md`.

| Argument | Meaning |
|---|---|
| `appPath` | The Expo app root. Default: cwd (look one level down if needed; ask if several). |
| `--api=<path>` | The separate API/backend repo. If missing and the backend mode is `api`/`hybrid`, look for a sibling with `app/api`, `supabase/functions` or `pages/api` and ask whether to include it. |
| `--quick` | You audit every area yourself. |
| `--deep` | Six specialist subagents in parallel, then a verification pass. Recommended before a release. |
| No mode flag | Recommend one and ask. Recommend `--deep` when there are >150 source files, a separate API repo, payments/health/finance data, or the user mentions release, pentest or compliance. |
| `--history` | Also scan git history for secrets (slower). Ask once if not given: leaked-then-deleted secrets are a common P0. |
| `--probe` | Optional dynamic tests (step 5). Off by default. |
| `--only=<areas>` | Subset of `secrets,access-control,injection,auth,url-exposure,data-exposure,platform,api-hardening,supply-chain`. |
| `--out=<file.md>` | Default `docs/audits/security-audit-YYYY-MM-DD.md` in the app root. |

Write the report prose in the user's language; code identifiers stay in English.

## 1. Collect facts (read-only)

```bash
D="$(mktemp -d)"
node "$PLUGIN_ROOT/scripts/scan.mjs" "<app>" [--api=<api>] > "$D/scan.json"
node "$PLUGIN_ROOT/scripts/scan.mjs" "<app>" [--api=<api>] --summary > "$D/scan-summary.json"
node "$PLUGIN_ROOT/scripts/security-scan.mjs" "<app>" [--api=<api>] [--history] > "$D/sec.json"
node "$PLUGIN_ROOT/scripts/security-scan.mjs" "<app>" [--api=<api>] [--history] --summary > "$D/sec-summary.json"
```

- Read both **summaries**. Query the full files instead of reading them: `node "$PLUGIN_ROOT/scripts/query-scan.mjs" "$D/scan.json" hits <ruleId>` / `path <dot.path>`, and `node -e` on `$D/sec.json` (e.g. `inputSurfaces`, `rls.policies`, `hits["mass-assignment"].samples`).
- From the summaries note: `backend.mode`, `stack`, `security areas` overview, `env.publicSecretLooking`, `git.sensitiveTrackedFiles`, `rls.issues`, `sqlDynamic`, `urlParams`, `webHardening`, `supplyChain`, `gitHistorySecrets`.
- Hits are **signals, not findings**. Every finding needs code you read.
- Previous report: newest `docs/audits/security-audit-*.json` (for the trend and recurring findings).
- Optional read-only CLI check (ask first): `npm audit --omit=dev --json` in the app and the API repo. Never `npm install`, never build, never run the app.

## 2. Threat model (10 lines, goes into the report)

Assets (accounts, personal/health/payment data, files, money), actors (anonymous, user, other user, tenant member, admin, attacker with the APK/IPA), trust boundaries for the backend mode (direct-db: RLS is the boundary; api: the route handler is; hybrid: both), entry points (inputs, deep links, push, webhooks, public routes). Use it to prioritize.

## 3a. Quick mode

Work through the areas in this order, using `PLUGIN_ROOT/skills/security/references/`:

| Area | Reference | Also use |
|---|---|---|
| secrets, data-exposure | `secrets-and-exposure.md` | `skills/audit/references/checks/client-security.md` |
| access-control | `access-control.md` | `skills/backend/references/direct-db-supabase.md`, `skills/backend/references/api-security-checklist.md` |
| injection | `injection.md` (trace the top input surfaces) | |
| url-exposure | `urls-and-deeplinks.md` | |
| auth | `skills/audit/references/checks/auth-sessions.md` | `skills/backend/references/auth-sessions.md` |
| platform | `mobile-platform.md` | `skills/audit/references/checks/secure-storage.md` |
| api-hardening, supply-chain | `api-hardening.md` | `skills/audit/references/checks/deps.md` |

Read shared code once (API client, Supabase client, route wrapper, middleware, auth module, logger/analytics). For each area: findings in the contract shape with `area` set; `verified: "confirmed"` when the code is unambiguous, else `unverified` and downgrade unverified P0/P1 one level. Score each area (0–10, caps). Budget ~5–10 reads per area, more for P0 suspicions.

## 3b. Deep mode (multi-agent)

If your tool supports subagents, **launch these in parallel in one message** (Claude Code: subagent types below; Cursor/Codex: their subagents with the same instructions). Otherwise run each agent's instructions from `PLUGIN_ROOT/agents/<name>.md` yourself, one after another.

| Agent | Areas |
|---|---|
| `expo-es-kit:injection-auditor` | injection (input→sink table) |
| `expo-es-kit:access-control-auditor` | access-control (access matrix) |
| `expo-es-kit:exposure-auditor` | secrets, url-exposure, data-exposure |
| `expo-es-kit:auth-session-auditor` | auth (category `auth-sessions`, app + API) |
| `expo-es-kit:client-security-auditor` | platform (ask it to also apply `skills/security/references/mobile-platform.md`) |
| `expo-es-kit:backend-auditor` | api-hardening + supply-chain (ask it to apply `skills/security/references/api-hardening.md`) |

Prompt for each (filled in):

```
App root: <abs> · API root: <abs or "none"> · Plugin root: <abs PLUGIN_ROOT>
Scan JSON: <abs> (summary: <abs>) · Security-scan JSON: <abs> (summary: <abs>)
Backend mode: <mode> · Stack: <expo, rn, supabase, api framework, orm>
Areas to audit: <ids> · Threat model: <the 10 lines>
Previous security findings for your areas: <ids + titles + status or "none">
Set "area" on every finding. Return exactly one JSON block in the contract's "Agent output" shape (one category object per area, id = area id).
```

If plugin agent types are unavailable but generic subagents are, paste the agent file's body at the top of the prompt.

**Verification pass (mandatory in deep mode).** Batch every P0/P1 (≤12 per batch, ≤3 batches at a time) to `expo-es-kit:finding-verifier` with `mode: audit`. Apply verdicts (confirmed / downgraded / rejected → `rejected[]`), re-apply caps, adjust area scores by at most ±1.5 with a reason.

## 4. Fill the matrices

- **OWASP matrix** — `PLUGIN_ROOT/skills/security/references/owasp-mapping.md`: one row per Mobile Top 10 (2024) and API Top 10 (2023) item: ✅ checked and passing · ❌ has a finding (list ids) · ⚪ n/a or not checkable statically.
- **Access matrix** — from the access-control work: `| Resource | Role | Op | Allowed by | Scoped by | Verdict |` for the main resources.
- **Input → sink table** — from the injection work: `| Input | Screen/file | Sink | Parameterized | Validated | Verdict |` for every traced surface.

## 5. Optional probes (`--probe` only)

Follow `PLUGIN_ROOT/skills/security/references/probes.md` exactly. Before anything runs, confirm with AskUserQuestion: the target is **localhost or a preview/branch environment** the user names (never production), the user supplies **two test accounts** (A and B), and the list of probes. Never destructive, bursts capped, no real user data. Record results in `probes[]`; a failed probe confirms (or creates) a finding. If not run, write "probes: not run" under Not checked.

## 6. Aggregate, write, print

- Area scores → `securityScore` (weighted, contract table) and `verdict` (any confirmed P0 ⇒ NO-GO). Also score the four security `categories` (`secure-storage`, `client-security`, `auth-sessions`, `backend`) from the findings so `fix` and `history` can use them.
- Top fixes: all P0, then P1 by effort S→M→L.
- Trend vs the previous security audit; mark recurring findings.
- Write `docs/audits/security-audit-YYYY-MM-DD.md` (suffix `-2`… if it exists) and the JSON (contract "Security audit" shape) next to it. Markdown sections, in order:
  1. Header: app, stack, backend mode, mode, date · **Security score x.x/10 · verdict · trend**
  2. Summary table: `| Area | Score | Trend | Status | Key finding | Top fix |`
  3. Top fixes table: `| # | ID | Sev | Area | Fix | Effort | File |`
  4. Threat model
  5. OWASP matrix · 6. Access matrix · 7. Input → sink table
  8. Findings per area (evidence, impact, fix, effort, confidence, verified)
  9. Probes (or "not run") · 10. Not checked (static limits, history not scanned, environments not tested) · 11. Strengths
- Print in the terminal: header line, summary table, top fixes, not checked, report path, then the next step:
  `Run /expo-es-kit:fix --only=P0 (it reads security-audit reports and re-verifies everything at the end).`
- If secrets leaked (now or in history), print the rotation steps first, before anything else.

## Rules

- **Evidence or it didn't happen.** Every finding has `file:line` and code you read. Signals without proof go in the rationale or "Not checked".
- **Never print secrets or personal data.** Key names and redacted prefixes only (`sk_live_•••`). Never open `.env*` values.
- **Read shared code before blaming call sites** (wrappers, middleware, RLS helper functions, the newest migration).
- **Respect documented decisions**, but a documented decision does not make a real exploit acceptable — report it and cite the doc.
- **Read-only.** No edits, installs, builds, migrations, database writes or requests — except probes the user explicitly approved against a non-production target.
- Be calibrated: a 10 means you looked and found nothing to improve.
