# Auth & sessions checks (category `auth-sessions`)

Scope: the session lifecycle on device and at the server boundary: client config, refresh, OAuth/deep-link callbacks, sign-out/account switch, token transport, device sessions, account deletion.

Check-IDs are stable references. Finding `id`s follow `shared/contract.md` (`AUTH-001`, … per report). Implementation guide: `skills/backend/references/auth-sessions.md`.

## Signals to start from

| Signal | Meaning | Next step |
|---|---|---|
| hit `supabase-create-client` | Supabase client creation sites | Expect exactly one app client. Several = config drift, possibly a client without storage/refresh. |
| file rule `supabase-client-no-secure-storage` | `createClient` file never mentions SecureStore/MMKV | Read the `auth.storage` option. AsyncStorage/`expo-sqlite/localStorage` = SEC-01 (report under `secure-storage`, cross-reference here). |
| hit `supabase-auto-refresh` | `autoRefreshToken` / `startAutoRefresh` / `stopAutoRefresh` | Both the option and the AppState listener should exist. |
| hit `supabase-pkce` | `flowType: 'pkce'` or `exchangeCodeForSession` | Absent while OAuth/magic link is used = implicit flow (tokens in the redirect URL fragment). |
| hit `supabase-get-session` vs `supabase-get-user` | Session read local vs verified | `getSession()` in app UI code is fine. In server code (`api.*` routes, Edge Functions) it is not an authorization check. |
| hit `sign-out` + `query-cache-clear` + `image-cache-clear` + `storage-clear-all` | Sign-out and wipe primitives | Read the sign-out function end to end (AUTH-08). Missing wipe hits = likely P1. |
| hit `auth-session-lib` | `expo-auth-session` / `WebBrowser.openAuthSessionAsync` / `makeRedirectUri` | Inspect redirect URI and callback handling (AUTH-05/06). |
| hit `biometric` | `expo-local-authentication` | Confirm it is an app-lock layer, not a replacement for server auth (AUTH-12). |
| hit `token-in-url` | `?token=${…}` style URL | P1 (AUTH-10). |
| hit `jwt-decode-only` | `jwt-decode` / `decodeJwt` | In the app: fine for reading `exp`/claims for UI. In server code: P0 (report under `backend`). |
| hit `auth-header` / `refresh-on-401` | Bearer header injection / 401 handling | Read the API client: single-flight refresh + retry once (AUTH-07). |
| hit `account-deletion` (category `release`) | Account deletion present | Verify it revokes sessions and deletes storage objects (AUTH-14). |
| `stack.libs` | `expo-auth-session`, `expo-web-browser`, `expo-local-authentication`, `expo-crypto` | Context for which flows exist. |
| `config.scheme`, `config.ios.associatedDomains`, `config.android.intentFilters` | Redirect targets | Custom scheme only = interceptable by other apps; PKCE mitigates code interception. |

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| AUTH-01 | Single Supabase client with correct RN config | `auth: { storage: <secure adapter>, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' }` | P1 for missing `detectSessionInUrl: false`/PKCE when OAuth is used; storage issue is SEC-01 (P0) | Template in backend `auth-sessions.md` |
| AUTH-02 | Auto refresh tied to AppState | `AppState.addEventListener('change', …)` calling `startAutoRefresh()` on `active`, `stopAutoRefresh()` otherwise; registered once (module scope or root effect with cleanup). | P2 (P1 if users report random sign-outs / expired-token errors after resume) | AppState listener snippet |
| AUTH-03 | `onAuthStateChange` is the single source of truth | One subscription (root provider) drives the auth store; screens do not each call `getSession()` and branch. Subscription unsubscribed on unmount. No async Supabase calls awaited inside the callback (can deadlock the auth lock); defer with `setTimeout(…, 0)`. | P2 (P1 if inconsistent state causes data of a signed-out user to render) | Root `AuthProvider` + store |
| AUTH-04 | Server never trusts unverified tokens | Any server code (API routes / Edge Functions) uses `getUser(token)` / `getClaims(token)` / `jwtVerify` with JWKS. `getSession()` or decode-only on the server = auth bypass. | P0 (report under `backend`, cross-reference) | `requireAuth()` helper |
| AUTH-05 | OAuth / magic link uses PKCE + code exchange | `WebBrowser.openAuthSessionAsync(url, redirectTo)` → parse `code` → `supabase.auth.exchangeCodeForSession(code)`. Not: parsing `access_token` from the URL fragment. | P1 | PKCE flow |
| AUTH-06 | Redirect / deep-link callback validated | Redirect URI built with `makeRedirectUri` (or fixed), allow-listed in Supabase Auth "Redirect URLs" (no wildcards broader than needed). Callback handler accepts only expected path + params; never forwards `redirect_to`/`next` to arbitrary destinations. | P1 | Allow-list, see client-security CSEC-09 |
| AUTH-07 | Custom API token refresh is single-flight + 401 retry once | API client: on 401, one shared refresh promise; queued requests await it; retry the original once; second 401 → sign-out. No refresh loops; no parallel refreshes (refresh token rotation makes the second one fail and logs the user out). | P1 | `fetchWithAuth` wrapper |
| AUTH-08 | Sign-out wipes everything user-scoped | Sign-out function: `supabase.auth.signOut()` (server revoke), `queryClient.clear()`, user MMKV instance `clearAll()` / role+user prefixed keys removed, `Image.clearMemoryCache()` + `Image.clearDiskCache()` when images are private (progress/medical/identity photos), SecureStore user keys deleted, zustand/jotai stores reset, push token unregistered server-side, navigation reset to auth stack. | P1 (missing any user-data cache wipe); P2 for push token | Sign-out wipe snippet |
| AUTH-09 | Late responses cannot write into the next user's cache | Session generation counter or user-id check before `setQueryData`/store writes in async callbacks; queries keyed by user id; `cancelQueries` on sign-out. | P1 on multi-account/shared-device apps; P2 otherwise | Generation guard snippet |
| AUTH-10 | Tokens never in URLs, query keys, logs, analytics, crash reports | `token-in-url`, `log-sensitive` hits; grep `queryKey` containing tokens/invite codes; check image `source.uri` with `?token=` (ends up in image disk cache keys). | P1 | Authorization header; signed URLs with short TTL generated server-side |
| AUTH-11 | Rate limits on login/OTP/invite/reset | Supabase Auth rate limits configured (dashboard) and custom endpoints (invite exchange, OTP verify, device-session creation) rate-limited by IP + identifier. Client: resend cooldowns. | P1 for custom auth endpoints without limits | Rate limiter in API; Supabase Auth rate-limit settings |
| AUTH-12 | Biometrics are an app-lock, not auth | `authenticateAsync()` only gates local UI/unlock of a SecureStore item; the server session remains the authority. Not acceptable: biometric success → app sends a stored password or flips an `isLoggedIn` flag without a session. | P1 if biometrics replace server auth | `requireAuthentication` SecureStore item or app-lock overlay |
| AUTH-13 | Device sessions for passwordless/invite flows | Invite token: single-use, short TTL, exchanged once for a revocable device session. Server stores only peppered hashes (HMAC-SHA-256 with server pepper) of invite and session secrets. Every RPC validates the device session; invalid/revoked → client clears local credential + caches and routes to onboarding. | P0 if raw long-lived secrets stored server-side in plaintext or invite reusable indefinitely; P1 if no revocation | Device-session pattern in backend `auth-sessions.md` |
| AUTH-14 | Account deletion revokes and deletes | In-app deletion (required by App Store if accounts can be created): server endpoint deletes/anonymizes rows, deletes storage objects under the user prefix, revokes all sessions (`auth.admin.deleteUser` or `signOut({ scope: 'global' })` first), then client runs the sign-out wipe. | P0 if account creation exists and no deletion path (report under `release`); P1 if deletion leaves storage objects/sessions | Server-side deletion route |
| AUTH-15 | Password reset/email change via deep link with PKCE | Reset link → app → `exchangeCodeForSession` → `updateUser({ password })`. Reset screen unreachable without a recovery session. | P1 | PKCE recovery flow |
| AUTH-16 | Session scope on sign-out appropriate | `signOut()` default scope is `global` in supabase-js (revokes all refresh tokens of the user); `local` only this device; `others`. Choice is deliberate and documented. | P2 | Explicit `{ scope }` |
| AUTH-17 | MFA available where the data warrants it | Health/finance/admin roles: TOTP MFA (`supabase.auth.mfa.*`) and AAL checks (`aal2`) enforced in RLS/API for sensitive actions. | P2 (P1 for admin roles in regulated apps) | Supabase MFA + `(select auth.jwt()->>'aal') = 'aal2'` in policies |

