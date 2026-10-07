# Client security checks (category `client-security`)

Scope: what ships inside the app binary/JS bundle and the repo (secrets, config, logs, transport, WebViews, deep links, randomness), independent of where data is stored.

Check-IDs are stable references. Finding `id`s follow `shared/contract.md` (`CSEC-001`, … per report).

Ground rule: **everything in the JS bundle, `app.json`/`app.config.*`, `eas.json` and `EXPO_PUBLIC_*` is public.** Anyone can unzip the IPA/APK and read the Hermes bundle strings.

## Signals to start from

| Signal | Meaning | Next step |
|---|---|---|
| `env.publicSecretLooking[]` | `EXPO_PUBLIC_*` names that look secret (SECRET, SERVICE_ROLE, PRIVATE, WEBHOOK, DATABASE_URL, PEPPER…) in `.env*` or `eas.json` | Each one is inlined in the bundle. Confirm what it is used for; secret = P0. |
| `env.files[].trackedByGit` | A `.env*` file is committed | Check key names (`looksSecret`). Committed `.env` with only `EXPO_PUBLIC_` public values = P2 hygiene; with server secrets = P0 + rotate. |
| `env.easEnvKeys[]` | Keys in `eas.json` `build.*.env` | `eas.json` is committed: values there are public. Supabase URL + anon/publishable key are fine; anything secret = P0. |
| `git.sensitiveTrackedFiles[]` | Tracked `.env`, keystores (`.jks/.keystore`), `.p8/.p12/.pem`, `.mobileprovision`, `credentials.json`, `service-account*.json`, `google-services.json`, `GoogleService-Info.plist` | See CSEC-03. Firebase client config files are not secrets. |
| `git.gitignoreHasEnv` | `.gitignore` covers `.env` | `false` + env files present = P2 (P1 if server secrets live in them). |
| hit `service-role-in-client` | `service_role` / `SERVICE_ROLE` / `serviceRoleKey` in client code (server paths excluded) | P0 if a key value or env read reaches the bundle. Also grep manually for `sb_secret_` (new Supabase secret key prefix; not covered by the rule). |
| hit `expo-public-secret` | `EXPO_PUBLIC_*SECRET/PRIVATE/SERVICE_ROLE/...` referenced in code | P0 once confirmed it is a real secret. |
| hit `secret-literal` | Stripe live keys, AWS keys, PEM private keys, GitHub/Slack tokens, `sk-…` API keys, `whsec_` | P0. Value is redacted in scan output — open the file. Rotate regardless of fix. |
| hit `jwt-literal` | Hard-coded JWT | Decode the payload (do not print it): `role: anon` = fine; `role: service_role` = P0; user token = P1 (test fixture leak). |
| hit `log-sensitive` | `console.*` with token/session/password/authorization | P1. Logs reach device logs, Sentry breadcrumbs, Metro logs in CI. |
| hit `console-log` | Plain `console.log` outside `__DEV__` | P2 unless it prints personal data. Check for `babel-plugin-transform-remove-console` (`config.babel.removeConsole`). |
| hit `http-cleartext` | `http://` URL (local IPs excluded) | P1 for API/auth endpoints. Check `config.ios.nsAllowsArbitraryLoads`, `config.android.usesCleartextTraffic`. |
| hit `eval-usage` | `eval` / `new Function` | P1 if input can come from network/deep link. |
| hit `webview-usage` / `webview-risky` | WebView present / risky props | See CSEC-08. |
| hit `deeplink-handler` | `Linking`/`useURL` handlers | See CSEC-09. |
| hit `math-random-token` | `Math.random()` used for token/nonce/state/OTP/code_verifier | P1. |
| hit `dangerously-set-html` | Web build renders raw HTML | P2; P1 if content is user-generated. |
| `config.ios.nsAllowsArbitraryLoads`, `config.android.usesCleartextTraffic` | ATS disabled / cleartext allowed | P1 in production builds unless scoped to a dev profile. |

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| CSEC-01 | No server secret in the bundle | Union of `env.publicSecretLooking`, `service-role-in-client`, `expo-public-secret`, `secret-literal`, `jwt-literal`. Also grep `sb_secret_`, `SUPABASE_SECRET`, `STRIPE_SECRET`, `OPENAI_API_KEY`, `RESEND`, `TWILIO` in app code and `app.config.*` `extra`. | P0 | Move the call behind an API route / Edge Function; rotate the key (it is already leaked in shipped builds) |
| CSEC-02 | Only public config is `EXPO_PUBLIC_*` / `extra` | Supabase URL, anon/publishable key, Sentry DSN, RevenueCat public SDK key, Google OAuth client ids, Mapbox public token = public by design. | n/a (document) | Comment in `.env.example` which keys are public by design |
| CSEC-03 | No credential files committed | `git.sensitiveTrackedFiles`. `google-services.json` / `GoogleService-Info.plist` contain client API keys restricted by package/bundle id: not secret (P2 hygiene at most; ensure API key restrictions in Google Cloud). Upload keystore (`.jks`), App Store Connect API key (`.p8`), push certs (`.p12`), `credentials.json`, `service-account*.json`, `.env` with server secrets = real secrets. | P0 for keystores/`.p8`/service accounts/server `.env`; P2 for Firebase client config | `git rm --cached`, add to `.gitignore`, rotate, use EAS credentials / EAS env (`sensitive`/`secret` visibility) |
| CSEC-04 | No secret values in `eas.json` | `config.eas.profiles.*.envKeys` + read `eas.json`. Supabase anon/publishable key there is fine. | P0 for any server secret | `eas env:create` with `secret`/`sensitive` visibility; never in `eas.json` |
| CSEC-05 | No tokens/PII in logs, analytics, crash reports | Grep `log-sensitive`; read Sentry `beforeSend`/`beforeBreadcrumb`; check analytics `identify()` payloads and screen names with ids/emails; check `fetch` breadcrumbs capture full URLs with query tokens. | P1 | Log ids/booleans; scrub `Authorization` headers and `?token=` in `beforeBreadcrumb`; `sendDefaultPii: false` |
| CSEC-06 | Production console output stripped | `config.babel.removeConsole` or a logger wrapper gated by `__DEV__`. | P2 | `babel-plugin-transform-remove-console` in production env, or a `log()` wrapper |
| CSEC-07 | HTTPS only | `http-cleartext` hits on API/auth URLs; ATS/cleartext config flags. | P1 | `https://`; scope cleartext to a dev build profile only |
| CSEC-08 | WebView hardened | For each `<WebView>`: `originWhitelist` restricted (not `['*']`), no `allowUniversalAccessFromFileURLs`, `mixedContentMode` not `always`, `injectedJavaScript` does not pass tokens, `onShouldStartLoadWithRequest` allow-lists hosts, `onMessage` validates `event.nativeEvent.url` origin and message shape. | P1 if WebView loads remote/user content with a bridge; P2 otherwise | Allow-list origins; never inject the session; validate messages with zod |
| CSEC-09 | Deep links validated | Every handler for `Linking`/`useURL`/Expo Router dynamic routes reached by links: parse with `new URL`, allow-list scheme/host/path, ignore unknown params, never forward `redirect_to`/`next` to arbitrary URLs, never perform state-changing actions (payments, deletes, invites) without user confirmation + auth. Universal/App Links preferred over custom scheme for auth callbacks (custom schemes can be claimed by other apps). | P1 (open redirect, auth code interception, CSRF-style action) | Central `parseDeepLink()` with allow-list; confirmation screen for actions |
| CSEC-10 | Secure randomness | `math-random-token` hits. Nonces/state/OTP/ids for security use `expo-crypto` `getRandomBytes` / `randomUUID`. | P1 | `Crypto.getRandomBytes(32)` / `Crypto.randomUUID()` |
| CSEC-11 | No dynamic code execution | `eval-usage`. | P1 if fed by remote data, P2 otherwise | Remove |
| CSEC-12 | Sensitive screens protected from screenshots/app switcher (regulated apps) | `expo-screen-capture` `preventScreenCaptureAsync` on payment/medical/identity screens; blur on background. | P2 (P1 for health/finance if required by policy) | `usePreventScreenCapture()` on those screens |
| CSEC-13 | Release build hygiene | No dev menus/debug flags in production: `__DEV__` gates around debug screens, no `EXPO_PUBLIC_DEBUG=true` in production profile, Reactotron/Flipper not imported (`dev-only-import` hit is in `bundle`). | P2 (P1 if a debug screen exposes tokens or env switching) | Gate by `__DEV__` and build profile |
| CSEC-14 | Third-party SDK data flow | Analytics/ads/attribution SDKs receive only what the privacy manifest/nutrition label declares; no raw email/phone unless hashed and disclosed. | P2 (P1 if health data sent to ad SDKs) | Minimize payloads; document in privacy manifest |

