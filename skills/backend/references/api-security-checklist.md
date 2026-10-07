# API security checklist for mobile backends (OWASP API Security Top 10, 2023)

Applies to API mode (Next.js routes, Edge Functions, Expo API routes) and to direct-db mode, where PostgREST + RLS + RPCs are your API. Every item has a test you can run with two test accounts (A, B), the app's public key, and curl/a script. Never run destructive tests against production data.

Assume the attacker has: the decompiled app (all endpoints, public keys, request shapes), a valid account of their own, and unlimited requests.

## API1:2023 Broken Object Level Authorization (BOLA / IDOR)

Every object id from the client (path, query, body, headers, nested arrays) is checked against the verified caller.

- Do: scope queries by verified user/membership (`where id = $1 and owner_id = $auth`), or use a user-scoped client so RLS applies. Return 404 for objects the caller cannot see.
- Watch: bulk endpoints (`ids: [...]`), nested ids (`projectId` in a note create), signed-URL minting endpoints, exports, realtime channel names, storage paths.
- Test: with A's token request B's resource ids on every route/table/RPC/bucket path → must be 404/403/empty. Create an object under B's parent id with A's token → must fail.

## API2:2023 Broken Authentication

- Do: verify JWTs server-side (signature via JWKS, `iss`, `aud`, `exp`) or `getUser`/`getClaims`; never decode-only; never `getSession()` on server. Device-session/invite secrets stored as peppered hashes, compared in constant time. Rate-limit and lock out login/OTP/invite/reset. Refresh token rotation on (Supabase default).
- Test: no token → 401. Token signed with a random key / `alg: none` / expired / from another project → 401. Revoked device session → 401 + client wipe. 50 OTP attempts in a minute → 429.

## API3:2023 Broken Object Property Level Authorization (BOPLA: mass assignment + excessive exposure)

