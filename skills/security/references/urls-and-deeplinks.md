# URLs and deep links (URL-01..08)

URLs are the leakiest container in a mobile stack: they are logged by servers, CDNs, proxies and crash reporters, stored in browser history and navigation state, sent as `Referer`, shown in push payloads, and copied into analytics as screen names. Deep links are untrusted input that any app, web page or QR code can send.
Findings use `category: client-security` with `area: url-exposure`; server-side items (API query params, server open redirects) go under `backend`; auth callback/redirect items (URL-02, URL-07) under `auth-sessions`. Baseline: CSEC-09 in `skills/audit/references/checks/client-security.md`, AUTH-05/06/10 in `skills/audit/references/checks/auth-sessions.md`, PKCE code in `skills/backend/references/auth-sessions.md`.

| ID | Check | Typical severity |
|---|---|---|
| URL-01 | No sensitive values in query strings or paths | P1 |
| URL-02 | Tokens in URLs only as short-lived, single-use codes (PKCE) | P1 (P0 for long-lived tokens) |
| URL-03 | Expo Router params carry ids, not PII or secrets | P1 |
| URL-04 | Every deep link validated; links never trigger actions without confirmation + auth | P1 |
| URL-05 | No open redirects (server `next`/`redirect_to`, client `router.replace(params.next)`) | P1 |
| URL-06 | Universal Links / App Links verified; custom scheme not used for secrets | P1 (P2 hygiene) |
| URL-07 | OAuth / Supabase redirect URI allow-lists are tight | P1 |
| URL-08 | In-app browser and referrer do not leak tokens or sessions | P2 (P1 with tokens in URL) |

---

### URL-01 · No sensitive values in query strings or paths
**Severity guide:** P1 when password, OTP, email, phone, national id, card/IBAN, health terms, or access tokens appear in a URL the app builds or an API accepts via GET · P2 when only an opaque user id appears in a path.
**Signals:** `sensitive-param-in-url`, `search-params-sensitive`, `token-in-url`; `urlParams.app` and `urlParams.api` (`[{name, sensitive, count, at[]}]`, sensitive names first).
**How to verify:**
1. Start from `urlParams.app`/`urlParams.api` entries with `sensitive: true`; open each `file:line`.
2. Client: grep template URLs (`` `${API}/users?email=${email}` ``), `URLSearchParams` construction, `Linking.openURL` with personal data, share links (`Share.share({ url })`).
3. API: list GET routes reading `searchParams.get('email'|'phone'|'otp'|'password'|'ssn'|…)`; Vercel request logs, CDN logs and the platform's observability keep full URLs.
4. Image/file URLs: `?token=`/`?access_token=` on `<Image source>` also become image-cache keys (AUTH-10).
**Not a problem when:** the value is an opaque, non-guessable id authorized server-side; search terms on a public catalog; server-minted signed storage URLs with short TTL (scoped to one object).
**Fix:**
- Client: send personal data in a POST/PATCH JSON body or headers; keep ids in paths.
- Next.js / Expo API routes / Edge: move lookups like `GET /users?email=` to `POST /users/lookup` with a zod body; redact query strings in request logs.
- Search with PII (support tools): POST body + rate limit (HARD-01).

### URL-02 · Tokens in URLs only as short-lived, single-use codes (PKCE)
**Severity guide:** P0 when a long-lived credential (refresh token, API key, device-session secret, reusable invite) travels in a URL · P1 when OAuth/magic link uses the implicit flow (`#access_token=` in the redirect) or the app parses tokens from the URL · P2 when PKCE is used but the code is logged.
**Signals:** `token-in-url`, `supabase-pkce` (absence), `auth-session-lib`, `deeplink-handler`; `urlParams.app` (`code`, `token`, `access_token`).
**How to verify:**
1. Read the Supabase client config: `flowType: 'pkce'`, `detectSessionInUrl: false` (AUTH-01).
2. Read the auth callback route/handler: it should take `code` (PKCE) or `token_hash` + `type` (email OTP links) and call `exchangeCodeForSession(code)` / `verifyOtp({ token_hash, type })`. Parsing `access_token`/`refresh_token` from `#fragment` = implicit flow.
3. Custom magic links/invites: confirm the server stores a hash, the code expires in minutes/hours and is marked used atomically (AUTH-13).
4. Check that the callback URL is not sent to analytics/Sentry (navigation breadcrumbs, screen tracking) before the code is consumed.
**Not a problem when:** PKCE `code` (bound to the verifier on the device, single use, short-lived) or Supabase `token_hash` in a link; Supabase email templates updated to use `{{ .TokenHash }}`.
**Fix:** PKCE flow from `skills/backend/references/auth-sessions.md` §4; for invites, exchange once for a device session (§11); scrub `code`/`token` params in Sentry breadcrumbs (client-security pattern) and clear the URL from navigation after consumption (`router.replace('/home')`).

