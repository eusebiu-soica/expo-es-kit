# Secrets and data exposure (SECR-01..08, DATA-01..08)

Where credentials leak (source, bundle, repo, history, CI, server env, logs) and where user data leaks sideways (logs, analytics, crash reports, push, clipboard, screenshots, errors, backups).
Findings use `category: client-security` with `area: secrets` (SECR) or `area: data-exposure` (DATA), except: server-side leaks (SECR-06 on the API, DATA-07 API bodies) go under `backend`; DATA-08 backups go under `secure-storage`. Put the check ID in the finding `title` or `evidence`.
Baseline rules already in `skills/audit/references/checks/client-security.md` (CSEC-01..06, CSEC-12, CSEC-14): this file adds depth, not a second opinion.

**Secret-handling rule for agents:** never open `.env*` files to read values, never print a secret, never paste a value into a finding. Refer to key names, file:line and a redacted prefix (`sk_live_[redacted]`). Git history is inspected only through `gitHistorySecrets` (already redacted).

| ID | Check | Typical severity |
|---|---|---|
| SECR-01 | No secrets hard-coded in source/literals | P0 |
| SECR-02 | No secrets in the JS bundle via `EXPO_PUBLIC_*` / `extra` / `Constants.expoConfig` | P0 |
| SECR-03 | No committed env or credential files | P0 (P2 for Firebase client config) |
| SECR-04 | Secrets in git history rotated, not just deleted | P0 |
| SECR-05 | EAS env / CI secrets scoped and not echoed in logs | P1 |
| SECR-06 | Server env never reaches a client (`NEXT_PUBLIC_*`, Edge/API route imports) | P0 |
| SECR-07 | Third-party keys classified: public-by-design vs secret, public keys restricted | P2 (P0 if a secret is misclassified) |
| SECR-08 | Secrets never logged (env dumps, headers, upstream errors) | P1 |
| DATA-01 | No PII/tokens in device or server logs | P1 |
| DATA-02 | Analytics events/properties/identify carry no raw PII | P1 |
| DATA-03 | Crash reporter scrubs PII, headers, URLs, breadcrumbs | P1 |
| DATA-04 | Push payloads contain no sensitive content | P1 |
| DATA-05 | Sensitive values not left on the clipboard | P2 (P1 for credentials) |
| DATA-06 | Sensitive screens protected from screenshots/app-switcher | P2 (P1 regulated) |
| DATA-07 | Errors shown to users / returned by API leak nothing internal | P1 |
| DATA-08 | Device backups do not carry plaintext sensitive data | P2 (P1 sensitive data) |

---

### SECR-01 · No secrets hard-coded in source/literals
**Severity guide:** P0 when a server secret (Stripe `sk_live_`/`rk_live_`, `whsec_`, Supabase `sb_secret_` or a `service_role` JWT, DB URL with password, AWS/GCP keys, PEM private key, LLM provider key) appears in any file that ships in the app or is committed · P1 when it is a test-mode/staging secret or a user JWT fixture · P2 when it is an obvious placeholder in a doc that looks like a real format.
**Signals:** `secret-literal` (P0), `jwt-literal`, `service-role-in-client` (P0); `env.publicSecretLooking`.
**How to verify:**
1. Read the scan hits; values are redacted. Open the file only to classify the key type by its prefix/variable name; never copy the value into the finding.
2. For `jwt-literal`: decode only the `role` claim locally (e.g. a one-off script printing `payload.role`), never print the token. `anon` = fine; `service_role` = P0; `authenticated` user token = P1 (fixture leak).
3. Grep manually for prefixes the rules may miss: `sb_secret_`, `sk-proj-`, `sk-ant-`, `AIza` (classify via SECR-07), `xox[bp]-`, `ghp_`, `-----BEGIN`.
4. Trace whether the file is reachable from the app entry (imports from `app/`, `src/`, `components/`) or lives in server/tooling code only (still P0 if committed: see SECR-04).
**Not a problem when:** Supabase anon/publishable key; Stripe `pk_live_`/`pk_test_`; RevenueCat `appl_`/`goog_`; Sentry DSN; Mapbox `pk.`; placeholders like `sk_test_xxx` in `.env.example`; a `jwt-literal` whose role is `anon`.
**Fix:**
- Expo client: delete the literal, move the privileged call behind an API route / Edge Function, read only public config from `process.env.EXPO_PUBLIC_*`.
- Server (Next.js / Edge / Expo API routes): read from server env (`process.env.X` / `Deno.env.get('X')`), validated at startup with zod.
- **Rotate the key now** (provider dashboard → roll/revoke), then remove it from code. Shipped binaries and git history keep the old value forever.
- Add a pre-commit secret scanner (gitleaks/trufflehog) and the same in CI.

