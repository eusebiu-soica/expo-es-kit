# Dependencies checks (category `deps`)
Scope: dependency health — SDK alignment, vulnerabilities, duplicates, maintenance status, patches, native-module hygiene, lockfile and CI gates.

Check ids (`DEP-Cnn`) are stable references for this file; findings get report ids `DEP-001…`. SDK currency itself is scored in `updates`.

**Hard rule: the audit NEVER runs `npm install`, `npx expo install <pkg>`, `--fix`, `npm audit fix`, or anything that modifies `package.json`, lockfiles or `node_modules`.** Allowed read-only commands (run only if `node_modules` exists and network is available; otherwise note under "What was not checked"):

```sh
npx expo-doctor                          # config + dependency sanity
npx expo install --check                 # versions vs SDK (read-only; --fix is NOT allowed during audit)
npm outdated                             # exits 1 when outdated — not an error
npm audit --omit=dev --audit-level=high  # production vulns
npm ls <pkg>                             # duplicates / why installed
npx depcheck --skip-missing              # unused deps (or: npx knip --dependencies)
```
Use the matching commands for pnpm/yarn/bun (`pnpm why`, `yarn why`, `bun pm ls`) based on the lockfile present.

## Signals to start from

| Scan path | Meaning |
|---|---|
| `stack.expo`, `stack.reactNative`, `stack.react` | SDK baseline for alignment checks. |
| `stack.libs` | Known libs + versions; read full `package.json` for the rest. |
| `stack.libs["patch-package"]`, `patches/` dir | Patches to inventory. |
| `stack.libs["react-native-fast-image"]` / `hits["fast-image"]` | Unmaintained image lib (replace with expo-image). |
| `stack.libs.moment`, `stack.libs["crypto-js"]` | Legacy/maintenance-mode libs (bundle overlap). |
| `config.scripts` | `typecheck`, `lint`, `test`, `postinstall` (patch-package), `doctor`. |
| `git.isRepo` + lockfile presence | `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` / `bun.lock(b)` — exactly one, committed. |
| `.github/workflows/*`, `eas.json` build hooks | CI gates (`npm ci`, typecheck, lint, audit). |
| `config.tsStrict` | Type safety baseline. |

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| DEP-C01 | Expo doctor clean | `npx expo-doctor` output (read-only). | P1 for failing native/config checks; P2 for warnings | Address each item; record intentional exclusions in `expo.install.exclude` with a comment in docs. |
| DEP-C02 | Versions aligned with SDK | `npx expo install --check`; or compare `package.json` against the SDK's bundled versions. | P1 for misaligned native modules (crashes/build failures); P2 for JS-only | `npx expo install --fix` (by the fix skill, not the audit). |
| DEP-C03 | No high/critical prod vulnerabilities | `npm audit --omit=dev --audit-level=high`. Check whether the vulnerable path is reachable in the app (client) or build-time only. | P1 for reachable high/critical; P2 for build-time/transitive in Expo/Metro tooling | Upgrade the direct dependency; `overrides`/`resolutions` with care; transitive vulns from Expo/Metro often need an SDK upgrade. Never waive without a dated risk acceptance (who, why, until when). |
| DEP-C04 | Audit gate in CI | Workflow runs `npm audit --omit=dev --audit-level=high` (or equivalent) and fails the build. | P2 | Add the gate; document accepted risks in `docs/` with an expiry date. |
| DEP-C05 | Exactly one lockfile, committed | Multiple lockfiles, none, or lockfile in `.gitignore`. | P1 (non-reproducible builds) | Keep the package manager's lockfile only; commit it. |
| DEP-C06 | Reproducible installs in CI | CI/EAS uses `npm ci` (or `--frozen-lockfile`), not `npm install`. | P2 | `npm ci`; EAS uses the lockfile automatically — don't delete it in hooks. |
| DEP-C07 | No duplicate critical packages | `npm ls react react-native react-native-reanimated react-native-gesture-handler @tanstack/react-query expo-modules-core` → more than one version. | P1 for duplicate native/React packages (runtime errors); P2 otherwise | Align versions; `overrides`; dedupe (`npm dedupe` by the fix skill). |
| DEP-C08 | No unmaintained libraries | Last publish > ~2 years, archived repo, no New Architecture support (check React Native Directory / repo). Typical: `react-native-fast-image`, old `react-native-vector-icons` forks, abandoned pickers. | P1 if it blocks SDK upgrades or New Architecture; P2 otherwise | Replace with Expo modules or maintained alternatives (expo-image, @expo/vector-icons, expo-image-picker). |
| DEP-C09 | Patches tracked and justified | `patches/*.patch` present: is each one documented (why, upstream issue, remove-when)? Is `postinstall: patch-package` (or the PM's native patch feature) wired? | P2 (P1 if a patch targets a version no longer installed → silently not applied) | One-line README per patch; re-validate every patch on each upgrade; delete when upstream fixed. |
| DEP-C10 | Dev vs prod dependencies correct | Build/test tools in `dependencies` (bloat for EAS caching, not bundle); runtime libs in `devDependencies` (works locally, fails in clean builds). | P2 (P1 for runtime libs in devDependencies) | Move appropriately. |
| DEP-C11 | Optional native modules imported safely | Native modules that may be absent (in Expo Go, web, or older dev clients) imported at top level → crash on start. | P1 if a crash is realistic for the documented workflow; P2 otherwise | Lazy/safe import: `try { require('x') } catch {}` or `requireOptionalNativeModule` / platform checks; feature-flag the UI. |
| DEP-C12 | Native changes need rebuilds | New native dependency added since the last dev-client/EAS build while docs say "just reload". Metro reload is not enough. | P2 | Document: native dependency → rebuild dev client (`eas build --profile development` / `npx expo run:*`). |
| DEP-C13 | Install environment consistent | Repo shows signs of installs from a different OS than the one running Metro (e.g. WSL vs Windows: broken symlinks in `node_modules/.bin`, platform-specific binaries like esbuild/lightningcss mismatched). | P2 | Install and run Metro from the same OS/shell; add a note in CLAUDE.md/README. |
| DEP-C14 | Lint gate | `lint` script exists and CI runs it with `--max-warnings=0`. | P2 | `eslint . --max-warnings=0` (expo lint config). |
| DEP-C15 | Typecheck gate | `typecheck` script (`tsc --noEmit`) and CI runs it; `config.tsStrict` true. | P2 (P1 if `strict: false` in a large codebase with many `any`) | Add script + CI step; enable strict incrementally. |
| DEP-C16 | Outdated majors | `npm outdated`: majors behind for key libs (TanStack Query, Reanimated, Sentry, Supabase JS, zod). | P2 (P1 if a security fix or SDK compatibility depends on it) | Plan upgrades per library with changelog review. |
| DEP-C17 | Semver ranges sane | Wildcards (`*`, `latest`), git URLs, or local `file:` deps in production dependencies. | P1 for `*`/`latest`; P2 for git deps without pinned commit | Pin to ranges; git deps pinned to a commit hash. |
| DEP-C18 | Unused dependencies | `depcheck`/`knip` or grep. | P2 (P1 for unused native modules — binary size, permissions, review surface) | Remove (fix skill); rebuild if native. |
| DEP-C19 | Engines/tooling pinned | `engines.node`, `.nvmrc`/`.node-version`, `packageManager` field; EAS `node` version in `eas.json`. | P2 | Pin Node and package manager versions consistently across local, CI and EAS. |
| DEP-C20 | Expo-managed packages installed via expo | Expo SDK packages at versions not matching the SDK (installed via plain `npm i expo-camera@latest`). | P1 for native mismatch | Use `npx expo install` for Expo packages (fix skill). |

## Proven patterns

**CI job (GitHub Actions excerpt)**
```yaml
- uses: actions/setup-node@v4
  with: { node-version-file: .nvmrc, cache: npm }
- run: npm ci
- run: npx expo install --check
- run: npm run typecheck
- run: npm run lint -- --max-warnings=0
- run: npm test -- --ci
- run: npm audit --omit=dev --audit-level=high
```

**Safe optional native import**
```ts
let Haptics: typeof import('expo-haptics') | null = null;
try { Haptics = require('expo-haptics'); } catch { Haptics = null; }
export const tap = () => Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Light);
```

**Patch documentation (`patches/README.md`)**
```md
| Patch | Why | Upstream | Remove when |
| some-lib+2.3.1.patch | Fix Android crash on null ref | org/some-lib#123 | some-lib >= 2.4 |
```

**Risk acceptance entry**
```md
- GHSA-xxxx (transitive via metro → foo@1.2): build-time only, not in app bundle. Accepted by A. Dev on 2026-10-07, revisit by 2027-01-07 or next SDK upgrade.
```

## Not a problem when

- `npm audit` findings only in devDependencies/build tooling and not reachable at runtime — P2 note, and only if no dated acceptance exists.
- `npm outdated` showing packages pinned by the Expo SDK (expected; `expo install --check` is the source of truth for those).
- `patch-package` patches that are documented and match installed versions.
- A library not updated recently but small, stable, pure-JS and New-Architecture-agnostic.
- `expo.install.exclude` entries with a documented reason.
- Missing CI in a solo prototype explicitly documented as such — still P2, but don't over-penalize.

## Score anchors

| Band | `deps` looks like |
|---|---|
| 0–2 | No lockfile or multiple lockfiles, `*`/`latest` ranges, native modules misaligned with SDK, reachable critical vulns, duplicate React/RN copies. |
| 3–4 | Several misaligned native modules, high prod vulns ignored, unmaintained libs blocking upgrades, undocumented patches, no CI. |
| 5–6 | Aligned with SDK but outdated majors, a few vulns without acceptance, duplicates in non-critical packages, CI missing lint or audit gate. |
| 7–8 | `expo-doctor` and `expo install --check` clean, lockfile + `npm ci`, typecheck/lint in CI, patches documented; minor outdated libs. |
| 9–10 | All of 7–8 plus audit gate with dated risk acceptances, unused deps pruned, Node/PM pinned, optional native modules safely imported, upgrade cadence documented. |
