# Release readiness checks (category `release`)
Scope: what must be true before shipping to stores — observability, crash safety, store compliance (privacy, permissions, account deletion), build/profile setup, CI quality gates and code hygiene.

Check ids (`REL-Cnn`) are stable references for this file; findings get report ids `REL-001…`. Secrets in env/bundle are scored in `client-security`; OTA/versioning in `updates`.

## Signals to start from

| Scan path | Meaning |
|---|---|
| `hits["sentry-init"]`, `stack.libs["@sentry/react-native"]` | Crash reporting initialized. Check plugin in `config.plugins` (source map upload). |
| `hits["error-boundary"]` | Error boundaries (expo-router `export function ErrorBoundary`). |
| `hits["account-deletion"]` | In-app account deletion present. Cross-check with sign-up code (`signUp`, `createUser`, OAuth sign-in creating accounts). |
| `config.ios` | `usageDescriptionKeys`, `hasPrivacyManifests`, `associatedDomains`, `nsAllowsArbitraryLoads`, `usesNonExemptEncryption`, `bundleIdentifier`. |
| `config.android` | `permissions`, `blockedPermissions`, `allowBackup`, `usesCleartextTraffic`, `intentFilters`, `edgeToEdgeEnabled`, `package`. |
| `config.plugins` | Permission-adding plugins (expo-camera, expo-location, expo-image-picker, expo-notifications, expo-contacts…) and their permission strings. |
| `config.eas` | Profiles, `submit`, env keys per profile. |
| `config.scripts`, `config.tsStrict` | Typecheck/lint/test scripts, strictness. |
| `hits["console-log"]`, `config.babel.removeConsole` | Logs in production. |
| `hits["ts-ignore"]`, `hits["any-type"]`, `hits["eslint-disable"]`, `hits["todo-fixme"]` | Hygiene counts — read the ones in auth, payments, storage, sync. |
| `git.sensitiveTrackedFiles` | Keystores, `.p8`, service accounts tracked (P0 in client-security; mention here for release process). |
| `appMigrations`, `api.migrations` | DB migrations present — check backup/restore and drift. |
| `stack.libs["react-native-purchases"]`, `["@stripe/stripe-react-native"]` | IAP/payments — store rules apply. |
| `.github/workflows/*` (list it) | CI presence. |

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| REL-C01 | Crash reporting in production | `hits["sentry-init"]` (or Bugsnag/Crashlytics); initialized early; DSN via env; `enabled: !__DEV__` or env-based. | P1 | `@sentry/react-native` with its Expo config plugin; init at module scope of the root layout. |
| REL-C02 | Source maps uploaded | Sentry Expo plugin in `config.plugins` / metro config `getSentryExpoConfig`; EAS env has the auth token (secret, not `EXPO_PUBLIC_`); OTA updates upload maps too. | P2 (P1 if crash reports are unreadable today) | Configure plugin + `SENTRY_AUTH_TOKEN` as EAS secret; upload maps for `eas update` as documented by the SDK. |
| REL-C03 | Error boundaries | Root `ErrorBoundary` export in `app/_layout.tsx`; key route groups too; boundaries report to crash reporting and offer retry. | P1 if none (white screen on render error) | `export function ErrorBoundary({ error, retry })` per layout. |
| REL-C04 | Account deletion (iOS rule) | If the app allows account creation, an in-app deletion path exists (`hits["account-deletion"]`), actually deletes server-side (not just signs out), and handles subscriptions messaging. | P0 (App Store rejection) | Settings → Delete account → confirm → server endpoint deletes/anonymizes data → sign out. |
| REL-C05 | Privacy manifest (iOS) | `config.ios.hasPrivacyManifests`; required-reason APIs used by app/libs (UserDefaults, file timestamps, disk space, system boot time) declared. | P1 (submission warnings/rejection) | `ios.privacyManifests` with `NSPrivacyAccessedAPITypes`, collected data types, tracking flag. |
| REL-C06 | Usage descriptions for every permission | For each permission-requiring module (camera, photos, location, mic, contacts, Face ID, tracking), a specific, user-facing `*UsageDescription` (via `infoPlist` or plugin options). Generic "This app needs access" text. | P0 if missing for a requested permission (crash on request / rejection); P2 if generic | Specific strings explaining the user benefit. |
| REL-C07 | Android permissions minimal | `config.android.permissions` and plugin-added permissions vs features actually used; `blockedPermissions` for ones pulled in by libs but unused (e.g. `RECORD_AUDIO` from a video lib). | P1 for sensitive unused permissions (SMS, call log, background location, `QUERY_ALL_PACKAGES`); P2 otherwise | Remove; add `blockedPermissions`. |
| REL-C08 | Backup policy | `config.android.allowBackup` not false and app stores sensitive data on disk (MMKV, SQLite, files). iOS: sensitive files excluded from iCloud backup. | P1 if sensitive data is backed up in plain form; P2 otherwise | `allowBackup: false` or backup rules excluding sensitive stores; SecureStore items are not restored across devices by design — handle missing keys (see `mmkv.md` canary). |
| REL-C09 | Privacy policy + terms reachable | Link in app (settings/onboarding/paywall) and in store metadata. | P1 (rejection when collecting personal data or selling subscriptions) | Add links; paywalls must show terms + privacy + restore purchases. |
| REL-C10 | ATT when tracking | Ads/attribution SDKs (AdMob, AppsFlyer, Meta SDK) present → `expo-tracking-transparency` prompt before tracking + `NSUserTrackingUsageDescription`. | P0 if tracking without ATT (rejection); none if no tracking | Request permission before init of tracking SDKs; respect denial. |
| REL-C11 | Export compliance | `config.ios.usesNonExemptEncryption` set (usually `false` when only HTTPS/OS crypto is used). | P2 (manual question on every submission) | `ios.config.usesNonExemptEncryption: false` if accurate. |
| REL-C12 | Icons, splash, names | App icon (1024 px, no alpha for iOS), adaptive icon (Android foreground/background/monochrome), splash via `expo-splash-screen` plugin, dark mode variants, display name. | P2 (P1 if placeholder Expo icon) | Configure in app config; verify on device. |
| REL-C13 | Deep links / universal links verified | `scheme` set; `ios.associatedDomains` + hosted `apple-app-site-association`; `android.intentFilters` with `autoVerify: true` + `assetlinks.json`; routes handle unknown/invalid params. | P1 if links are advertised but unverified (open in browser / hijackable); P2 otherwise | Host the association files; test with `npx uri-scheme open` and real links. |
| REL-C14 | EAS profiles complete | `development` (dev client), `preview` (internal), `production` (store); `submit` config; each with channel and env. | P2 (P1 if no production profile) | See `updates.md` eas.json pattern. |
| REL-C15 | Env per profile, secrets server-side | Each profile defines its API URLs/keys; production does not point at staging; secrets stored as EAS secrets/env (non-public). | P1 if production builds hit staging/dev backends | EAS environment variables per environment; `app.config.ts` reads them. |
| REL-C16 | CI quality gates | Workflow runs typecheck, lint (`--max-warnings=0`), tests on PRs; build only from main/tags. | P2 (P1 for teams > 1 dev with no CI at all) | See `deps.md` CI pattern. |
| REL-C17 | Dev tooling dev-only | Dev menus, debug screens, mock data switches, perf overlays reachable in production builds. | P1 if exposes data or bypasses auth; P2 otherwise | Gate with `__DEV__` / build profile env; strip routes in production. |
| REL-C18 | Logs stripped | `hits["console-log"]` in production paths with `config.babel.removeConsole` false. | P2 | `transform-remove-console` in production (keep `error`/`warn` if useful). |
| REL-C19 | Type escape hatches in critical paths | `hits["ts-ignore"]`, `hits["any-type"]`, `hits["eslint-disable"]` counts; read those in auth, payments, storage, sync, API client. | P2 (P1 if hiding a real type error in a critical path) | Fix types; replace `any` with `unknown` + narrowing; zod at boundaries. |
| REL-C20 | TODO/FIXME in critical paths | `hits["todo-fixme"]` in auth, payments, deletion, migrations ("TODO: verify signature", "FIXME: handle refresh"). | P1 when the TODO is an unimplemented safety check; P2 otherwise | Resolve or file issues with owners before launch. |
| REL-C21 | DB backup/restore and migration drift | `appMigrations`/`api.migrations` exist: migrations committed and match remote (`supabase db diff` / `migration list` documented), backups enabled (PITR or scheduled), restore tested once. | P1 if no backups for production user data; P2 for drift process gaps | Enable backups; document restore; check drift in CI. |
| REL-C22 | Payments/subscriptions compliance | Digital goods via IAP (RevenueCat/StoreKit), not external payment links where disallowed; restore purchases button; subscription terms on paywall. | P0 if digital goods sold via external payments where store rules forbid it; P1 for missing restore | Use IAP; add restore + terms. |
| REL-C23 | Offline/error UX for first launch | App with no network on first launch: clear message + retry, not infinite spinner. | P2 (P1 if stuck) | Explicit offline/error states on bootstrap screens. |
| REL-C24 | Launch checklist exists | A launch gate checklist in docs (store assets, review notes + demo account, privacy answers, crash-free rate target, rollback plan). | P2 | Add checklist (pattern). |