### SECR-02 · No secrets in the JS bundle via `EXPO_PUBLIC_*` / `extra` / `Constants.expoConfig`
**Severity guide:** P0 when a server secret is inlined via `EXPO_PUBLIC_*`, `app.config.*` `extra`, or read via `Constants.expoConfig.extra` · P1 when an internal-only value (admin endpoint URL with a static token, feature backdoor flag) is exposed · P2 when public config is undocumented.
**Signals:** `expo-public-secret` (P0), `env.publicSecretLooking`, `env.files[].keys[]` (`public: true` + `looksSecret: true`), `env.easEnvKeys`.
**How to verify:**
1. List `env.files[].keys[]` where `public` is true; for each `looksSecret`, grep its usages to learn what it is (variable names, SDK it is passed to). Do not open `.env` values.
2. Read `app.config.*`: any `extra: { … process.env.X … }` copies X into the manifest that ships with the app and is readable via `Constants.expoConfig` (and in OTA update manifests). Treat `extra` exactly like `EXPO_PUBLIC_*`.
3. Grep `Constants.expoConfig?.extra`, `Constants.manifest`, `Updates.manifest` consumers for secret-looking names.
4. Remember: Metro inlines `process.env.EXPO_PUBLIC_*` at build time into the Hermes bundle; deleting the env var later does not remove it from shipped builds.
**Not a problem when:** the value is public by design (SECR-07); a non-`EXPO_PUBLIC_` env var is read only inside `+api.ts` server files or `app.config.*` for build-time decisions without being copied into `extra`.
**Fix:**
- Rename to a non-public name and move usage server-side; rotate the key (it is in every shipped build and OTA update).
- In `app.config.ts`, copy into `extra` only an allow-list of public keys:
```ts
// app.config.ts — never spread process.env into extra
const PUBLIC = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY', 'EXPO_PUBLIC_SENTRY_DSN'] as const;
export default ({ config }: { config: Record<string, any> }) => ({
  ...config,
  extra: { ...config.extra, ...Object.fromEntries(PUBLIC.map((k) => [k, process.env[k]])) },
});
```
- Document each public key in `.env.example` with a "public by design" comment.

### SECR-03 · No committed env or credential files
**Severity guide:** P0 for tracked `.env*` with server secrets, upload keystores (`.jks`/`.keystore`), App Store Connect API keys (`.p8`), push certs (`.p12`/`.pem`), `credentials.json`, `service-account*.json`, `*.mobileprovision` with keys · P1 when `.gitignore` lacks env coverage and server-secret env files exist locally · P2 for committed `google-services.json`/`GoogleService-Info.plist` or `.env` with only public `EXPO_PUBLIC_*` values.
**Signals:** `git.sensitiveTrackedFiles`, `git.gitignoreHasEnv`, `env.files[].keys[]` (`looksSecret`).
**How to verify:**
1. For each `git.sensitiveTrackedFiles` entry, classify by filename/extension only. For env files, use `env.files[].keys[]` names, not values.
2. Check `.gitignore` for `.env*` (with `!.env.example`), `*.jks`, `*.keystore`, `*.p8`, `*.p12`, `credentials.json`, `service-account*.json`.
3. Firebase client configs: confirm the API key is restricted in Google Cloud (Android package + SHA-1 / iOS bundle id), otherwise note P2.
**Not a problem when:** `.env.example`/`.env.sample` with placeholders; Firebase client config files (identifiers, not secrets); a debug keystore used only for local builds (`debug.keystore`, known password `android`).
**Fix:** `git rm --cached <file>`, extend `.gitignore`, then **rotate** (new upload key via Play Console upload-key reset, revoke `.p8` in App Store Connect, delete/recreate service-account keys). Store signing credentials in EAS credentials (`eas credentials`) and server values in EAS env / Vercel / `supabase secrets`.

