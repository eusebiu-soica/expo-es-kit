# Upgrade playbook (one SDK major per step)

The checklist the `upgrade` skill follows for **each** SDK step `N → N+1`. Use `sdk-notes.md` for what changes in a given SDK and `library-compat.md` for third-party native libraries.

Sources (verified 2026-10-07):
- Upgrade walkthrough: https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/
- Native projects without CNG: https://docs.expo.dev/bare/upgrade/ and https://react-native-community.github.io/upgrade-helper/
- SDK version table: https://docs.expo.dev/versions/latest/
- Release posts: https://expo.dev/changelog (`/changelog/sdk-54` … `/changelog/sdk-57`)
- Official Expo skill: https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-upgrade/SKILL.md
- expo-doctor config: https://docs.expo.dev/versions/latest/config/package-json/

## 0. Delegating to the official `expo-upgrade` skill

Expo publishes an `expo-upgrade` skill in `expo/skills` (plugin `expo`, MIT). The upgrade walkthrough docs link to it.

- **Install it.** In Claude Code: `/plugin install expo@claude-plugins-official`. In other agents (Cursor, Copilot, Windsurf, Gemini, Cline, OpenCode): `npx skills@latest add expo/skills --skill '*'`. In Codex: `codex plugin add expo@openai-curated`.
- **What it covers:**
  - Install steps: `npx expo install expo@latest`, then `npx expo install --fix`, then `npx expo-doctor`.
  - Cache clearing: `npx expo export -p ios --clear`, `rm -rf node_modules .expo`, `watchman watch-del-all`.
  - Prebuild: `npx expo prebuild --clean`, only when `ios/`/`android/` already exist.
  - Bare-workflow cache clearing: `pod install --repo-update`, `npx expo run:ios --no-build-cache`, `./gradlew clean`.
  - A table of deprecated packages and their replacements.
  - Reviewing `expo.install.exclude` and removing outdated patches.
  - Removing `autoprefixer` on SDK 53+.
  - Removing redundant Metro options.
  - Hermes V1 guidance, and bumping `docs.expo.dev/versions/vNN` links in `AGENTS.md`.
  - References on React 19, the New Architecture, React Compiler, the native tabs API (SDK 55), expo-av → expo-audio/expo-video, and `@react-navigation/*` → `expo-router` imports (SDK 56, with a codemod).
- **How we combine it with ours.** Use its references and mechanical steps. Keep our pre-flight, our gates, the device confirmation, the OTA rules and the "one major at a time" rule. Its step 1 says `expo@latest`. **Replace that with `expo@^<N+1>.0.0`** unless the next bullet applies.
- **Exception: skip SDK 56.** The official skill says: *"If upgrading from SDK 55 or earlier, skip SDK 56 and upgrade directly to SDK 57. Don't use `expo@57.0.8` or below."* The reason is a Hermes V1 memory regression with `react-native-worklets`/`react-native-reanimated`, which also hits SDK 55 apps that opted into Hermes V1. Follow that advice and treat **55 → 57 as a single step**, with these extras:
  - Apply the SDK 56 migrations in the same branch (see `sdk-notes.md` § SDK 56).
  - Require `expo >= 57.0.9`. Use `>= 57.0.17` to avoid the dev startup regression too.
  - Never ship an SDK 56 binary.

## 1. Pre-flight (once, then re-check before every step)

- [ ] **Clean git tree.** Check with `git status --porcelain`. If it isn't empty, ask the user to commit or stash. Note the current branch and the HEAD SHA, which is the rollback point.
- [ ] **Branch** `upgrade/sdk-<N+1>`, created from the previous step's commit. Ask before creating it.
- [ ] **Baseline gates.** Run each one, with the user's consent, and record pass/fail and the count of errors or warnings. Pre-existing failures must not be blamed on the upgrade.
  - `npx tsc --noEmit` (or the `typecheck` script)
  - `npm run lint`
  - `npm test -- --ci`
  - `npx expo-doctor`
  - `npx expo install --check`
- [ ] **Native inventory.**
  - Every dependency that has an `ios/` or `android/` folder, a podspec or `expo-module.config.json` in `node_modules`.
  - Every config plugin in `plugins` in `app.json`/`app.config.*`.
  - `expo.install.exclude` in `package.json`. Exclusions are often stale workarounds.