### URL-03 · Expo Router params carry ids, not PII or secrets
**Severity guide:** P1 when `router.push`/`<Link href>`/`router.replace` pass email, phone, OTP, password, tokens, or full objects as params · P2 when large non-sensitive objects are serialized into params.
**Signals:** `route-params-sensitive`, `search-params-sensitive`; grep `useLocalSearchParams`, `useGlobalSearchParams`.
**How to verify:**
1. Grep `router.(push|replace|navigate)\(\{[^}]*params` and `href={{ pathname, params }}`. Params that do not match a dynamic segment become query string: `router.push({ pathname: '/verify', params: { email } })` → `/verify?email=…`.
2. That URL is: the navigation state, the value of `usePathname`/`useGlobalSearchParams`, what screen-tracking analytics and Sentry navigation integrations record, and a deep link anyone can craft.
3. Check the receiving screen does not trust the param (e.g. `/reset-password?email=` deciding whose password to change).
**Not a problem when:** params are opaque ids re-authorized on fetch; or non-sensitive UI state (`tab=reviews`).
**Fix:** pass an id and fetch, or hand off transient data through an in-memory store:
```ts
// before navigation
useSignupDraft.getState().set({ email });
router.push('/verify');
// verify screen
const email = useSignupDraft((s) => s.email); // never in the URL
```
Configure analytics to send route templates (`/patient/[id]`), not resolved URLs (DATA-02).

### URL-04 · Every deep link validated; links never trigger actions without confirmation + auth
**Severity guide:** P1 when a link can perform a state-changing action (accept invite, transfer, delete, subscribe, change email, join org) without an explicit confirm UI and a valid session, or when params flow unvalidated into queries/WebViews/`Linking.openURL` · P2 when validation is ad hoc but no action is reachable.
**Signals:** `deeplink-handler`, `route-params-sensitive`, `client-redirect-param`; `config.scheme`, `config.android.intentFilters`, `config.ios.associatedDomains`; notification response handlers.
**How to verify:**
1. Enumerate entry points: Expo Router routes (every file under `app/` is reachable by URL, including `(group)` routes and dynamic `[id]` screens), `+native-intent.tsx` (`redirectSystemPath`), `Linking.addEventListener('url')`, `useURL`, `Linking.getInitialURL`, push `data.url`, QR scanners.
2. For each: are params parsed with a schema (`z.string().uuid()`), unknown params ignored, and the user's auth/role checked before rendering? Protected routes must sit behind an auth-guarded layout (`Stack.Protected` / redirect in `_layout`), not rely on "nobody knows the URL".
3. For actions: does landing on the screen perform the mutation in `useEffect`? That is a link-triggered CSRF. It must require a button press, show what will happen, and the server must authorize it.
4. Check params are not passed into `WebView source`, `Linking.openURL`, `router.replace` (URL-05) or SQL/RPC filters without validation.
**Not a problem when:** read-only screens whose data is fetched with the user's session and authorized server-side; invite links that land on a confirm screen.
**Fix:** central `parseDeepLink()` allow-list (client-security CSEC-09 pattern) plus a per-route zod schema:
```ts
const InviteParams = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).strict();
const parsed = InviteParams.safeParse(useLocalSearchParams());
if (!parsed.success) return <Redirect href="/" />;
// render a confirm screen; the mutation runs on button press, server re-checks auth + invite state
```
In `app/+native-intent.tsx`, rewrite or drop unknown incoming paths before Expo Router handles them.

### URL-05 · No open redirects
**Severity guide:** P1 when a server route redirects to a client-controlled `next`/`redirect_to`/`returnUrl`/`callbackUrl`, or the app calls `router.replace(params.next)` / `Linking.openURL(params.url)` / `WebBrowser.openBrowserAsync(params.url)` with unvalidated input (phishing, OAuth code theft, navigation to internal-only screens) · P2 when validation exists but uses `startsWith('/')` only (`//evil.example` passes).
**Signals:** `open-redirect` (server), `client-redirect-param` (client); `urlParams.api` (`next`, `redirect`, `returnTo`).
**How to verify:**
1. Server: grep `redirect(`, `NextResponse.redirect(`, `Response.redirect(`, `Location` header built from `searchParams`/body.
2. Client: grep `router.(replace|push)\(.*params`, `Linking.openURL(` and `openBrowserAsync(` with route params or API data.
3. Test mentally: `//evil.example`, `/\evil.example`, `https:evil.example`, `javascript:…`, `%2F%2Fevil.example`, `myapp://…` other scheme.
**Not a problem when:** the target is chosen from a server-side allow-list by key (`?next=billing` → `/settings/billing`).
**Fix (server and client):**
```ts
export function safeNext(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  try {
    const u = new URL(raw, 'https://internal.invalid');
    if (u.origin !== 'https://internal.invalid') return fallback;
    return `${u.pathname}${u.search}`;
  } catch { return fallback; }
}
// client: additionally allow-list route prefixes
const ROUTES = ['/home', '/settings', '/invite'];
const next = safeNext(params.next, '/home');
router.replace(ROUTES.some((p) => next === p || next.startsWith(`${p}/`)) ? next : '/home');
```
External URLs: allow-list hosts before `Linking.openURL`.