## Proven patterns

See `skills/backend/references/auth-sessions.md` for full code (SecureStore adapter, AppState refresh, generation guard, sign-out wipe, single-flight refresh). Minimal pass shape for AUTH-08:

```ts
export async function signOutEverywhere() {
  sessionGeneration.bump();                       // AUTH-09
  await queryClient.cancelQueries();
  try { await supabase.auth.signOut({ scope: 'local' }); } catch {} // revokes this device's session server-side; never block the wipe
  queryClient.clear();
  userStore?.clearAll();                          // per-user encrypted MMKV
  await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]);
  await Promise.all(USER_SECURE_KEYS.map((k) => SecureStore.deleteItemAsync(k)));
  resetAllStores();                               // zustand slices
  router.replace('/(auth)/sign-in');
}
```

## Not a problem when

- `getSession()` used in app UI to decide which stack to render: it reads local storage, which is fine on device. Data access is still enforced by RLS/API.
- `jwt-decode` in the app to read `exp` for scheduling or display.
- `detectSessionInUrl` omitted when the app does not use OAuth/magic links (still recommend `false`).
- No image cache wipe when all images are public (avatars of public profiles, catalog images).
- `refresh-on-401` hit absent in pure direct-db mode: supabase-js handles refresh itself.
- No MFA in a low-sensitivity consumer app.
- `signOut()` failing offline while the local wipe still runs: correct behavior (wipe must not depend on network).
- Biometric gate with no server-side component when it only protects local UI over an existing valid session.

## Score anchors

- **0–2**: session in plaintext storage + server trusts decoded tokens or no sign-out wipe at all; tokens in URLs/logs.
- **3–4**: one confirmed P0 (e.g. invite tokens reusable forever and stored raw, no account deletion while sign-up exists).
- **5–6**: secure storage OK, but P1s: no PKCE for OAuth, sign-out leaves query/image/MMKV caches, parallel refresh races, no rate limit on custom auth endpoints.
- **7–8**: correct client config, PKCE, AppState refresh, complete wipe; minor gaps (no generation guard on single-account app, scope implicit, push token not unregistered).
- **9–10**: everything above plus generation guard, single-flight refresh, validated callbacks, device sessions with peppered hashes and revocation, deletion that revokes sessions and storage, documented threat model.