- Do: `.strict()` zod schemas on input; server sets `user_id`, `role`, `status`, `price`, `plan`, `verified`. Responses select explicit columns; separate tables for sensitive columns; RLS `with check` pins ownership in direct-db.
- Test: send extra fields (`role: 'admin'`, `user_id: B`, `price: 0`, `is_verified: true`) → ignored or 400. Inspect every response for fields the UI does not render (internal notes, other users' emails/phones, hashes, cost data).

## API4:2023 Unrestricted Resource Consumption

- Do: body size caps, pagination with max `limit`, upload size/MIME limits on buckets, timeouts on outbound calls, `maxDuration`, per-user and per-IP rate limits, quotas on costly operations (AI, SMS, email, exports, image processing), DB statement timeouts.
- Test: `?limit=100000` → capped. 5 MB JSON body → 413. 200 requests/min from one user → 429. Request an export 20 times → rejected/queued. SMS/email-sending endpoint hammered → limited (cost attack).

## API5:2023 Broken Function Level Authorization (BFLA)

- Do: admin/staff/coach routes check role from `app_metadata` or a roles table server-side; separate route prefixes (`/api/v1/admin/*`) with a guard; RPCs that perform privileged actions revoke `execute` from `anon`/`authenticated` or check role inside.
- Test: call every admin route and privileged RPC with a regular user token → 403. Change HTTP method (GET→DELETE/PATCH) on user routes → 405 or authorized. Set `user_metadata.role = 'admin'` via `updateUser` and retry → still 403.

## API6:2023 Unrestricted Access to Sensitive Business Flows

Flows that are harmful when automated: sign-up, invites, referrals/credits, purchases/trials, booking slots, messaging, vote/like, password reset emails.
- Do: per-account and per-device limits, idempotency keys, server-side eligibility checks (one trial per account/payment method/device), CAPTCHA/App Attest/Play Integrity on abuse-prone flows, anomaly alerts.
- Test: script 100 invites/sign-ups/bookings → limited; replay the same purchase/credit request with a new idempotency key → server-side eligibility still blocks.

## API7:2023 Server Side Request Forgery (SSRF)

Any server fetch of a client-supplied URL (avatar from URL, link previews, webhooks you call, import from URL, image proxy).
- Do: allow-list hosts/schemes, resolve and block private/link-local ranges (169.254.169.254, 10/8, 172.16/12, 192.168/16, localhost, IPv6 equivalents), no redirects to disallowed hosts, timeouts, size caps.
- Test: submit `http://169.254.169.254/latest/meta-data/`, `http://localhost:5432`, `file:///etc/passwd`, a redirector URL → rejected.

## API8:2023 Security Misconfiguration

- Do: HTTPS only; CORS allow-list (or none for native-only); `Cache-Control: no-store` on user data; generic errors (no stack/SQL/upstream messages); security headers; secrets only in server env; RLS on every exposed table; `security_invoker` views; definer functions with `set search_path = ''`; private buckets; Realtime private channels; Supabase advisors clean; debug/verbose logging off; Vercel preview deployments protected.
- Test: trigger errors (bad uuid, unique violation, upstream failure) → generic `{error:{code,message}}`. `curl -H 'Origin: https://evil.example'` → no reflected ACAO with credentials. Run `get_advisors` security → zero errors.

## API9:2023 Improper Inventory Management

- Do: versioned routes (`/api/v1`), an inventory (OpenAPI spec generated in CI, list of Edge Functions with their `verify_jwt` mode, list of RPCs executable by `authenticated`/`anon`, list of tables the app touches directly), deprecation headers and removal dates tied to minimum supported app version, staging/preview isolated from production data, no forgotten test/seed/debug routes or functions.
- Test: diff deployed routes/functions/RPCs against the inventory; `GET /api/test`, `/api/debug`, `/api/seed`, `/api/v0/*` → 404 in production. Old app version against current API → still works or gets a force-update response.

## API10:2023 Unsafe Consumption of APIs

Third-party responses (Stripe, RevenueCat, OpenAI, maps, email providers, partner APIs) are untrusted input.
- Do: verify webhook signatures; re-fetch authoritative state instead of trusting webhook payloads for entitlements; validate third-party responses with schemas; timeouts + retries with backoff; HTTPS; never pass third-party content to SQL/HTML/eval; treat LLM output as untrusted (no direct tool execution or SQL).
- Test: send an unsigned/forged webhook → 400 and no state change. Replay a valid webhook → no double effect (idempotent event table). Mock upstream returning malformed JSON / huge payload / slow response → handled with generic error within timeout.

## Mobile-specific additions

- Anything in the app is public: endpoints, keys, request shapes. Security by obscurity of URLs is zero.
- App attestation (App Attest / Play Integrity, e.g. Firebase App Check) raises the cost of scripted abuse; it is not authentication.
- Old app versions live for months: never ship a fix that relies on clients updating (fix server-side, then force update if needed).
- Certificate pinning: optional, operationally risky (rotation bricks old builds); prioritize server-side controls.
- Push payloads: no personal data or tokens; fetch content after open.

## Pre-launch gate

All must be true (P0 if not, unless marked):

1. No server secret in the app bundle, `eas.json`, `EXPO_PUBLIC_*`, or git history (rotated if ever leaked).
2. Every table in exposed schemas has RLS; no `using (true)` on user data; no `user_metadata` in authorization; views `security_invoker`; definer functions with `search_path = ''` and auth checks (P1 if only search_path missing).
3. Every non-public API route verifies JWTs (no decode-only) and authorizes each object id (BOLA test passes for A↔B on all routes).
4. Webhooks verify signatures and are idempotent.
5. Private storage buckets for user files; media for shared viewers via server-minted short-TTL signed URLs.
6. Rate limits on login/OTP/invite/reset and on cost-bearing endpoints (P1).
7. Inputs validated with strict schemas on all mutations (P1); errors generic (P1).
8. Session stored in SecureStore/encrypted store; PKCE for OAuth/magic links (P1); sign-out wipes caches (P1).
9. Account deletion available in-app, revoking sessions and deleting storage objects.
10. Supabase advisors (security) show no errors; performance advisors reviewed (P2).
11. Logs/analytics/crash reports contain no tokens or sensitive personal data (P1).
12. Inventory documented: routes + functions + RPCs + direct-access tables, with versioning and min-supported-app-version policy (P2).