- [ ] **Patches.** List `patches/*.patch` for `patch-package`, or `patchedDependencies` for pnpm/bun. For each one, record the package, the patched version and the reason (from `patches/README.md`, if present).
- [ ] **OTA state.**
  - Is `expo-updates` installed?
  - `runtimeVersion`: is it a static string, or a `{ policy: "appVersion" | "nativeVersion" | "fingerprint" }`?
  - The channels per build profile in `eas.json`.
  - Which store binaries are live, and on which channels.
- [ ] **CNG or committed native code.**
  - If `ios/` and `android/` are absent or gitignored, the project uses CNG: prebuild regenerates them.
  - If they are committed, it is bare or "prebuild once and edit". Native diffs must then be applied by hand via https://docs.expo.dev/bare/upgrade/.
- [ ] **Toolchain.**
  - Node version against the SDK minimum (see `sdk-notes.md`).
  - Xcode version, Android SDK/JDK.
  - The `eas.json` `cli.version` constraint, and `build.*.image` / `node` pins that may be too old for the target SDK.
- [ ] **Install environment.** Decide who runs the installs (see §2.1).
- [ ] **Read the release notes** for SDK `N+1`: the `sdk-notes.md` section, then the live post at `https://expo.dev/changelog/sdk-<N+1>`, which may be newer than these notes. Grep the app for every API they mention.

## 2. The step `N → N+1`

### 2.1 Install (printed, not run, unless allowed)

Installs must run on the OS and shell that the user runs Metro and builds from. If an agent in WSL installs into a Windows checkout (`/mnt/c/...`), or the other way round, it breaks:
- `node_modules/.bin` symlinks versus `.cmd` shims
- platform-specific binaries such as esbuild, lightningcss and `@expo/ngrok`

To detect the user's install OS:
- `node_modules/.bin/*.cmd` files present means the installs ran on Windows.
- A path under `/mnt/<drive>/` while the user mentions PowerShell or cmd means Windows.

**Default: print the commands and wait for the user to confirm they ran them.** Run them yourself only if the user explicitly says the agent's OS is the install OS.

```sh
npx expo install expo@^<N+1>.0.0 --fix     # bumps expo + every SDK-managed package
npx expo install --fix                     # second pass: catches packages the first pass resolved late
npx expo-doctor@latest                     # config + dependency checks, incl. React Native Directory
```

- **pnpm/yarn/bun**: the same `npx expo install` works, because it detects the package manager from the lockfile.
- **Monorepo**: run the commands in the app workspace, then check for hoisted duplicates (§5).
- **Beta SDK** (only if the user asks): `npx expo install expo@next --fix`. The version suffix is `-preview.N`. Never ship it.

### 2.2 Migrate

- [ ] Apply the breaking-change edits from `sdk-notes.md`, the live changelog and the plan. Keep each diff minimal.
- [ ] Run codemods named in the release notes. For example, SDK 56: `npx expo-codemod sdk-56-expo-router-react-navigation-replace src`.
- [ ] Update config that the step requires:
  - **`babel.config.js`**
    - Since SDK 54, `babel-preset-expo` adds the worklets/Reanimated plugin automatically. Remove a manual `react-native-reanimated/plugin` unless you need custom options.
    - If the file contains only `babel-preset-expo`, it can be deleted.
  - **`metro.config.js`**
    - SDK 53+: drop `unstable_enablePackageExports: true`, because it is the default.
    - SDK 54+: drop `experimentalImportSupport`, because it is the default. `EXPO_USE_FAST_RESOLVER` is gone. Replace `metro/src/...` imports with `metro/private/...`.
    - If the file contains only Expo defaults, it can be deleted.
  - **`app.json`**: remove fields that the SDK deleted. For example, SDK 55: `newArchEnabled`, `edgeToEdgeEnabled`, `notification`.
  - **`tsconfig.json`**: keep `extends: "expo/tsconfig.base"`.
- [ ] Review `expo.install.exclude`. For each entry, ask whether the SDK now bundles a working version. If it does, remove the exclusion and re-run `npx expo install --fix`.
- [ ] **Typed routes.** If `experiments.typedRoutes` is set, regenerate the types by starting the dev server once (`npx expo start`, which writes `.expo/types/`), then run the typecheck. Stale route types produce false errors.
- [ ] Bump versioned doc links (`docs.expo.dev/versions/vNN`) in `CLAUDE.md`/`AGENTS.md`.