### SECR-04 · Secrets in git history rotated, not just deleted
**Severity guide:** P0 when `gitHistorySecrets.findings` contains a server secret that was not rotated (assume not rotated unless the team documents it) · P1 when rotation is documented but history still contains it in a public repo · P2 for test-mode keys.
**Signals:** `gitHistorySecrets` (opt-in `--history`: `{scanned, findings:[{root, commit, file, sample, stillInHead}], credentialFilesEverCommitted:[{root, file, stillTracked}]}`).
**How to verify:**
1. If `gitHistorySecrets.scanned` is false, write "history not scanned (run with `--history`)" under not-checked; do not run your own `git log -p` greps.
2. For each finding, use `rule`, `file` and the redacted `sample` to classify the key type. Never check out the commit or print the blob.
3. Check whether the secret is still referenced at HEAD (same var name) and whether the repo is or was public/shared with contractors.
**Not a problem when:** the finding is a placeholder, a public-by-design key, or the team has a dated rotation note for that key.
**Fix:** rotation is the fix; removing from HEAD is not. 1) Roll the key at the provider. 2) Update server env (Vercel / `supabase secrets set` / EAS env). 3) Redeploy. 4) Optional: rewrite history (`git filter-repo`) and force-push only if the repo is private and everyone re-clones; forks, CI caches and clones keep the old value anyway. 5) Add a secret scanner to pre-commit and CI.

### SECR-05 · EAS env / CI secrets scoped and not echoed in logs
**Severity guide:** P0 when a server secret sits in `eas.json` `build.*.env` (committed) · P1 when secrets are `plaintext` visibility in EAS env, printed in build hooks/CI logs, or production secrets are available to preview/development builds · P2 for missing environment separation of public config.
**Signals:** `env.easEnvKeys`, `env.publicSecretLooking`; read `eas.json`, `.github/workflows/*`, `eas-build-*` hooks in `package.json`.
**How to verify:**
1. `env.easEnvKeys` lists names in committed `eas.json`; any secret-looking name there is P0.
2. Read CI workflows for `echo $X`, `env | sort`, `set -x`, `printenv`, `cat .env`, `--verbose` installs that print tokens; `npx expo config --json` dumps in logs (prints `extra`).
3. Ask/document which EAS environment (`development`, `preview`, `production`) holds each variable and its visibility (`plaintext`, `sensitive`, `secret`).
**Not a problem when:** `eas.json` carries only public `EXPO_PUBLIC_*` values; `EXPO_TOKEN`/`VERCEL_TOKEN` are stored as CI secrets and never echoed.
**Fix:** `eas env:create --environment production --name SENTRY_AUTH_TOKEN --visibility secret`; reference the environment per build profile (`"environment": "production"` in `eas.json`); remove `set -x`; keep build-only tokens (Sentry auth token, npm token) out of `EXPO_PUBLIC_*`.