## Proven patterns

**Root error boundary (expo-router)**
```tsx
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <View style={styles.center}>
      <Text>Something went wrong.</Text>
      <Button title="Try again" onPress={retry} />
    </View>
  );
}
```

**app.json compliance excerpt**
```json
{
  "expo": {
    "ios": {
      "config": { "usesNonExemptEncryption": false },
      "infoPlist": { "NSCameraUsageDescription": "Take a photo of your receipt to attach it to an expense." },
      "privacyManifests": {
        "NSPrivacyAccessedAPITypes": [
          { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"] }
        ]
      },
      "associatedDomains": ["applinks:example.com"]
    },
    "android": {
      "allowBackup": false,
      "blockedPermissions": ["android.permission.RECORD_AUDIO"],
      "intentFilters": [{ "action": "VIEW", "autoVerify": true, "data": [{ "scheme": "https", "host": "example.com" }], "category": ["BROWSABLE", "DEFAULT"] }]
    }
  }
}
```

**Launch gate checklist (docs)**
```md
- [ ] Production profile builds from main, points at production backend
- [ ] Crash reporting + source maps verified with a test crash
- [ ] Account deletion works end-to-end (server data removed)
- [ ] Privacy manifest, usage strings, data safety form, privacy policy URL
- [ ] Review notes + demo account; IAP restore tested
- [ ] Deep links verified on both platforms
- [ ] OTA rollback rehearsed on preview channel
- [ ] DB backups on, restore tested
```