### 2.3 Re-validate patches

For each patch:

1. **Does it still apply?**
   - Run `npx patch-package` with no arguments. It applies all patches and reports failures.
   - Or check the filename: `some-lib+1.2.3.patch` is pinned to 1.2.3. If the installed version differs, `patch-package` warns, and it may fail or silently skip parts.
2. **Is it still needed?**
   - Read the patch and the upstream issue or changelog of the new version.
   - If upstream fixed it, propose deleting the patch.
3. **If it is still needed but no longer applies**, it is a **blocker**:
   - Report it, then recreate it on the new version: edit `node_modules/<pkg>`, then `npx patch-package <pkg>`.
   - Only with the user's consent.
   - Never delete or skip a patch silently.
4. Update `patches/README.md`: why, upstream link, remove-when.

### 2.4 Native projects

- **CNG (no committed `ios/`/`android/`)**:
  - Local `ios/`/`android/` folders are generated output. Delete or regenerate them with `npx expo prebuild --clean`, **only with consent**.
  - EAS Build regenerates them on its own.
  - From SDK 57, plain `npx expo prebuild` already clears and regenerates the native folders by default.
- **Committed native code**:
  - **Never run prebuild**. In SDK 57+ it would wipe hand edits.
  - Open https://docs.expo.dev/bare/upgrade/ with the from/to SDK and apply the diff file by file.
  - Then run `npx pod-install` (or `cd ios && pod install --repo-update`) and an Android Gradle sync.
- **Config plugins that patch native code**:
  - SDK 53+ uses a Swift `AppDelegate`, so plugins with Objective-C mods must be updated.
  - With Xcode 27 / the iOS 27 SDK, the UIScene lifecycle is required. SDK 57.0.23+ has the `ios.enableSceneSupport` opt-in, and SDK 58 generates `SceneDelegate.swift`.
  - Prebuild once, read the generated diff and grep the result for the plugin's expected edits.
- **Toolchain minimums** for the target SDK (`sdk-notes.md`):
  - The minimum Xcode and Node versions.
  - For EAS: check `eas.json` `build.*.image`. `"latest"` or `"default"` is fine. An old pinned image may have too old an Xcode. See https://docs.expo.dev/build-reference/infrastructure/.
  - Store requirements, such as the Play target API level and the App Store Xcode SDK, change independently of Expo.
- **New Architecture**:
  - SDK ≤ 54: check `newArchEnabled`. If it is `false`, enabling it is a prerequisite for SDK 55 and should be its own step, tested on SDK 54 first.
  - SDK 55+: the New Architecture is always on.

### 2.5 OTA safety for this step

A new SDK means new native code. Binaries built on SDK N **must never** receive JS bundles built for SDK N+1, because that crashes on launch or calls missing native modules. The runtime version must change:

| `runtimeVersion` | What to do |
|---|---|
| `{ policy: "fingerprint" }` | Nothing. The native change produces a new fingerprint. Verify with `npx expo-updates fingerprint:generate` or `npx @expo/fingerprint .` before and after (the value must differ). |
| `{ policy: "appVersion" }` | Bump `version` in `app.json`. |
| `{ policy: "nativeVersion" }` | Bump `version` and/or `ios.buildNumber`/`android.versionCode`. |
| Static string | Change the string, for example `"2.0.0-sdk57"`. |

- Never run `eas update` from the upgrade branch to a channel that production or preview binaries listen on, until a store build with the new runtime is live.
- Since SDK 55, `eas update` requires `--environment`.
- Hotfixes for the old binaries go through the old branch or commit, published with the old runtime.

## 3. Verification gates (after every step)

Compare every gate against the baseline. A gate that newly fails blocks the step until it is fixed or explicitly accepted by the user.