### SECR-06 · Server env never reaches a client
**Severity guide:** P0 when a secret is exposed via `NEXT_PUBLIC_*`, returned in a response, serialized into a Server Component prop, or imported from an Expo API route module into client code · P1 when a server module with secrets lacks an import guard · P2 for missing startup env validation.
**Signals:** `env.files[].keys[]` (`NEXT_PUBLIC_` names with `looksSecret`), `service-role-in-client`, `expo-public-secret`, `api.errorLeaks`.
**How to verify:**
1. Next.js: grep `NEXT_PUBLIC_` names; anything secret-looking is inlined into the browser bundle. Grep `'use client'` files and props passed from Server Components for env reads. Check the web build is not exposed to user data via public routes.
2. Expo API routes: grep client files (`app/**` without `+api`, `components/`, `src/`) for imports of `server/*` or modules that read non-public env. A wrong import ships the secret to every device.
3. Edge Functions: grep `Deno.env.toObject()`, `JSON.stringify(Deno.env…)`, debug endpoints returning env, and error bodies that include config.
**Not a problem when:** `NEXT_PUBLIC_SUPABASE_URL` / publishable key; server modules guarded with `import 'server-only'`.
**Fix:** Next.js: `import 'server-only'` at the top of `lib/server/*`; validate env with zod in one server module. Expo: keep secrets in `server/` imported only by `+api.ts` files; add an ESLint `no-restricted-imports` rule blocking `@/server/*` from client paths. Edge: never return env, return generic errors. Rotate anything that shipped.

### SECR-07 · Third-party keys classified and restricted
**Severity guide:** P0 when a key treated as "public" is actually a secret (Stripe `sk_`, OpenAI, Twilio auth token, SendGrid/Resend, Algolia admin key, Supabase `sb_secret_`) · P1 when a public key has no restriction and allows billable abuse (unrestricted Google Maps/Places key) · P2 when classification is undocumented.
**Signals:** `env.files[].keys[]` (`public`, `looksSecret`), `secret-literal`, `expo-public-secret`, `env.easEnvKeys`.
**How to verify:** for each key that ships, classify with this table; check the provider dashboard settings when access exists, otherwise list as "verify restriction".

| Public by design (OK in app) | Condition | Secret (never in app) |
|---|---|---|
| Supabase URL + anon / `sb_publishable_` | RLS on every exposed table | `service_role` JWT, `sb_secret_` |
| Stripe `pk_live_`/`pk_test_` | — | `sk_`, `rk_`, `whsec_` |
| Google Maps/Places/Firebase `AIza…` | Restricted by Android package + SHA-1 and iOS bundle id, API allow-list, quotas | Service-account JSON |
| RevenueCat `appl_`/`goog_` | — | RevenueCat secret `sk_`, webhook auth value |
| Sentry DSN | Rate limits/inbound filters on | Sentry auth token |
| OAuth client id | Redirect URIs allow-listed (URL-07) | OAuth client secret |
| Algolia search-only key | Scoped/secured key | Admin key |

**Not a problem when:** the key is in the left column with its condition met.
**Fix:** move misclassified keys server-side + rotate; restrict public keys (Google Cloud: application restrictions + API restrictions + quota); document classification in `.env.example`.

### SECR-08 · Secrets never logged
**Severity guide:** P1 when logs include `Authorization`/`apikey` headers, env dumps, outbound request configs with keys, or upstream errors echoing keys · P2 for verbose SDK debug logging left on in production.
**Signals:** `log-sensitive`, `console-log`; grep server code for `console.log(req.headers)`, `console.log(process.env)`, `Deno.env.toObject`, `debug: true` in SDK init.
**How to verify:**
1. Read the logger/handler wrapper first (e.g. `withApiHandler`); if it logs headers or bodies, every route inherits the leak.
2. Grep `console.(log|error)\((req|request)(\.headers)?\)`, `JSON.stringify(err)` around fetches to Stripe/LLM/email providers (error objects can include the request config with headers).
3. In the app, grep axios/fetch interceptors that log `config.headers`.
**Not a problem when:** logging a key's name, last 4 chars, or a boolean `hasKey`.
**Fix:** redact by allow-list: log `{ requestId, method, path, status, ms, userId }` only. Pino: `redact: ['req.headers.authorization', 'req.headers.cookie', '*.apikey']`. If a secret was logged: rotate, purge the log drain (Vercel log drains, Supabase logs retention).

---