## Not a problem when

- No account deletion because the app has no accounts (anonymous/local-only) — REL-C04 not applicable.
- `allowBackup` default when the app stores nothing sensitive on disk.
- `hits["todo-fixme"]` in UI polish/copy; `any` in generated types or test helpers.
- No ATT when no tracking/ads/attribution SDKs and no cross-app data linking.
- Error boundary only at root for small apps (route-level boundaries are a 9+ refinement).
- No CI for a solo pre-launch prototype — still P2, but not P1.

## Score anchors

| Band | `release` looks like |
|---|---|
| 0–2 | Store blockers (no account deletion with sign-up, missing usage strings, tracking without ATT), no crash reporting, no error boundary, no production profile. |
| 3–4 | One P0 store blocker or several P1s: no privacy manifest, production hitting staging, unminimized sensitive permissions, unverified deep links. |
| 5–6 | Compliant basics, crash reporting without source maps, backups/drift undocumented, CI missing or partial, many escape hatches in critical code. |
| 7–8 | Crash reporting with maps, error boundaries, compliance complete, EAS profiles + env per profile, CI typecheck/lint/tests. |
| 9–10 | All of 7–8 plus launch checklist, verified deep links, DB backup/restore tested, critical paths free of TODO/`any`, dev tooling provably stripped. |