| Gate | Command | Pass condition |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | No new errors (after typed-route regeneration). |
| Lint | `npm run lint` | No new errors or warnings. |
| Tests | `npm test -- --ci` | No new failures. Update snapshots only after reviewing them. |
| Doctor | `npx expo-doctor@latest` | No new failed checks. Every exclusion must be justified. |
| Versions | `npx expo install --check` | Clean, or only documented `install.exclude` entries. |
| Duplicates | `npm ls react react-native expo-modules-core react-native-reanimated react-native-worklets` | Exactly one version each. |
| Audit | `npm audit --omit=dev --audit-level=high` | No new reachable high or critical issues. |
| Bundle | `npx expo export --platform ios --platform android` (optional) | It bundles. This catches Metro resolution errors without a device. |

### 3.1 Dev-client rebuild + device smoke test (the user confirms)

A Metro reload is not enough: the SDK changed native code.
1. **Rebuild the dev client**: `npx expo run:ios` / `npx expo run:android`, or `eas build --profile development --platform all`. Expo Go only runs the latest SDK, and some SDKs never shipped to the stores. Use a development build.
2. **Run the checklist below**, ideally on a min-spec Android device and an iPhone. The user ticks each item or reports a failure.
   - [ ] Cold start with no red/yellow box. Note the startup time against the previous step.
   - [ ] Sign-in, sign-out and session restore after a kill and relaunch.
   - [ ] Navigation: tabs, stack push and back, modal, Android back gesture.
   - [ ] A long list: scrolling, pull-to-refresh, pagination.
   - [ ] An image-heavy screen: loading, caching, placeholders.
   - [ ] Animations and gestures: Reanimated screens, bottom sheets, swipe actions.
   - [ ] Push notifications: permission prompt, receive in foreground and background, tap opens the right screen.
   - [ ] A deep link or universal link opens the right route, from a cold start.
   - [ ] OTA: on a preview build, `Updates.checkForUpdateAsync()` works, and no update from the old runtime is offered.
   - [ ] Purchases, if any: products load, a sandbox purchase works, restore works.
   - [ ] Edge-to-edge on Android: nothing hidden under the status or navigation bars, and the keyboard doesn't cover inputs.
   - [ ] Media and file features touched by this SDK (audio, video, camera, file system).
3. **Only after the user confirms**: commit `chore: upgrade Expo SDK <N> → <N+1>` (ask first), then move to the next step. If the user skipped the device test, record "device test: not done" and don't call the step complete.

## 4. Rollback

- **Code**: each step lives on its own branch with one commit, so a rollback is `git switch <previous-branch>` or `git reset --hard <step-start-SHA>`. Run that only with the user's consent, since it discards work.
- **Then reinstall** on the user's OS: `rm -rf node_modules` followed by `npm ci`, or the lockfile's package manager.
- **Native folders and the dev client**: delete regenerated native folders (CNG) and rebuild the dev client from the old commit. The device still has the new-SDK dev client otherwise.
- **OTA**: if a new-SDK bundle was published by mistake:
  - `eas update:rollback`, or republish the last good update to that channel/branch.
  - Confirm that the new runtime differs from the one old binaries use (§2.5).
  - Check `Updates.isEmergencyLaunch` reports in the crash tool.
- **Store**: a rejected or broken store build is fixed with a new build. A binary can't be "rolled back". Keep the previous build available for staged rollout or halting.

## 5. Common breakages

