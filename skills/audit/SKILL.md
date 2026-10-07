---
name: audit
description: Production-readiness audit of an Expo / React Native app — performance, startup speed, bundle size, caching, MMKV, secure storage, client security, auth & sessions, backend security (Supabase RLS or API on Vercel/Edge/Expo API routes), dependencies, SDK/OTA updates, release readiness, agent instructions and HeroUI Native. Outputs a 0–10 scored table with suggestions per category, a GO/NO-GO verdict and trend vs the previous audit. Use when the user asks to audit, review, check or score an Expo/React Native app, asks "is my app production ready", or wants a deep/multi-agent audit.
argument-hint: "[appPath] [--quick|--deep] [--api=<apiRepoPath>] [--only=perf,mmkv,...] [--out=<report.md>]"
---

# expo-es-kit · audit

You produce an evidence-based, scored audit. **You never modify app code during an audit**. The only files you write are the report `.md` and `.json`.

## 0. Locate the plugin and parse the arguments

- Set `PLUGIN_ROOT` to the plugin root, which is two levels above this SKILL.md (use the base directory shown when the skill loaded).
- If that path is unknown, run `find ~/.claude/plugins -type f -path '*expo-es-kit*/scripts/scan.mjs' 2>/dev/null | head -1` and strip `/scripts/scan.mjs`.
- Read `PLUGIN_ROOT/shared/contract.md` now. It defines category ids, severities, score caps, verdict rules and the JSON shapes. Follow it exactly.

Arguments (all optional):

| Argument | Meaning |
|---|---|
| `appPath` | The app root, i.e. the folder whose `package.json` has `expo`. Default: cwd. If cwd is not an Expo app, look one level down for one, and ask if there are several. |
| `--quick` | You judge every category yourself. |
| `--deep` | Specialist subagents plus a verification pass. |
| No mode flag | Recommend a mode and ask with AskUserQuestion. Recommend `--deep` when there are more than 150 source files, when the user mentions release/production/launch, or when the backend lives in another repo. |
| `--api=<path>` | The separate API/backend repo (e.g. a Next.js project on Vercel). If it is not given, the backend mode is `api`/`hybrid` (see step 1), and a sibling folder looks like the API (has `app/api` or `supabase/functions`), ask whether to include it. |
| `--only=<ids>` | Audit only these category ids. The other rows show "—" and are excluded from the overall score. |
| `--out=<file.md>` | Report path. Default is `docs/audits/expo-audit-YYYY-MM-DD.md` in the app root. |

Write the report prose in the user's language, keeping code identifiers in English. Category names may be translated.

## 1. Collect facts (read-only)

```bash
D="$(mktemp -d)"; SCAN="$D/scan.json"; SUMMARY="$D/scan-summary.json"
node "$PLUGIN_ROOT/scripts/scan.mjs" "<appPath>" [--api=<apiPath>] > "$SCAN"
node "$PLUGIN_ROOT/scripts/scan.mjs" "<appPath>" [--api=<apiPath>] --summary > "$SUMMARY"
```

- On a large repo each run can take 10–60 s. Read `$SUMMARY`; it is compact. Don't read the full `$SCAN` into context. Query it instead:
  - `node "$PLUGIN_ROOT/scripts/query-scan.mjs" "$SCAN" hits <ruleId>…` gives all samples for those rules.
  - `… path api.routesWithoutAuthSignal` returns any JSON path.
  - `… category <id>` gives the hit counts for one category.
- From the summary, note the following:
  - `stack` and `config` (newArch, reactCompiler, babel, eas, updates)
  - `backend.mode`
  - `env.publicSecretLooking` and `git.sensitiveTrackedFiles`
  - `claudeConfig`
  - `appMigrations` and `api`
  - the hit counts
- Hits are **signals, not findings**. Every finding needs code you actually read.
- If `stack.libs["heroui-native"]` exists, add the `heroui` category.
- Look for the previous report: the newest `docs/audits/expo-audit-*.json`, or the file next to `--out`. Keep it for the trend column.

**Optional CLI checks.** Ask once with AskUserQuestion and list the commands; all are read-only:

- `npx expo-doctor`
- `npx expo install --check`
- `npm outdated --json`
- `npm audit --omit=dev --json`

Run them from the app root with a timeout. If they fail because of the environment (e.g. no network, or a WSL/Windows `node_modules` mismatch), record "not run: <reason>" and do not guess.

**Never run** any of these: `npm install`, `npx expo install <pkg>`, `npx expo prebuild`, or anything that writes into the app.

`npx expo export` (bundle analysis) writes `dist/`. Run it only if the user explicitly asks for bundle analysis, and say that it writes `dist/`.

## 2a. Quick mode

Go through each category in this order: perf, startup, bundle, caching, mmkv, secure-storage, client-security, auth-sessions, backend, deps, updates, release, agent-config, heroui.

For each category:

1. Read `PLUGIN_ROOT/skills/audit/references/checks/<id>.md`. For `heroui`, read `PLUGIN_ROOT/skills/heroui/references/checklist.md`.
2. Start from the signals that file lists. Open the files behind the strongest hits with `Read` and targeted `Grep`. Read the central modules once: the storage wrapper, query client, supabase/api client, auth/session, root layout, and the API shared helpers listed in `api.sharedHelpers`.
3. Write findings in the contract's Finding JSON shape. Quick mode skips the verifier, so set `verified` like this:
   - `confirmed`: you read the code and it is unambiguous.
   - `unverified`: anything else.
   - Downgrade `unverified` P0/P1 findings one level.
4. Score the category with `PLUGIN_ROOT/skills/audit/references/scoring-rubric.md` and apply the contract caps.

Budget: about 3–8 file reads per category, and more only for P0 suspicions.

## 2b. Deep mode (multi-agent)

**Launch the specialists in parallel, in a single message.** Use subagent types from this plugin:

| Agent | Categories |
|---|---|
| `expo-es-kit:perf-auditor` | perf, startup |
| `expo-es-kit:bundle-deps-auditor` | bundle, deps, updates (gets the CLI check outputs if you ran them) |
| `expo-es-kit:storage-cache-auditor` | caching, mmkv, secure-storage |
| `expo-es-kit:client-security-auditor` | client-security |
| `expo-es-kit:auth-session-auditor` | auth-sessions (app + API repo) |
| `expo-es-kit:backend-auditor` | backend (migrations/RLS and/or API routes) |
| `expo-es-kit:release-auditor` | release, agent-config |
| `expo-es-kit:heroui-auditor` | heroui (only if HeroUI Native is installed) |

Give each agent the following prompt, filled in:

```
App root: <abs path>
API root: <abs path or "none">
Plugin root: <abs PLUGIN_ROOT>
Scan JSON (full, query with PLUGIN_ROOT/scripts/query-scan.mjs): <abs $SCAN>
Scan summary (read this): <abs $SUMMARY>
Backend mode: <mode> (signals: ...)
Stack: <expo, rn, router, key libs>
Categories to audit: <ids>
CLI outputs (if any): <short excerpts or "not run">
Previous audit findings for your categories (if any): <ids + titles + status>
Return exactly one JSON block in the contract's "Agent output" shape.
```

If the plugin agent types are not available, use `general-purpose`. Paste the agent file's body (from `PLUGIN_ROOT/agents/<name>.md`) at the top of its prompt.

**Verification pass.**

- Collect every P0/P1 finding and split them into batches of 12 or fewer.
- Launch the `expo-es-kit:finding-verifier` agents in parallel, at most 3 at a time. Each gets its findings JSON, the app/API roots and the plugin root.
- Apply each verdict:
  - `confirmed`: keep.
  - `downgraded`: lower the severity as the verifier says.
  - `rejected`: move to `rejected[]` and drop it from the report.
- Re-apply the score caps after verification. If the verifier's evidence changes the picture, adjust the agent's proposed score by at most ±1.5, and say why in the category rationale.

## 3. Aggregate

- `overall` is the weighted average over non-`n/a` categories, using the contract weights.
- Compute `verdict` using the contract rules.
- `topFixes` is the 10 best impact/effort items:
  - All P0 first.
  - Then P1 sorted by effort S → M → L.
  - Then P2 only if there are fewer than 10 P0/P1 items.
- Trend for each category is score minus the previous score: `▲ +x`, `▼ -x`, `—` or `new`.
- Mark findings that also appeared in the previous report (same title and file) as **recurring**.

## 4. Write and print

1. Write the markdown report following `PLUGIN_ROOT/skills/audit/references/report-template.md`. Write the JSON (contract "Report JSON") next to it with the same basename.
   - Create `docs/audits/` if it is missing.
   - If today's file exists, add the suffix `-2`, `-3` and so on.
2. Print in the terminal:
   - the header line (overall score, verdict, trend)
   - the **summary table**
   - the **Top 10 fixes** table
   - "What was not checked"
   - the path of the saved report
   - a one-line next step, e.g. `Run /expo-es-kit:fix --only=P0 to fix the blockers (it re-verifies everything at the end).`
3. If the `agent-config` score is 7 or lower, also suggest `/expo-es-kit:setup`. If a HeroUI row exists and scores 7 or lower, suggest `/expo-es-kit:heroui setup`.

## Rules

- **Evidence or it didn't happen.** Every finding has a `file:line` and an evidence snippet. Heuristic-only signals go in the category rationale, not in findings.
- **Never print secret values.** Write `EXPO_PUBLIC_STRIPE_SECRET (value redacted)`, never the value. Never open `.env` files to read values; the scan already lists the key names.
- **Read shared code before blaming call sites.** Before flagging 200 routes, read the auth guard, handler wrapper and middleware they use. The same goes for the app's storage and query wrappers.
- **Respect documented decisions.** If the repo's docs or CLAUDE.md explain a deliberate trade-off (e.g. "FlashList removed after a measured regression"), don't flag it as a defect. Mention it as an accepted decision, and flag only if the evidence contradicts it.
- **Be calibrated.** A 10 means you looked and found nothing to improve. Don't inflate scores to be nice, or deflate them to look thorough.
- Keep the terminal output scannable: tables first, prose last.
