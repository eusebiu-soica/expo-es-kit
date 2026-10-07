# Updates checks (category `updates`)
Scope: Expo SDK / React Native / React currency, New Architecture, OTA (`expo-updates`) safety, runtime versioning, EAS versioning and the upgrade path.

Check ids (`UPD-Cnn`) are stable references for this file; findings get report ids `UPD-001…`.

**Always look up the current latest SDK live** — never trust memory:
```sh
npm view expo version                     # latest published expo
npm view expo dist-tags                   # next / canary
```
or fetch https://docs.expo.dev/versions/latest/ (SDK ↔ React Native ↔ React table). Reference point when this file was written (2026-10): SDK 57 → RN 0.86, React 19.2; SDK 56 → RN 0.85; SDK 55 → RN 0.83; SDK 54 → RN 0.81. SDK 55+ always runs the New Architecture (`newArchEnabled: false` is ignored); SDK 54 is the last SDK where it can be disabled.

## Signals to start from

| Scan path | Meaning |
|---|---|
| `stack.expo`, `stack.reactNative`, `stack.react`, `stack.routerVersion` | Installed versions (ranges — read the lockfile for exact). |
| `config.newArchEnabled` | `false` on SDK ≤ 54 = legacy arch; blocks Reanimated 4, MMKV 3+/4, FlashList v2 and every SDK ≥ 55. |
| `stack.libs["expo-updates"]` | OTA present. |
| `config.runtimeVersion` | String (manual) or `{ policy: "appVersion" | "nativeVersion" | "fingerprint" }`. `null` with expo-updates = finding. |
| `config.updates` | `url`, `enabled`, `checkAutomatically` (`ON_LOAD` / `ON_ERROR_RECOVERY` / `WIFI_ONLY` / `NEVER`), `fallbackToCacheTimeout`. |
| `config.eas.profiles[*].channel` | Channel per build profile. |
| `config.eas.appVersionSource`, `config.eas.profiles[*].autoIncrement` | Version/build number management. |
| `config.eas.cliVersion` | EAS CLI constraint. |
| `config.ios.buildNumber`, `config.android.versionCode` | Manual numbers (conflict with `appVersionSource: remote`). |
| `config.typedRoutes` | Typed routes enabled → generated types must exist before CI typecheck. |
| `config.dynamicConfig` | `app.config.ts` — read it: values may be computed per env. |
| `hits` for `Updates.` usage | Grep `checkForUpdateAsync|fetchUpdateAsync|reloadAsync|useUpdates` for custom update UX. |

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| UPD-C01 | SDK currency | Installed SDK vs latest. | Latest or latest−1: none. Two behind: P1. Three+ behind or past store deadlines (target API level / Xcode SDK requirements): P1, consider P0 if store submission is blocked. | Upgrade one SDK at a time (pattern). |
| UPD-C02 | RN/React match the SDK | `react-native` / `react` versions equal the SDK's bundled versions. | P1 if mismatched (unsupported combo) | `npx expo install react-native react --fix` (fix skill). |
| UPD-C03 | New Architecture | `config.newArchEnabled` false/absent on SDK ≤ 54; libraries that still need the legacy bridge. | P1 on SDK 54 (dead end for upgrades); P2 earlier SDKs | Enable, test with dev client; replace incompatible libs. |
| UPD-C04 | Runtime version policy set | `expo-updates` installed with no `runtimeVersion` or a static string never bumped. | P0 if OTA updates are published to production with a static runtime that has crossed native changes (crash on start); P1 otherwise | `{ "policy": "fingerprint" }` (automatic, safest) or `"appVersion"` with discipline (bump `version` for every native change). |
| UPD-C05 | No native changes via OTA | History/process: native deps or config plugins changed between builds without a runtime bump (with `appVersion` policy). | P1 | Use `fingerprint` policy, or a CI check that compares the project fingerprint (`@expo/fingerprint`, e.g. `npx @expo/fingerprint .`) with the one of the last store build before `eas update`. |
| UPD-C06 | Channels per profile | `config.eas.profiles` development/preview/production each with its own `channel`; production builds not on the same channel as preview. | P1 if preview and production share a channel; P2 if channels missing | `"channel": "production"` etc.; publish with `eas update --channel <name>` or `--branch` mapped to it. |
| UPD-C07 | Launch not blocked by update check | `fallbackToCacheTimeout` > 0 (launch waits for network); `checkAutomatically` choice deliberate. | P2 (P1 if ≥ 5 s) | `fallbackToCacheTimeout: 0`; download in background, apply on next cold start or via in-app prompt. |
| UPD-C08 | Update error handling | Custom update flow (`checkForUpdateAsync`/`fetchUpdateAsync`/`reloadAsync`) without try/catch; reload mid-flow (data loss); `isEmergencyLaunch` not reported. | P2 (P1 if reload can interrupt a write/payment) | Wrap in try/catch, log to crash reporting, reload only at safe points, report `Updates.isEmergencyLaunch`. |
| UPD-C09 | Rollback plan | Documented way to roll back a bad OTA (`eas update:rollback` / republish previous), and who can do it. | P2 | Document in release docs; test once on preview channel. |
| UPD-C10 | Version source remote | `cli.appVersionSource: "remote"` + `autoIncrement: true` on production; vs manual `buildNumber`/`versionCode` edits. | P2 (P1 if store rejected duplicate build numbers in history) | Set remote source; remove manual numbers from app config. |
| UPD-C11 | EAS CLI constraint | `cli.version` in `eas.json` set (e.g. `">= 16.0.0"`). | P2 | Add a minimum version constraint. |
| UPD-C12 | Upgrade path documented | CLAUDE.md/docs describe the upgrade procedure; previous upgrade notes. | P2 | Add pattern below to docs. |
| UPD-C13 | Deprecated APIs from previous SDKs | Imports/configs removed or deprecated in the next SDK (check the next SDK changelog: e.g. legacy `expo-av`, old `expo-file-system` API surfaces, splash config moved to plugin, `cacheTime` → `gcTime` in TanStack v5). | P2 (P1 if removed in the next SDK and the app plans to upgrade) | Migrate before upgrading. |
| UPD-C14 | Typed routes regenerate | `config.typedRoutes` true: is the generated route types file (under `.expo/types/`) available to CI typecheck? Stale generated types after route changes. | P2 | Generate types before typecheck in CI (start/export step as documented for the installed expo-router), commit nothing generated. |
| UPD-C15 | expo-router major matches SDK | `stack.routerVersion` vs SDK's expected major. | P1 if mismatched | Align via `npx expo install expo-router` (fix skill). |
| UPD-C16 | OTA scope documented | Team knows what can ship via OTA (JS/assets) vs needs a store build (native deps, permissions, config plugins, app icons, splash). | P2 | Add a short "OTA or build?" table to docs/CLAUDE.md. |
| UPD-C17 | Updates disabled intentionally | No `expo-updates`: is that deliberate (documented) and is there a fast hotfix path (expedited review)? | P2 if undocumented | Document the choice or adopt EAS Update with fingerprint policy. |
| UPD-C18 | Code signing for updates (if self-hosted) | Custom `updates.url` (self-hosted server) without code signing. | P1 | Configure update code signing (`codeSigningCertificate` / `codeSigningMetadata`). |

