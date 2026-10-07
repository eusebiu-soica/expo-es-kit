---
name: upgrade
description: "Upgrade an Expo app's SDK safely, one major version at a time (e.g. 54 → 55 → 56 → 57), with a plan from the official release notes, breaking-change edits, patch-package and library compatibility checks, OTA/runtimeVersion safety, and verification gates after every step (typecheck, lint, tests, expo-doctor, dev-client rebuild + device smoke test) before moving on; ends with a re-audit of dependencies and updates. Uses the official Expo upgrade skill when installed. Use when the user wants to upgrade Expo / React Native / the SDK, or after an audit flags an old SDK."
argument-hint: "[appPath] [--to=<sdk>] [--plan-only]"
---

# expo-es-kit · upgrade

An SDK upgrade is a series of small, verified steps. **Go one major at a time and never start the next step before the current one passes its gates and the device smoke test.** Only exception: when the official release notes or `sdk-notes.md` explicitly recommend skipping a version (e.g. going from SDK ≤55 straight to SDK 57 ≥57.0.9 because of a known SDK 56 issue). Treat that as one step, cite the source, and include the skipped SDK's migration items in it.

## 0. Setup

- `PLUGIN_ROOT` is two levels above this SKILL.md. If unknown, run `find ~/.claude/plugins -type f -path '*expo-es-kit*/scripts/scan.mjs' | head -1` and strip `/scripts/scan.mjs`.
- References in `PLUGIN_ROOT/skills/upgrade/references/`:
  - `playbook.md`: the per-step checklist, rollback, and a table of common breakages
  - `sdk-notes.md`: notes for each SDK
  - `library-compat.md`: libraries that commonly block upgrades
- Check whether the official Expo upgrade skill is available: a skill named like `expo-upgrade` or `upgrading-expo`, from `expo/skills`. If it is, load it for the mechanical steps. This skill adds the plan, the gates and the safety rails on top of it. If it isn't installed, mention that the user can install the official Expo skills (`/plugin install expo@claude-plugins-official`, see `playbook.md`), and continue with `playbook.md`.
- Run `node "$PLUGIN_ROOT/scripts/scan.mjs" <app> --summary > "$TMP/scan.json"`. Then save a full scan as `$TMP/scan-before.json` for the final diff.

## 1. Assess

- Find the current SDK (`stack.expo`), React Native, React and router versions.
- Find the target: take `--to` if given, otherwise the latest stable. Use `npm view expo version` (ask before running) or the Expo docs. The steps are every major between current and target.
- List the inventory from `package.json`, `app.json`/`app.config.*`, `eas.json` and `patches/`:
  - native dependencies and config plugins
  - `patch-package` patches
  - whether the project uses CNG (no committed `ios/` / `android/`) or has committed native folders
  - the `runtimeVersion` policy, EAS channels, and whether `expo-updates` is installed
  - the CI config
- Check the git state. A clean tree is required; if it isn't clean, ask the user to commit or stash.
- Record the baseline gates: typecheck, lint, tests, `npx expo-doctor`. Ask before running them. These tell you which failures already existed.

## 2. Plan

For each major step, read its section in `sdk-notes.md`. Also fetch the official release post and changelog, because the notes may lag behind them. Grep the app for every affected API (e.g. `from 'expo-av'`, deprecated router APIs, file-system calls), and check each native dependency against `library-compat.md`.

Write one plan table per step:

| Step | Change | Affected files (grep hits) | Effort | Risk | Needs rebuild |
|---|---|---|---|---|---|

Under the table, list:

- **Blockers**: libraries without a compatible version, patches that no longer apply.
- **Decisions needed**: for example, migrating `expo-av` to `expo-audio`/`expo-video` now, or keeping a fork.

With `--plan-only`, stop here. Offer to save the plan to `docs/upgrades/sdk-<from>-to-<to>.md`.

## 3. Execute one step: SDK N → N+1

1. **Branch**: `upgrade/sdk-<N+1>`. Ask before creating it.
2. **Install.** Print the commands for the user to run, then wait for confirmation. Installs must run on the OS the project normally uses; WSL vs Windows breaks Metro.
   ```
   npx expo install expo@^<N+1>.0.0 --fix
   npx expo install --fix
   ```
   Run the commands yourself only if the user explicitly says you're on the right OS and asks you to.
3. **Migrate.**
   - Apply the breaking-change edits from the plan.
   - Update the config (`app.json`, babel, metro) if the step requires it.
   - Regenerate typed routes if the project uses them.
   - Keep each diff minimal.
4. **Patches.** For each file in `patches/`, check whether it still applies and whether it is still needed. A patch that fails is a **blocker**: stop and report it. Never delete a patch silently.
5. **OTA safety.**
   - With `runtimeVersion: { policy: "fingerprint" }`, the native change already gives a new runtime. With `"appVersion"`, bump the app version.
   - Never publish an OTA update from the upgrade branch to channels that older binaries listen on.
6. **Gates.** Run all of these and compare with the baseline:
   - typecheck, lint, tests
   - `npx expo-doctor`, `npx expo install --check`
   - `npm audit --omit=dev --audit-level=high`

   New failures must be fixed or reported.
7. **Native check.**
   - CNG projects: offer `npx expo prebuild --clean`, with consent; it rewrites `ios/` and `android/`. Don't run it in projects with committed native code.
   - Then tell the user to rebuild the dev client (`npx expo run:ios|android` or an EAS development build). Give them the **device smoke-test checklist** from `playbook.md`:
     - cold start, sign-in, navigation
     - a long list, an image-heavy screen
     - push notifications, a deep link, purchases
     - an OTA check

     Wait for the user's confirmation. If something fails, debug with the breakage table in `playbook.md` before going further.
8. **Commit.** Ask first. Use the message `chore: upgrade Expo SDK <N> → <N+1>`.
9. Repeat for the next step.

## 4. Finish

- Run the regression scan: `node "$PLUGIN_ROOT/scripts/diff-scans.mjs" "$TMP/scan-before.json" "$TMP/scan-after.json"`.
- Re-audit with the procedure in `PLUGIN_ROOT/skills/audit/SKILL.md`, using `--only=deps,updates,perf,startup` in quick mode. Report the before and after scores.
- Write `docs/audits/expo-upgrade-YYYY-MM-DD.md` with these sections:
  - **Steps:** one row per SDK step, in the format `| Step | Gates | Device test | Commit |`.
  - **Changes per step.**
  - **Patches** kept, updated or removed.
  - **Follow-ups**: deprecations to address before the next SDK.
  - **Before/after scores.**
- Tell the user to ship a store build. A new SDK means a new binary, because OTA cannot deliver it.

## Rules

- Do one major per step (except officially recommended skips), and pass the gates and the device confirmation before moving on.
- Never weaken checks to get green: no `@ts-ignore` sprinkling, no `--legacy-peer-deps` without asking, no skipped tests.
- Never claim "upgrade complete" without the device smoke test. If the user skipped it, write "device test: not done" in the report.