### DATA-01 · No PII or tokens in device or server logs
**Severity guide:** P1 when access/refresh tokens, passwords, OTPs, emails, phones, health/financial data are logged (device logs are readable via `adb logcat`/Console on attached devices, and Metro/CI logs are shared) · P2 for user ids or stray `console.log` of non-sensitive objects.
**Signals:** `log-sensitive`, `console-log`, `config.babel.removeConsole`; server: `api.middleware`, logger helpers.
**How to verify:**
1. Grep `console.*(session|token|user|profile|email|phone|password|otp)` and logging of whole objects (`console.log(data)` after a profile fetch).
2. Server: read the request logger; check it never logs bodies of auth/profile/payment routes.
3. Supabase: `raise notice` / `raise log` with row data in SQL functions ends up in Postgres logs.
**Not a problem when:** logs are inside `if (__DEV__)` and production strips console; logged values are ids/booleans/counts.
**Fix:** a `log()` wrapper that is a no-op in production and redacts keys; `babel-plugin-transform-remove-console` for production; server structured logs with `userId` only (hash if user ids are themselves sensitive).

### DATA-02 · Analytics events/properties/identify carry no raw PII
**Severity guide:** P1 when `identify()`/`setUserProperties()`/event properties send email, phone, name, precise location, health or financial data, or when event/screen names embed identifiers (`viewed_profile_jane@x.com`, `screen: /patient/123/diagnosis`) · P2 when undeclared but low-sensitivity properties are sent.
**Signals:** `analytics-pii`; `stack.libs` for posthog/segment/firebase-analytics/amplitude/mixpanel; cross-check `skills/privacy/references/data-types.md`.
**How to verify:**
1. Find the analytics wrapper (or every direct SDK call); list `identify`, `capture/track/logEvent`, `screen` calls and their properties.
2. Check automatic capture: PostHog autocapture/session replay (masks inputs?), Firebase automatic screen tracking with route params, Segment/Amplitude default device properties.
3. Check expo-router screen tracking: if it sends `pathname` with dynamic segments or `params`, ids/emails leak (see URL-03).
**Not a problem when:** `identify(userId)` with an opaque id; properties are enums/counts; replay masks all text inputs; data is declared in the privacy manifest and App Store/Play forms.
**Fix:** typed event catalog (`track<'checkout_started'>({ plan })`); send `pathname` templates (`/patient/[id]`) not resolved paths; PostHog `mask_all_text`/input masking in replays; disclose in privacy manifest.

### DATA-03 · Crash reporter scrubs PII, headers, URLs, breadcrumbs
**Severity guide:** P1 when `sendDefaultPii: true`, no `beforeSend`/`beforeBreadcrumb`, and the app handles tokens or sensitive data (fetch breadcrumbs keep full URLs with `?token=`/`?code=`; console breadcrumbs copy logged objects; session replay records screens) · P2 when scrubbing exists but misses a source.
**Signals:** `log-sensitive`, `token-in-url`; grep `Sentry.init`, `beforeSend`, `beforeBreadcrumb`, `mobileReplayIntegration`, `setUser`, `setContext`, `setExtra`.
**How to verify:**
1. Read `Sentry.init` (or Bugsnag/Crashlytics init). Check `sendDefaultPii`, `attachScreenshot`, `attachViewHierarchy`, replay masking (`maskAllText`, `maskAllImages`).
2. Check `Sentry.setUser({ email })` vs `{ id }`; `setContext` with profile objects.
3. Check server-side scrubbing rules in the dashboard are an addition, not the only defense.
**Not a problem when:** `setUser({ id })` only; replay masks all text and images; breadcrumbs scrubbed per `client-security.md` pattern.
**Fix:** use the Sentry scrubbing pattern in `skills/audit/references/checks/client-security.md`; `attachScreenshot: false` on apps with sensitive screens; replay `maskAllText: true, maskAllImages: true`; Crashlytics: never `setCustomKey` with PII.