### URL-06 · Universal Links / App Links verified; custom scheme not used for secrets
**Severity guide:** P1 when auth callbacks, password reset or invite links rely on a custom scheme (`myapp://`) without PKCE (any app can register the same scheme and receive the URL), or when `autoVerify` intent filters point to a domain whose `assetlinks.json` is missing/wrong · P2 when verification files exist but are stale (old signing fingerprint, missing paths).
**Signals:** `config.scheme`, `config.ios.associatedDomains`, `config.android.intentFilters`, `deeplink-handler`.
**How to verify:**
1. iOS: `ios.associatedDomains` contains `applinks:<domain>`; `https://<domain>/.well-known/apple-app-site-association` serves JSON (no redirect) with `TEAMID.bundleId` and `components` limited to the needed paths.
2. Android: `android.intentFilters` entry with `autoVerify: true`, `scheme: 'https'`, the host and `pathPrefix`; `https://<domain>/.well-known/assetlinks.json` lists the package and the **Play App Signing** SHA-256 fingerprint (plus upload/EAS key for internal builds). Since Android 12, unverified https links open in the browser instead of the app.
3. Check which links are custom-scheme only: anything carrying a code/token must be PKCE-bound (URL-02) or moved to a verified https link.
**Not a problem when:** custom scheme is used only for non-sensitive navigation or for PKCE callbacks where interception yields nothing without the verifier.
**Fix:**
```json
{ "expo": {
  "ios": { "associatedDomains": ["applinks:app.example.com"] },
  "android": { "intentFilters": [{
    "action": "VIEW", "autoVerify": true,
    "data": [{ "scheme": "https", "host": "app.example.com", "pathPrefix": "/invite" }],
    "category": ["BROWSABLE", "DEFAULT"] }] } } }
```
Host the two well-known files (Next.js `public/.well-known/` or a route handler returning `application/json`); verify with `adb shell pm get-app-links <package>` and Apple's AASA validator/CDN.

### URL-07 · OAuth / Supabase redirect URI allow-lists are tight
**Severity guide:** P1 when Supabase Auth "Redirect URLs" or the IdP (Google/Apple/GitHub) allow broad wildcards (`https://*.vercel.app/**`, `**`), production allows `http://localhost`, or preview domains of any project are accepted · P2 when stale entries remain.
**Signals:** `auth-session-lib` (`makeRedirectUri`), `supabase-pkce`, `config.scheme`; read `supabase/config.toml` `[auth] site_url` / `additional_redirect_urls`.
**How to verify:**
1. Read `config.toml` and the redirect URIs built in code (`makeRedirectUri({ scheme, path: 'auth/callback' })`, `redirectTo` / `emailRedirectTo` options).
2. If dashboard access exists, compare production Auth URL configuration and IdP console settings; otherwise list "verify in dashboard" in the report.
3. Check `redirectTo` is never taken from user input (URL-05).
**Not a problem when:** exact entries for the app scheme path, the production web origin, and a team-scoped preview pattern (Vercel preview URLs of your own team only, e.g. `https://*-<team-slug>.vercel.app/**`) on the staging project only.
**Fix:** exact URIs per environment; separate Supabase projects for preview/staging; `exp://` and `localhost` only on the development project; Google/Apple consoles with exact redirect URIs.

### URL-08 · In-app browser and referrer do not leak tokens or sessions
**Severity guide:** P1 when pages opened with tokens in the URL link to third-party resources (the full URL is sent as `Referer`), or when the app opens user-supplied URLs in an in-app browser/WebView without host checks · P2 when `openAuthSessionAsync` shares Safari cookies on shared devices without `preferEphemeralSession`, or web pages lack `Referrer-Policy`.
**Signals:** `auth-session-lib`, `webview-usage`, `token-in-url`, `client-redirect-param`; `webHardening[].securityHeaders` (Referrer-Policy).
**How to verify:**
1. Grep `WebBrowser.openBrowserAsync`, `openAuthSessionAsync`, `Linking.openURL` and list URL sources (static, API, user content).
2. For pages served by your web/API with tokens in the URL (reset password, invite landing): check `Referrer-Policy: no-referrer` and that the token is consumed and removed (`history.replaceState`) before third-party scripts load.
3. Auth sessions: `openAuthSessionAsync(url, redirect, { preferEphemeralSession: true })` (iOS) when shared devices or account switching matter.
**Not a problem when:** static, first-party URLs; tokens not present in any URL (URL-01/02).
**Fix:** `Referrer-Policy: no-referrer` on token-bearing pages (HARD-05); move tokens to POST bodies; allow-list hosts before opening external URLs; open untrusted links in the system browser rather than a WebView with a bridge (PLAT-04).