| Symptom | Likely cause | Fix |
|---|---|---|
| `[Worklets] Mismatch between JavaScript part and native part`, or a Reanimated C++/JS version mismatch | Reanimated/worklets versions don't match each other, or the dev client was built before the upgrade | `npx expo install react-native-reanimated react-native-worklets`. Check the peer range with `npm view react-native-reanimated@<v> peerDependencies`, then rebuild the dev client. |
| `Reanimated plugin` / worklet errors at runtime, or `Duplicate plugin/preset detected` | A manual `react-native-reanimated/plugin` plus the plugin that `babel-preset-expo` adds since SDK 54, or a custom plugin that isn't last | Remove the manual plugin, or keep exactly one (`react-native-worklets/plugin` for Reanimated 4), placed **last**. Then `npx expo start --clear`. |
| `Unable to resolve module`, two copies of a library's state, or ESM/CJS "dual package" bugs after SDK 53 | Metro honours `package.json` `exports` by default (RN 0.79+) | Update the library. As a temporary workaround, set `resolver.unstable_enablePackageExports = false` in `metro.config.js` and document it. |
| `Invalid hook call`, or `TurboModuleRegistry ... could not be found` for core modules | Duplicate `react`/`react-native` (hoisting, or a library pinning React 18) | `npm ls react react-native`. Use `overrides` (npm) or `resolutions` (yarn/pnpm) to the SDK version, then dedupe. |
| `Cannot find native module 'ExpoX'`, or `... could not be found. Verify that a module by this name is registered in the native binary` | Stale dev client, or a native package added without a rebuild | Rebuild the dev client. In CNG projects, also `prebuild --clean`. |
| `**ERROR** Failed to apply patch for package X` | The patch targets the old version | Follow §2.3: recreate the patch or remove it. Never ignore the error. |
| `CocoaPods could not find compatible versions`, or a deployment target error | The pod repo is stale, or the iOS minimum went up (15.1 → 16.4 in SDK 56) | `cd ios && pod install --repo-update`. Remove a hard-coded `ios.deploymentTarget` that is lower than the SDK minimum. |
| Gradle: `Unsupported class file major version`, AGP/Kotlin errors, `compileSdk` errors | Wrong JDK, or a library pinned to an old AGP/compileSdk | Use the JDK version that the React Native version requires (see the RN environment docs). Then `cd android && ./gradlew clean`, update the library, and check `expo-build-properties` overrides. |
| `Type '"/x"' is not assignable to type Href` after the upgrade | Typed routes are stale, or the router changed its `Href` typing (generics removed in v4) | Regenerate with `npx expo start`, and remove `Href<T>` generics. |
| `navigate` now pushes duplicates; tab icons or labels are missing; `@react-navigation/*` import errors | expo-router API changes: v4 made `navigate` push-like (use `dismissTo`); SDK 55 moved native tabs' `Icon`/`Label`/`Badge` to `NativeTabs.Trigger.*`; SDK 56 dropped the React Navigation dependency | See `sdk-notes.md`. For SDK 56, run the codemod `sdk-56-expo-router-react-navigation-replace`. |
| Content under the status or navigation bar on Android; `StatusBar backgroundColor` ignored | Edge-to-edge is mandatory (SDK 54+ apps, Android 16 target) | Use `react-native-safe-area-context` insets, not RN `SafeAreaView` (deprecated). Remove `react-native-edge-to-edge`, `edgeToEdgeEnabled` and `androidNavigationBar` settings. |
| JSC build or runtime errors; `jsEngine: "jsc"` ignored | JSC was removed from RN core (0.79) | Use Hermes, the default. JSC is only available via `@react-native-community/javascriptcore`. |
| Memory growth with Reanimated/worklets on SDK 55 (Hermes V1 opt-in), SDK 56, or SDK 57 before 57.0.9 | Hermes V1 regression | Upgrade to `expo >= 57.0.9`. Don't toggle the Hermes version, and don't use Worklets Bundle Mode as a production workaround. |
| `forwardRef` warnings; `defaultProps`/`propTypes` ignored on function components; `JSX` namespace type errors; `useRef()` type errors | React 19 (SDK 53+) | Pass `ref` as a prop; use default parameter values; use `React.JSX`; use `useRef<T>(null)`. See the React 19 upgrade guide: https://react.dev/blog/2024/04/25/react-19-upgrade-guide |
| `metro/src/...` import errors in custom Metro or Sentry configs | metro 0.83 (SDK 54) moved internals | Import from `metro/private/...`, or update the tool that imports them. |
| Network behaviour changes (streaming, headers, `Blob`) on SDK 56+ | `expo/fetch` replaced `globalThis.fetch` | Fix the call site. Opt out temporarily with `EXPO_PUBLIC_USE_RN_FETCH=1`. |
| A library crashes or no-ops on SDK 55+; doctor warns "unknown / unmaintained / no New Architecture support" | The library is legacy-architecture-only | Check https://reactnative.directory. `npx expo-doctor` checks the directory; configure that via `expo.doctor.reactNativeDirectoryCheck` (`enabled`, `exclude`, `listUnknownPackages`) in `package.json`. Replace the library or upgrade it. |
| Committed `ios/`/`android/` edits vanished | `npx expo prebuild` regenerates by default on SDK 57+ | Restore from git. Never prebuild in projects with committed native code. |
| `eas update` fails: `--environment` required | Behaviour of SDK 55+ EAS CLI | Add `--environment production` (or `preview`), matching the channel. |
