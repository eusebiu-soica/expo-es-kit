---
name: fix
description: Apply the findings of an expo-es-kit audit to an Expo / React Native app in priority order (P0 first), then run a mandatory end-to-end verification — typecheck, lint, tests, expo-doctor, per-finding verification by an independent agent, regression scan and re-audit of the touched categories — and report before/after scores. Use when the user says "fix the audit", "apply the fixes", "fix P0", or after /expo-es-kit:audit.
argument-hint: "[report.json] [--only=P0|P0,P1|<finding ids>|<category ids>] [--yes]"
---

# expo-es-kit · fix

You turn audit findings into verified code changes. **You are not done until the final verification (step 5) has run and its results are reported honestly.**

## 0. Setup

- `PLUGIN_ROOT` is two levels above this SKILL.md. If unknown, use `find ~/.claude/plugins -type f -path '*expo-es-kit*/scripts/scan.mjs' | head -1` and strip `/scripts/scan.mjs`.
- Read `PLUGIN_ROOT/shared/contract.md`.
- Find the report:
  - Use the argument if given.
  - Otherwise use the newest `docs/audits/expo-audit-*.json` in the app root.
  - If there is none, say so and offer to run `/expo-es-kit:audit` first. Don't guess the findings.
- Choose the findings to work on:
  - Default: `status: "open"` with severity P0 and P1.
  - `--only` narrows the set by severity, by finding ids, or by category ids.
  - Skip `wontfix`.
- **Baseline**:
  - Run `node "$PLUGIN_ROOT/scripts/scan.mjs" <app> > "$TMP/scan-before.json"`.
  - Check the git state with `git status --porcelain`. If the tree is dirty, tell the user and suggest they commit or stash first, so the fix diff is reviewable. Don't stash for them.
  - Detect project commands from `package.json` scripts: typecheck (`tsc --noEmit` or a `typecheck` script), lint, test.
  - Run them once now. This tells you which failures already existed, so you never blame (or hide) failures that predate your changes.

## 1. Plan

Group the findings into batches:

- by category and file proximity
- at most about 6 findings per batch
- P0 batches first

Show the user a plan table: `| Batch | IDs | Sev | Files | What changes | Risk | Needs native rebuild? |`.

Then ask for confirmation with AskUserQuestion. The options are: all batches / batch by batch / only P0 / adjust. `--yes` skips this prompt but still shows the plan.

Flag the following and ask about them explicitly; never do them silently:

- changes to auth or session flows
- DB migrations
- removing data
- dependency upgrades
- anything that changes user-visible behaviour

## 2. Apply, one batch at a time

For each finding:

1. Re-read the cited code. The audit may be stale. If it no longer applies, mark it `fixed` (if it was already resolved) or `wontfix` (if it is not applicable), with a reason.
2. Implement the fix the report suggests, or an equivalent fix that fits the codebase.
   - Prefer the project's existing modules (its storage wrapper, API client, query keys).
   - Foundation templates exist at `PLUGIN_ROOT/skills/foundation/templates/code/`; adapt them, don't paste them blindly.
   - For backend findings, use `PLUGIN_ROOT/skills/backend/references/*`.
   - For HeroUI findings, use `PLUGIN_ROOT/skills/heroui/references/*`.
3. Keep each diff minimal and local: no drive-by refactors and no formatting churn.

Dependency changes: never run installs from a different OS than the one the project normally uses (for example, a project worked on from Windows must not get `npm install` from WSL). Tell the user the exact command, e.g. `npx expo install expo-image`, and wait for them to run it.

DB migrations: write new migration files only. Never edit applied migrations, and never apply migrations to a remote DB yourself.

After each batch, run typecheck and lint scoped to the changed files where the tools allow it (e.g. `npx eslint <files>`). Fix what you broke before starting the next batch.

## 3. Native and config changes

If you touched any of the following, collect a **"Rebuild required"** note for the final report:

- `app.json` / `app.config.*`
- config plugins
- native dependencies
- `eas.json`
- `babel.config.js` / `metro.config.js`

Metro reload is not enough for these. Runtime verification needs a new dev-client or preview build.

## 4. Update the report data

Set each finding's `status`:

- `fixed` / `partial` / `open` (the attempt failed) / `wontfix`
- add `fixNote`: one line on what changed, with `file:line`

## 5. Final verification (mandatory, run all steps)

### 5.1 Project gates

Run the full commands, not just the scoped ones:

- typecheck
- lint (with `--max-warnings=0` if the project's script uses it)
- tests
- `npx expo-doctor`
- `npx expo install --check`
- `npm audit --omit=dev --audit-level=high`, if deps changed

Ask once before running the set. Compare the results with the baseline from step 0:

- **new failure** → you must fix it or report it as a regression
- **pre-existing failure** → report it, but it is not yours

### 5.2 Independent per-finding verification

Launch `expo-es-kit:finding-verifier` in `fix` mode for every finding you marked `fixed` or `partial`. Use batches of 12 or fewer, run up to 3 in parallel, and launch them in one message. If the plugin agent type is unavailable, use `general-purpose` with the agent body from `PLUGIN_ROOT/agents/finding-verifier.md`.

The verifier's verdict overrides yours:

- `not-fixed` → status `open`
- `partial` → status `partial`

### 5.3 Regression scan

Run `scan.mjs` again into `$TMP/scan-after.json`. Diff the two with `node "$PLUGIN_ROOT/scripts/diff-scans.mjs" "$TMP/scan-before.json" "$TMP/scan-after.json" --changed=<comma-separated changed files from git diff --name-only>` and report:

- the counts per rule id
- any **new** guard-rule hits (rules with `guard: true` in `scripts/rules.mjs`) in the changed files

New P0/P1 signals in the changed files must be investigated. Either fix them, or explain why they are false positives.

### 5.4 Re-audit of the touched categories

Run the audit procedure (`PLUGIN_ROOT/skills/audit/SKILL.md`) **only for the categories you touched**, in the same mode as the original report (quick or deep). This gives the new scores. Untouched categories keep their old scores, marked "not re-audited".

### 5.5 Report

Write `docs/audits/expo-fix-YYYY-MM-DD.md` and `.json` (contract `"type": "fix"`, with `before` scores) and update the source audit JSON statuses. Print the following:

| Category | Before | After | Δ | Fixed | Partial | Still open |
|---|---|---|---|---|---|---|

- **Gates**: typecheck ✅/❌, lint ✅/❌, tests ✅/❌ (n passed / n failed), expo-doctor ✅/❌, deps check ✅/❌. Include the failing output excerpts.
- **Verifier results** per finding id.
- **Regressions**: none, or a list.
- **Rebuild required**: yes or no, with the reason.
- **Verdict now**: GO / GO WITH RISKS / NO-GO, using the contract rules on the merged scores.
- **Next steps**: what is left, and whether to run a full `/expo-es-kit:audit --deep` before release.

## Honesty rules

- Never say "all fixed" unless every selected finding is verifier-`fixed` and every gate is green or failed the same way before you started.
- If you could not run a gate (environment, missing script, no network), write "not run: <reason>". Never write "passed".
- Never weaken a check to make it pass. That includes:
  - disabling lint rules
  - adding `@ts-ignore`
  - skipping tests
  - loosening RLS
  - widening CORS
- If a fix needs a product decision (e.g. "delete legacy AsyncStorage data on upgrade?"), stop and ask.