## Proven patterns

Sentry scrubbing:

```ts
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  beforeBreadcrumb(b) {
    if (b.category === 'fetch' || b.category === 'xhr') {
      if (b.data?.url) b.data.url = String(b.data.url).replace(/([?&](token|access_token|refresh_token|code)=)[^&]+/gi, '$1[redacted]');
    }
    return b;
  },
  beforeSend(event) {
    if (event.request?.headers) delete event.request.headers.Authorization;
    return event;
  },
});
```

Deep-link allow-list:

```ts
const ALLOWED = new Set(['/invite', '/auth/callback', '/reset-password', '/item']);
export function parseDeepLink(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const okScheme = u.protocol === 'myapp:' || (u.protocol === 'https:' && u.host === 'app.example.com');
  if (!okScheme) return null;
  const path = u.protocol === 'myapp:' ? `/${u.host}${u.pathname}`.replace(/\/$/, '') : u.pathname;
  if (![...ALLOWED].some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return { path, params: Object.fromEntries(u.searchParams) }; // validate params per route with zod
}
```

Secure random:

```ts
import * as Crypto from 'expo-crypto';
const nonce = Crypto.randomUUID();
const bytes = Crypto.getRandomBytes(32);
```

## Not a problem when

- Supabase **anon / publishable key** (`sb_publishable_…` or a JWT whose payload has `role: anon`) in `EXPO_PUBLIC_*`, `eas.json`, or `app.config` `extra`: public by design; RLS is the boundary. Do not flag. Service/secret keys are never public.
- `google-services.json` / `GoogleService-Info.plist` committed: client identifiers, not secrets (optionally P2: restrict the API key by app signature/bundle id in Google Cloud).
- `.env.example` / `.env.sample` / `.env.template` committed with placeholders.
- `service-role-in-client` hit in a comment, a type name, or a file that is actually server code outside the excluded paths (e.g. `supabase/seed.ts`, `tools/`) and never imported by the app — confirm with an import trace.
- `http://localhost`, `10.0.2.2`, LAN IPs in a dev-only config.
- `EXPO_PUBLIC_*_KEY` that is a public SDK key (RevenueCat `appl_`/`goog_`, Stripe `pk_live_`, Mapbox `pk.`).
- `console-log` inside `if (__DEV__)` or stripped by Babel in production.
- WebView rendering bundled static HTML with no bridge and no remote navigation.

## Score anchors

- **0–2**: server secret (service role / Stripe secret / DB URL) in the bundle or committed signing credentials, plus tokens in logs.
- **3–4**: one confirmed P0 (e.g. `EXPO_PUBLIC_*_SECRET`), otherwise reasonable.
- **5–6**: no secrets shipped, but P1s: tokens/PII in logs or crash reports, unvalidated deep links triggering actions, cleartext endpoints, `Math.random` nonces.
- **7–8**: no P0/P1; P2 hygiene left (console output not stripped, committed Firebase config without key restrictions, unhardened but low-risk WebView).
- **9–10**: only public config shipped and documented, scrubbed logging/crash reporting, deep-link allow-list, crypto randomness, hardened WebViews, clean repo.