### DATA-04 · Push payloads contain no sensitive content
**Severity guide:** P1 when notification `title`/`body` show health, financial, message content or OTPs on the lock screen, or `data` carries tokens/signed URLs · P2 when deep-link URLs in payloads include identifiers that are guessable.
**Signals:** grep server code for Expo push (`exp.host/--/api/v2/push/send`, `expo-server-sdk`), FCM/APNs sends; client `Notifications.addNotificationResponseReceivedListener` handlers (`deeplink-handler`).
**How to verify:**
1. Read every push send site; list `title`, `body`, `data` fields.
2. Check whether push content passes through Expo/FCM/APNs (third parties) and lock screens: anything there is effectively public on the device.
3. Read the response handler: it must re-authenticate and fetch content, and validate the link (URL-04).
**Not a problem when:** generic copy ("You have a new message") and `data: { type, id }` where `id` is fetched via an authorized call.
**Fix:** generic title/body; `data` carries opaque ids; app fetches details after open. Optional: iOS Notification Service Extension to decrypt end-to-end payloads for messaging apps.

### DATA-05 · Sensitive values not left on the clipboard
**Severity guide:** P1 when the app copies passwords, recovery codes, tokens, API keys or full card numbers to the clipboard · P2 for IBAN/addresses/emails without a clear UX reason. Platform mechanics: PLAT-02.
**Signals:** `clipboard-sensitive`; grep `Clipboard.setStringAsync`, `setString`.
**How to verify:** list every clipboard write and classify the value. Note: any app in the foreground can read the clipboard; iOS Universal Clipboard syncs to other devices; Android 13+ shows a preview overlay.
**Not a problem when:** user-initiated copy of non-sensitive values (referral code, share link).
**Fix:** avoid copying secrets (show + "reveal"); if unavoidable (recovery codes), clear after ~60 s (see PLAT-02).

### DATA-06 · Sensitive screens protected from screenshots and app switcher
**Severity guide:** P1 for health/finance/identity apps when policy requires it, or when screens show recovery codes/full card data · P2 otherwise. Platform mechanics: PLAT-03.
**Signals:** grep `expo-screen-capture`, `usePreventScreenCapture`, `enableAppSwitcherProtectionAsync`.
**How to verify:** list screens that show credentials, recovery codes, card/ID documents, medical data; check each for capture prevention and iOS app-switcher protection.
**Not a problem when:** the app has no such screens, or the product deliberately allows screenshots (e.g. sharing a receipt) and documents it.
**Fix:** `usePreventScreenCapture()` on those screens; `enableAppSwitcherProtectionAsync()` (iOS) at app start for regulated apps (PLAT-03).

### DATA-07 · Errors shown to users or returned by the API leak nothing internal
**Severity guide:** P1 when API responses include stack traces, SQL/PostgREST messages (table/column/constraint names), upstream provider errors, or user existence ("no account for this email") · P2 when the app renders raw `error.message` from Supabase in UI.
**Signals:** `api.errorLeaks`; grep client `Alert.alert(…error.message)`, `<Text>{error.message}</Text>`; grep server `Response.json({ error: e.message })`, `return new Response(String(err))`.
**How to verify:** read the server error mapper (see HARD-07); read client error rendering for auth screens (account enumeration) and data screens.
**Not a problem when:** responses use `{ error: { code, message, requestId } }` with generic messages; client maps codes to copy.
**Fix:** server: `withApiHandler` error mapping in `skills/backend/references/api-nextjs-vercel.md`; client: `messageFor(code)` table; auth: "If an account exists, we sent a link".

### DATA-08 · Device backups do not carry plaintext sensitive data
**Severity guide:** P1 when plaintext stores (AsyncStorage, unencrypted MMKV, SQLite, files in `documentDirectory`) hold sensitive personal data and backups are on (Android `allowBackup` default true, iOS backs up Documents/Application Support) · P2 otherwise. Report under `secure-storage` (SEC-12). Platform mechanics: PLAT-08.
**Signals:** `config.android.allowBackup`; secure-storage hits (`asyncstorage-sensitive`, `mmkv-instance`, `sqlite-usage`).
**How to verify:** inventory what is persisted and where (secure-storage SEC-04); combine with the backup setting.
**Not a problem when:** sensitive data is encrypted with a key in SecureStore (keystore keys do not restore, so restored ciphertext is unreadable), or only non-sensitive prefs are persisted.
**Fix:** encrypt (secure-storage patterns) or `android.allowBackup: false`; iOS: keep sensitive files out of backed-up dirs (PLAT-08).