## Proven patterns

**app.json**
```json
{
  "expo": {
    "runtimeVersion": { "policy": "fingerprint" },
    "updates": {
      "url": "https://u.expo.dev/<project-id>",
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 0
    }
  }
}
```

**eas.json**
```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "channel": "development" },
    "preview":     { "distribution": "internal", "channel": "preview" },
    "production":  { "channel": "production", "autoIncrement": true }
  }
}
```

**Background update, apply on next launch**
```ts
useEffect(() => {
  if (__DEV__) return;
  (async () => {
    try {
      const r = await Updates.checkForUpdateAsync();
      if (r.isAvailable) await Updates.fetchUpdateAsync();     // applied on next cold start
    } catch (e) { captureException(e); }
  })();
}, []);
```

**SDK upgrade, one major at a time**
```sh
# on a branch; read the SDK changelog + "upgrading" guide first
npx expo install expo@^56.0.0 --fix
npx expo-doctor
npx expo install --check
# regenerate native projects if prebuild-managed (CNG): npx expo prebuild --clean
# rebuild dev client, run typecheck/lint/tests, smoke test on min-spec Android + iPhone
# then repeat for the next SDK
```

## Not a problem when

- Latest−1 SDK shortly after a new SDK release (< ~2 months) — note, don't flag.
- Static `runtimeVersion` string in an app that never publishes OTA updates (`updates.enabled: false` or no `eas update` usage) — P2 hygiene.
- `checkAutomatically: "ON_LOAD"` with `fallbackToCacheTimeout: 0` — the check doesn't block launch.
- `newArchEnabled` absent on SDK ≥ 55 — New Architecture is always on.
- Manual `buildNumber`/`versionCode` with `appVersionSource: "local"` and a CI bump script.

## Score anchors

| Band | `updates` looks like |
|---|---|
| 0–2 | 3+ SDKs behind, legacy architecture, OTA shipping to production with a static runtime across native changes (crash risk), no channels. |
| 3–4 | 2 SDKs behind or RN/React mismatched; expo-updates without a runtime policy; preview and production share a channel. |
| 5–6 | One SDK behind; runtime policy set but process gaps (manual versions, no rollback plan, launch blocked by update check). |
| 7–8 | Latest or latest−1; New Architecture; fingerprint/appVersion policy; channels per profile; remote versioning with autoIncrement. |
| 9–10 | All of 7–8 plus documented upgrade path and OTA-vs-build rules, fingerprint check in CI, error-handled update UX, rollback rehearsed. |
