# API hardening and supply chain (HARD-01..10, SUP-01..05)

Controls around the API surface that are not authorization itself (authz/RLS/BOLA live in `skills/audit/references/checks/backend.md` BE-A01..17 and `skills/backend/references/api-security-checklist.md`): abuse limits, input/upload limits, webhooks, browser-facing protections, error hygiene, idempotency and monitoring. Plus the dependency supply chain that every build trusts.
Findings: HARD under `category: backend`, `area: api-hardening` (in direct-db mode, map limits to Supabase settings/RPCs/buckets). SUP under `category: deps`, `area: supply-chain` (same category as the audit's dependency checks); DEP-C05/C06/C03/C04/C09/C17 in `skills/audit/references/checks/deps.md` cover the hygiene side — do not double-report, add the security angle.
Read shared helpers first (`api.sharedHelpers[]`, `api.middleware`, handler wrappers in `skills/backend/references/api-nextjs-vercel.md`, `api-supabase-edge.md`, `api-expo-routes.md`): routes inherit limits, headers and error mapping from them.

| ID | Check | Typical severity |
|---|---|---|
| HARD-01 | Rate limits on auth, OTP, reset, search and expensive endpoints (per user + per IP) | P1 |
| HARD-02 | Body size and upload validation (size, magic bytes, re-encode, server-chosen paths) | P1 |
| HARD-03 | Webhooks verified (signature over raw body, timing-safe, replay window, idempotent) | P0 |
| HARD-04 | CORS only for real web origins, never `*` with credentials | P2 (P1 with cookies) |
| HARD-05 | Security headers on web/API responses (HSTS, CSP, nosniff, frame-ancestors, Referrer-Policy) | P2 (P1 web app with auth) |
| HARD-06 | CSRF and cookie flags when cookie auth exists | P1 |
| HARD-07 | Errors do not leak stacks, SQL, upstream details | P1 |
| HARD-08 | Timeouts, pagination caps, resource limits | P1 |
| HARD-09 | Idempotency keys on payments and value-creating mutations | P1 (P2 non-payment) |
| HARD-10 | Security logging, monitoring and alerting without PII | P2 (P1 no auth-failure visibility) |
| SUP-01 | Lockfile committed, frozen installs in CI/EAS | P1 |
| SUP-02 | `npm audit --omit=dev --audit-level=high` gate | P2 (P1 reachable high/critical) |
| SUP-03 | Dependencies with install scripts reviewed/allow-listed | P2 (P1 unknown) |
| SUP-04 | No dependencies from git/URL/tarball without pinning | P1 (P2 pinned) |
| SUP-05 | No abandoned/typosquatted packages; patches and config plugins reviewed | P1 |

---

### HARD-01 · Rate limits on sensitive and expensive endpoints
**Severity guide:** P1 when login/OTP/invite exchange/password reset/sign-up (custom endpoints), SMS/email senders, AI/export/search endpoints have no limit · P2 for ordinary CRUD without limits · P0 only if missing limits enable cheap brute force of short codes (6-digit OTP/invite without lockout).
**Signals:** `api.routesWithoutInlineRateLimit`, `api.middleware`, `api.sharedHelpers[]`; `stack.libs` (`@upstash/ratelimit`); `supabase/config.toml` `[auth.rate_limit]`.
**How to verify:**
1. Read the limiter helper and where it is applied (wrapper vs per route). A route in `routesWithoutInlineRateLimit` may still be covered by a wrapper or Vercel WAF rule.
2. Keys: per verified user id **and** per IP for authenticated routes; per IP **and** per identifier (hashed email/phone, invite id) for unauthenticated auth flows. IP from `x-forwarded-for` first hop on Vercel; `x-real-ip` fallback.
3. Supabase Auth built-ins: check `config.toml` rate limits (email sent, SMS sent, token verifications, sign-ins) and CAPTCHA for sign-up/OTP if abused.
4. Direct-db: PostgREST has no per-user rate limit; expensive RPCs need a DB-backed counter (`hit_rate_limit` pattern in `api-supabase-edge.md`) or move behind an Edge Function.
**Not a problem when:** limits live in a shared wrapper, Vercel WAF rate-limit rules, or Supabase Auth handles the flow end to end.
**Fix:** Upstash `Ratelimit.slidingWindow` (`api-nextjs-vercel.md` `rate-limit.ts`), return `429` + `Retry-After`; Vercel WAF rule for `/api/v1/auth/*` as a pre-function layer; Edge Functions: DB-backed counter or Upstash REST; exponential lockout on repeated OTP failures per identifier.

### HARD-02 · Body size and upload validation
**Severity guide:** P1 when uploads accept any size/type, the client chooses the storage path/bucket, or MIME is trusted from the `Content-Type`/file extension; or JSON bodies are unbounded · P0 when a client-chosen path can overwrite another user's object (`upload-no-validation` + path from request).
**Signals:** `upload-no-validation`, `mass-assignment`; grep `.storage.from(`, `createSignedUploadUrl`, `upload(`, `formData()`, `req.json()`.
**How to verify:**
1. JSON: body read through a size-capped helper (`readJson(req, maxBytes)`); Vercel functions cap requests at ~4.5 MB, but your own limit should be far lower for JSON.
2. Uploads in direct-db mode: bucket `file_size_limit` and `allowed_mime_types` set; `storage.objects` policies pin the first folder to `auth.uid()`; bucket private.
3. Uploads via API: server builds the path (`${userId}/${crypto.randomUUID()}.jpg`) and mints `createSignedUploadUrl(path)`; never accept `path`/`bucket` from the body.
4. Content: sniff magic bytes (e.g. `file-type` `fileTypeFromBuffer`) rather than trusting `Content-Type`; images re-encoded (`sharp` in a Node runtime) to strip EXIF/GPS and polyglot payloads; SVG/HTML never served inline from the user bucket.
**Not a problem when:** a public, admin-only bucket for marketing assets.
**Fix:**
```sql
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = '{image/jpeg,image/png,image/webp}' where id = 'avatars';
create policy "own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
```
Client: re-encode before upload (`expo-image-manipulator`) to cut size and metadata — but validate server-side regardless.

### HARD-03 · Webhooks verified
**Severity guide:** P0 when a webhook that changes entitlements, payments, orders or user state is accepted without signature/secret verification, or verification runs over re-serialized JSON (always fails → someone "temporarily" disabled it) · P1 when no replay window or no idempotency · P2 when secret compare is not timing-safe for low-value hooks.
**Signals:** `webhook-no-signature`; `api.routesWithoutAuthSignal` entries with `publicMarker`; `supabase/config.toml` `verify_jwt = false` functions.
**How to verify:**
1. Raw body: App Router/Expo API routes/Edge use `await req.text()` (or `arrayBuffer`) before any `req.json()`.
2. Stripe: `stripe.webhooks.constructEvent(raw, sig, secret)` (Node) / `constructEventAsync(..., Stripe.createSubtleCryptoProvider())` (Deno/Workers); default 300 s tolerance kept.
3. Svix-based providers: `new Webhook(secret).verify(raw, { 'svix-id', 'svix-timestamp', 'svix-signature' })`.
4. RevenueCat / shared-secret hooks: Authorization header compared timing-safe (Node `crypto.timingSafeEqual` on equal-length digests; Deno `timingSafeEqual` from `jsr:@std/crypto`).
5. Idempotency: `insert into webhook_events(id)` with a unique key before side effects; duplicates return 200 without acting. Entitlements re-fetched from the provider API rather than trusted from the payload.
**Not a problem when:** the endpoint only logs/acknowledges and triggers an authenticated re-fetch.
**Fix:** template in `api-nextjs-vercel.md` (Webhook section) / `api-supabase-edge.md`; rotate the webhook secret if it was ever committed (SECR-04).
```ts
const digest = (s: string) => createHash('sha256').update(s).digest();
const ok = timingSafeEqual(digest(req.headers.get('authorization') ?? ''), digest(`Bearer ${process.env.REVENUECAT_WEBHOOK_AUTH}`));
```

### HARD-04 · CORS only for real web origins
**Severity guide:** P1 when `Access-Control-Allow-Origin` reflects any origin or is `*` together with `Access-Control-Allow-Credentials: true` or cookie auth · P2 for `*` on a Bearer-only API (unnecessary surface) · not applicable for native-only APIs with no CORS headers.
**Signals:** `api.corsWildcard`, `webHardening[].corsWildcard`, `api.middleware`.
**How to verify:** read the CORS helper/proxy; check whether any web client exists (Expo web build, Next.js front end on another origin). Native apps do not enforce CORS — they need none. Edge Functions' default `corsHeaders` use `*`; acceptable only for Bearer APIs without cookies.
**Not a problem when:** `*` on public, unauthenticated, read-only data; same-origin web build.
**Fix:** allow-list and echo:
```ts
const ALLOWED = new Set(['https://app.example.com']);
const origin = req.headers.get('origin');
const cors = origin && ALLOWED.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
```

### HARD-05 · Security headers on web/API responses
**Severity guide:** P1 when a web app with authenticated sessions (Next.js front end, Expo web build storing tokens in `localStorage`) has no CSP and no `frame-ancestors` · P2 for missing headers on JSON-only APIs (`nosniff`, `Cache-Control: no-store`, `Referrer-Policy`).
**Signals:** `webHardening[].securityHeaders` (`hsts`, `csp`, `noSniff`, `frameProtection`, `referrerPolicy`, `permissionsPolicy`); read `next.config.*` `headers()`, `proxy.ts` (Next.js 16) / `middleware.ts` (15), `vercel.json` `headers`.
**How to verify:** list headers set for `/(.*)` and `/api/(.*)`; check CSP is not `unsafe-inline` + `unsafe-eval` everywhere; HSTS present (Vercel adds a default on its domains — confirm on custom domains before adding `preload`).
**Not a problem when:** native-only API with the base headers from `withApiHandler` (`no-store`, `nosniff`, `Referrer-Policy: no-referrer`).
**Fix (Next.js):**
```ts
// next.config.ts
const security = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];
export default { async headers() { return [{ source: '/(.*)', headers: security }, { source: '/api/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] }]; } };
```
Full script CSP with nonces: generate a nonce per request in `proxy.ts`, set `script-src 'self' 'nonce-…' 'strict-dynamic'`, pass via request header (Next.js CSP guide). Edge Functions / Expo API routes: add headers in the shared response helper.

### HARD-06 · CSRF and cookie flags when cookie auth exists
**Severity guide:** P1 when a route handler authenticates via cookies and performs mutations without Origin/CSRF checks, or session cookies lack `Secure`/`SameSite` · not applicable when the API only accepts `Authorization: Bearer` (mobile default — browsers never attach it automatically).
**Signals:** `webHardening[].cookies` (`httpOnly`, `secure`, `sameSite`), `webHardening[].cookieAuth`, `webHardening[].csrfSignals`; grep `cookies()`, `Set-Cookie`, `@supabase/ssr`, `createServerClient`.
**How to verify:**
1. Does any API route accept cookie sessions (web front end with `@supabase/ssr`) as well as Bearer? Mixed auth needs the cookie path protected.
2. Next.js Server Actions compare `Origin` with host automatically; route handlers (`POST`/`PATCH`/`DELETE`) do not — check for an Origin allow-list or CSRF token.
3. Cookies: `Secure`, `SameSite=Lax` (or `Strict`), `HttpOnly` for cookies JS never needs; `Path`/`Domain` narrow. Note `@supabase/ssr` auth cookies are JS-readable by design — XSS defense (HARD-05) protects them.
4. No state-changing `GET` routes.
**Not a problem when:** Bearer-only API used by the mobile app.
**Fix:** reject cookie-authenticated mutations whose `Origin` is not allow-listed (`if (method !== 'GET' && !ALLOWED.has(req.headers.get('origin') ?? '')) return 403`); set cookie flags explicitly; prefer Bearer for API calls from the web app too.

### HARD-07 · Errors do not leak stacks, SQL or upstream details
**Severity guide:** P1 when responses include `error.message`/`stack` from Postgres/PostgREST (`details`, `hint`, constraint/table names), Stripe/LLM/email provider errors, or distinguish "user not found" from "wrong password" · P2 for verbose validation details on internal admin routes.
**Signals:** `api.errorLeaks`; grep `error: e.message`, `JSON.stringify(error)`, `return new Response(String(err)`, `error.details`, `error.hint`.
**How to verify:** read the error mapper first; then routes that bypass it (try/catch returning the raw error). Direct-db: RPCs that `raise exception '%', sqlerrm` or include row data in messages.
**Not a problem when:** `{ error: { code, message, requestId } }` with generic messages and zod issue paths (field names only) for 400s.
**Fix:** `withApiHandler` / `toErrorResponse` in `api-nextjs-vercel.md`; Edge `fail(status, code)` helper; map Postgres codes explicitly (`23505` → `conflict`); log details server-side with the request id (HARD-10).

### HARD-08 · Timeouts, pagination caps and resource limits
**Severity guide:** P1 when list/export/search endpoints accept unbounded `limit`, outbound fetches (LLM, payment, third-party APIs) have no timeout, or no `maxDuration`/statement timeout exists for heavy work · P2 for missing client-side fetch timeouts.
**Signals:** grep `limit`/`pageSize` parsing, `.range(`, `fetch(` without `signal`, `export const maxDuration`; `api.sharedHelpers[]`.
**How to verify:** read query schemas (`z.coerce.number().int().min(1).max(100)`), outbound fetch wrappers (`AbortSignal.timeout`), Vercel `maxDuration`, Postgres `statement_timeout` for the `authenticated` role, PostgREST `max_rows` (`[api] max_rows` in `config.toml`).
**Not a problem when:** limits are enforced by a shared schema helper and DB role settings.
**Fix:** `limit: z.coerce.number().int().min(1).max(100).default(20)`; `fetch(url, { signal: AbortSignal.timeout(10_000) })`; `alter role authenticated set statement_timeout = '8s'`; `max_rows = 1000`; queue long exports instead of synchronous requests.

### HARD-09 · Idempotency keys on payments and value-creating mutations
**Severity guide:** P1 for payment, order, credit, booking or invite creation without idempotency (mobile retries on flaky networks double-charge/double-create) · P2 for messages/comments.
**Signals:** grep `idempotency-key`, `Idempotency-Key`, Stripe `idempotencyKey`; `api.sharedHelpers[]` (`idempotency.ts`).
**How to verify:** client generates one key per user intent (`Crypto.randomUUID()` when the form opens, reused on retry); server stores `(user_id, key) → response` with a unique constraint and returns the stored response on replay; Stripe calls pass `{ idempotencyKey }`.
**Not a problem when:** the operation is naturally idempotent (`PUT` with a client-generated id and upsert).
**Fix:** `idempotency.ts` in `api-nextjs-vercel.md`; never regenerate the key inside the retry loop.

### HARD-10 · Security logging, monitoring and alerting without PII
**Severity guide:** P1 when there is no visibility into auth failures, 401/403/429 spikes or webhook signature failures in production · P2 when logs exist without alerts or retention policy. PII in logs is DATA-01/SECR-08.
**Signals:** `api.middleware`, logger helpers, `stack.libs` (Sentry, log drains); Supabase Auth audit logs.
**How to verify:** check that the wrapper logs `requestId`, route, status, latency and `userId` (no bodies/tokens); that these events are emitted: auth failures, rate-limit hits, authz denials (403/404 on owned resources), webhook verification failures, admin actions, account deletion; and that something alerts on spikes (Vercel log drain → alerting, Sentry alerts, Supabase log alerts).
**Not a problem when:** an early-stage app with structured logs and a documented manual review cadence (still P2).
**Fix:** structured security events (`{ type: 'auth_failed', reason, ipHash, requestId }`); alert thresholds on 401/429/webhook failures; retention set in the log drain; Supabase Auth audit log reviewed for admin actions.

---

### SUP-01 · Lockfile committed, frozen installs in CI/EAS
**Severity guide:** P1 when no lockfile is committed, several lockfiles coexist, or CI runs `npm install` (resolves new versions at build time — a compromised release ships without review) · P2 when lockfile exists but CI is not frozen.
**Signals:** `supplyChain[].lockfile`, `supplyChain[].lockfileTracked`, `supplyChain[].ci`; read `.github/workflows/*`, `eas.json` hooks.
**How to verify:** exactly one lockfile tracked; CI uses `npm ci` / `pnpm install --frozen-lockfile` / `yarn install --immutable` / `bun install --frozen-lockfile`; EAS builds use the lockfile (no hook deleting it).
**Not a problem when:** the repo is a library without an app (not this kit's target).
**Fix:** commit the lockfile; frozen installs; `npm audit signatures` in CI to verify registry signatures/provenance.

### SUP-02 · Vulnerability gate
**Severity guide:** P1 for reachable high/critical advisories in production dependencies (app or API) without a dated acceptance · P2 for missing CI gate or build-time-only advisories.
**Signals:** `supplyChain[]`; CI workflow content; see DEP-C03/C04.
**How to verify:** read-only `npm audit --omit=dev --audit-level=high` (only if `node_modules` exists and network is available); classify reachability (runtime app/API vs Metro/build tooling).
**Not a problem when:** advisories are build-time only with a dated risk acceptance.
**Fix:** CI step `npm audit --omit=dev --audit-level=high`; upgrade direct deps; `overrides` with care; risk acceptances with owner and expiry (deps.md pattern). Run the same gate in the API repo.

### SUP-03 · Install scripts reviewed and allow-listed
**Severity guide:** P1 when an unfamiliar package (low downloads, new maintainer, recent first publish) has `preinstall`/`install`/`postinstall` scripts, or scripts fetch binaries from non-registry hosts · P2 for known native/tooling packages without an allow-list.
**Signals:** `supplyChain[].installScripts`.
**How to verify:** for each entry: package name, version, script; known build tools (`esbuild`, `sharp`, `@sentry/cli`, `patch-package` via root `postinstall`) are expected. Install scripts run with the developer's and CI's credentials (npm tokens, `EXPO_TOKEN`, cloud keys) — self-propagating npm worms have stolen tokens exactly this way.
**Not a problem when:** well-known packages with the expected script, pinned in the lockfile.
**Fix:** pnpm: lifecycle scripts blocked by default, allow via `onlyBuiltDependencies`; bun: `trustedDependencies`; npm: `ignore-scripts=true` in `.npmrc` + explicit `npm rebuild <pkg>` for needed ones. Keep CI tokens least-privilege and short-lived; consider a minimum release age (recent pnpm `minimumReleaseAge`).

### SUP-04 · No dependencies from git/URL/tarball without pinning
**Severity guide:** P1 for git deps on a branch/tag (`github:org/repo#main`), HTTP tarballs, or non-registry URLs in production deps · P2 for git deps pinned to a full commit SHA from a trusted org.
**Signals:** `supplyChain[].nonRegistryDependencies`; DEP-C17.
**How to verify:** read `package.json` entries; check lockfile `resolved` URLs point to the registry; flag `file:`/`link:` deps outside a monorepo workspace.
**Not a problem when:** workspace protocol (`workspace:*`) inside a monorepo.
**Fix:** publish a fork to a scoped package or pin a commit SHA with `integrity` in the lockfile; prefer upstream releases + `patch-package`.

### SUP-05 · No abandoned/typosquatted packages; patches and config plugins reviewed
**Severity guide:** P1 for a likely typosquat (name one edit away from a popular package, few downloads, recent first publish), a package with an install script and no repository, a `patches/*.patch` adding network calls/`eval`/secret reads, or an Expo config plugin from an unknown author · P2 for abandoned packages (security fixes unlikely).
**Signals:** `supplyChain[].patches`, `supplyChain[].installScripts`; `plugins` in app config; DEP-C08/C09.
**How to verify:**
1. Names: compare unfamiliar dependency names with well-known ones (scope confusion `@expo/` vs look-alike scopes, hyphen/plural variants). With network: `npm view <pkg> time.created maintainers repository dist.signatures`.
2. Patches: read each patch diff — expected are small bug fixes; flag new `fetch`/`http`, `child_process`, `eval`, env reads, or disabled certificate checks.
3. Config plugins: they run in Node at prebuild/EAS build with full filesystem/env access and edit native projects (manifest, Info.plist, Gradle). Check author/repo/downloads; read the plugin source for network calls and manifest changes (PLAT-07).
**Not a problem when:** first-party Expo/React Native/Supabase/Sentry packages and widely used community libraries with active maintenance.
**Fix:** replace suspicious/abandoned packages; document each patch (deps.md pattern); vendor tiny config plugins into `plugins/` in the repo so changes are reviewed; dependency review on PRs (lockfile diff review, supply-chain scanners or GitHub dependency review).
