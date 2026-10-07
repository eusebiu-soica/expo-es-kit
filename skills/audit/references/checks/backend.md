# Backend checks (category `backend`)

Scope: the trust boundary behind the app: Postgres RLS/grants/functions/storage when the app talks to Supabase directly, and route-level authn/authz/validation/limits when it calls an API.

Check-IDs are stable references. Finding `id`s follow `shared/contract.md` (`BE-001`, … per report). `n/a` when `backend.mode` is `none` and there is no `api` root.

Pick sections from `backend.mode` (scan JSON):

| `backend.mode` | Audit |
|---|---|
| `direct-db` | Mode direct-db |
| `api` | Mode api |
| `hybrid` | Both. Additionally list which tables the app reads/writes directly (`hits.supabase-table-access` samples) and confirm each one is meant to be client-accessible; everything else must be server-only (RLS on, no policies for `anon`/`authenticated`). |
| `none` with `appMigrations` or `api` non-null | Audit whatever exists; mode detection may have missed a wrapper. |

Implementation references: `skills/backend/references/modes.md`, `direct-db-supabase.md`, `api-nextjs-vercel.md`, `api-supabase-edge.md`, `api-expo-routes.md`, `api-security-checklist.md`.

---

## Mode direct-db

### Signals to start from

| Signal | Meaning | Next step |
|---|---|---|
| `appMigrations` / `api.migrations` null | No SQL in repo | Ask for DB access (Supabase MCP `list_tables`, `execute_sql`, `get_advisors`) or the schema dump. Without it, cap confidence at `low` and say so in `notes`. |
| `appMigrations.tablesWithoutRls[]` | `public` tables created without `enable row level security` in migrations | P0 if the table is reachable with the anon/publishable key (all `public` tables are, via PostgREST, unless grants were revoked). Verify live with the SQL below: migrations can be out of sync. |
| `appMigrations.tablesRlsNoPolicies[]` | RLS on, zero policies = deny-all for `anon`/`authenticated` | **Not a finding by itself.** Correct for server-only tables. Flag only if the app reads/writes the table directly (match against `hits.supabase-table-access` / realtime samples) — then it is a functional bug or someone will "fix" it with `using (true)`. |
| `appMigrations.securityDefinerWithoutSearchPath[]` | `security definer` function without `set search_path` | P1 (search_path hijack). P0 if it is executable by `anon` and touches sensitive data without an auth check. |
| `appMigrations.permissiveGrantsOrPolicies[]` | `grant … to anon` or `using (true)` policies | Read each: `using (true)` on reference/catalog data = fine; on user data = P0. |
| `appMigrations.authUidNotWrapped` (count) | `auth.uid()` not wrapped as `(select auth.uid())` | P2 performance (per-row evaluation). P1 if on large hot tables with measured slowness. |
| hits `supabase-table-access`, `supabase-rpc`, `supabase-storage`, `supabase-realtime` | What the app touches directly | Build the access inventory: table → operations → policy that allows it. |
| hit `supabase-signed-url` | Signed URLs created on the client | Fine for private buckets if storage policies restrict by owner path; prefer server-mediated. |
| hit `service-role-in-client` | Service role in app | P0 (report under `client-security`, cross-reference). |

### Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| BE-D01 | RLS enabled on every table in exposed schemas (`public`, any schema listed in API settings) | SQL: tables without RLS (below). | P0 for any table with user data | `alter table … enable row level security;` + policies |
| BE-D02 | Policies per operation with `with check` on writes | List policies; `insert`/`update` without `with check` lets users write rows they cannot read/own (e.g. set `user_id` to someone else). `for all` policies hide intent. | P0 if ownership column writable to another user; P1 otherwise | Separate `select/insert/update/delete` policies; `with check ((select auth.uid()) = user_id)` |
| BE-D03 | Roles targeted explicitly | Policies `to authenticated` (or `anon` deliberately). Policies without `to` apply to `public` (incl. anon). | P1 when anon can read user data | `to authenticated` |
| BE-D04 | No `using (true)` / `with check (true)` on sensitive tables | `permissiveGrantsOrPolicies`. | P0 | Ownership/membership predicate |
| BE-D05 | Ownership never derived from client-provided ids | Policies compare to `auth.uid()`/membership tables, not to a column the client sets freely. App code passes `user_id` in inserts? Then `with check` must pin it; better a default `user_id uuid default auth.uid()`. | P0 if only client-provided ids gate access | Default + `with check` |
| BE-D06 | Authorization never reads `raw_user_meta_data` / `user_metadata` | Grep policies/functions for `user_metadata`, `raw_user_meta_data`, `auth.jwt() -> 'user_metadata'`. Users can edit it via `updateUser({ data })`. | P0 | `app_metadata` (server-set) or a `user_roles` table |
| BE-D07 | Security-definer functions safe | Each: `set search_path = ''` (fully qualified names inside), explicit `auth.uid()` checks, `revoke execute … from public, anon` where not needed. Prefer definer functions in a non-exposed schema. | P1 (P0 if anon-callable and leaks/mutates other users' data) | Template in `direct-db-supabase.md` |
| BE-D08 | Views do not bypass RLS | Views in exposed schemas created with `with (security_invoker = true)` (PG15+). Default views run as owner → bypass RLS. | P0 if a view exposes user data across users | `alter view … set (security_invoker = true);` |
| BE-D09 | Sensitive columns not exposed | Tables readable by the user don't carry columns the user should not see (internal notes, pricing cost, other parties' contact, hashes). RLS is row-level only. | P1 | Move to a separate table, column-level `revoke select (col)`, or expose via view/RPC |
| BE-D10 | Multi-step writes are RPCs, not client sequences | Client does insert A → insert B → update C. Partial failure leaves inconsistent state; business invariants enforced client-side are bypassable. | P1 when invariants (balances, quotas, status transitions) are client-enforced | `security invoker` RPC in one transaction, or move to API |
| BE-D11 | Storage buckets private + owner-scoped | Buckets with user files `public = false`; `storage.objects` policies scope by `bucket_id` and `(storage.foldername(name))[1] = (select auth.uid())::text`. Public buckets only for public assets. | P0 for public bucket with private user files; P1 for missing path scoping | Policies in `direct-db-supabase.md` |
| BE-D12 | Realtime authorized | `postgres_changes` respects RLS of the table (verify RLS). Broadcast/presence on private channels (`config: { private: true }`) with policies on `realtime.messages`. | P1 if channels carry user data without authorization | Private channels + policies |
| BE-D13 | Policy columns indexed, `auth.uid()` wrapped | Index on `user_id`/`org_id` used in policies; `(select auth.uid())`. | P2 (P1 if timeouts observed) | Index + wrap |
| BE-D14 | Supabase advisors clean | Supabase MCP `get_advisors` (type `security` and `performance`), or dashboard Advisors. Report security lints as findings (severity by impact). | per lint | Fix lints |
| BE-D15 | Migrations discipline | All schema changes in `supabase/migrations`; reproducible on empty Postgres (`supabase db reset`); destructive changes use expand → migrate/dual-write → contract. | P2 (P1 if prod drifted from migrations) | `supabase db diff`, CI `db reset` |

Verification SQL (run read-only via MCP `execute_sql` or psql):

```sql
-- Tables without RLS in exposed schemas
select n.nspname as schema, c.relname as table
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p') and n.nspname in ('public') and not c.relrowsecurity;

-- Policies per table
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname in ('public','storage') order by tablename, cmd;

-- Security definer functions without search_path
select p.oid::regprocedure as fn, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef and n.nspname not in ('pg_catalog','information_schema','auth','storage','realtime','extensions','graphql','vault')
  and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');

-- Functions executable by anon
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');

-- Views without security_invoker
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v' and n.nspname = 'public'
  and not exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o
                  where lower(o) in ('security_invoker=true','security_invoker=on','security_invoker=1'));
```

Black-box test (when DB access is missing but a test account exists): with the anon/publishable key and user A's token, `select` user B's row ids, `update` a row setting `user_id` to B, call each RPC with B's ids. Every attempt must return 0 rows / error.

---

## Mode api

### Read shared code first

Before flagging any individual route, read **once**:

1. Every entry in `api.sharedHelpers[]` (auth guard, handler wrapper, rate limiter, error mapper, CORS helper, idempotency helper).
2. `api.middleware[]` (`middleware.ts` / `proxy.ts`): matcher, what it enforces, which paths it excludes.
3. The Supabase/DB client factory (where service-role clients are created).

Then judge each route by what it actually inherits. A route without an inline auth signal that is wrapped by `withAuth(...)`, or covered by a proxy matcher that verifies tokens, is not missing auth. But proxy alone is not enough: if the proxy only checks for the presence of a header (no verification) or its matcher can be bypassed (path normalization, excluded prefixes), the route is unprotected. Next.js docs explicitly recommend verifying auth inside each handler rather than relying on proxy alone.

### Signals to start from

| Signal | Meaning | Next step |
|---|---|---|
| `api.sharedHelpers[]` | Auth/handler/rate/error helpers imported by routes (with usage count) | Read them first. Coverage = `usedInRoutes` vs `routeCount`. |
| `api.middleware[]` | Middleware/proxy file present | Read matcher + logic. |
| `api.routesWithoutAuthSignal[]` | Route files with no auth-looking call (`publicMarker` = looks intentionally public/webhook) | After reading helpers: still unauthenticated and not intentionally public = P0 if it reads/writes user data. |
| `api.decodeOnlyAuth[]` | `jwt-decode`/`decodeJwt`/`atob(split('.'))` without verify | P0: forged tokens accepted. |
| `api.routesWithoutValidation[]` | Mutating routes with no zod/valibot/parse signal | P1 (mass assignment, type confusion). Check if the wrapper validates. |
| `api.routesWithoutInlineRateLimit` (count) | Routes without inline limiter | Check wrapper/proxy/WAF. Auth/OTP/invite/expensive endpoints without any limit = P1. |
| `api.errorLeaks[]` | Responses include `error.message`/`stack`/stringified error | P1 (SQL, upstream, stack leakage); P2 if wrapper maps known errors only. |
| `api.corsWildcard[]` | `Access-Control-Allow-Origin: *` | P2 with Bearer-token auth (browsers do not attach it automatically); P1 if cookies/credentials are used or responses carry user data to any origin with cookies. Native apps do not need CORS at all. |
| `api.serviceRoleRoutes[]` | Routes using service-role/secret key | Each must authenticate + authorize the caller before the privileged query, and scope every query by the verified user id. |
| `api.migrations` | SQL inside the API repo | Also run Mode direct-db checks on it (deny-all RLS is fine for server-only tables). |
| `api.routes[]` `.idempotency` | Idempotency-Key handling present | Required for payments/order creation. |
| `api.next` | Next.js version | `>=16`: `proxy.ts` replaces `middleware.ts` (deprecated). Both are only pre-routing filters. |
| `appApiRoutes` | Expo `+api` routes inside the app repo | Audit them with the same checks; also confirm client components never import server modules. |

### Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| BE-A01 | Every non-public route authenticates with a verified token | Helper uses `supabase.auth.getUser(token)` / `getClaims(token)` / `jose.jwtVerify` with JWKS checking `iss`, `aud`, `exp`. | P0 (decode-only or no auth on user data) | `requireAuth()` in `api-nextjs-vercel.md` |
| BE-A02 | Object-level authorization (BOLA/IDOR) | For each route with an id in path/query/body: query is scoped by `userId` (or membership) from the verified token, or a user-scoped RLS client is used. Test: user A's token + user B's id → 403/404. | P0 | `where id = $1 and owner_id = $auth` / RLS client |
| BE-A03 | Function-level authorization (BFLA) | Admin/coach/staff routes check role from `app_metadata`/roles table, server-side. | P0 | `requireRole()` |
| BE-A04 | Input validated with schemas; no mass assignment | `safeParse` on params/query/body; `.strict()` objects; server sets `user_id`, `role`, `status`, prices. | P1 (P0 if client can set role/owner/price) | zod schemas |
| BE-A05 | Errors mapped, not leaked | Wrapper returns `{ error: { code, message } }` with generic messages; logs server-side with request id; no stack/SQL/upstream bodies. | P1 | `withApiHandler` |
| BE-A06 | Rate limits | Per user + IP; stricter on auth/OTP/invite/password reset/expensive AI or export routes. Platform WAF rules count. | P1 for auth-adjacent; P2 elsewhere | Upstash Ratelimit / Vercel WAF / DB-backed counters |
| BE-A07 | Resource limits | Body size cap, pagination `limit` max, timeouts on upstream fetches, `maxDuration` set. | P1 for unbounded list/export endpoints | zod `max()`, `AbortSignal.timeout` |
| BE-A08 | Service role used only after authz and scoped | Privileged client created per request in server code; never returned data beyond caller's scope. | P0 if privileged query uses client-provided ids without authz | Authorize first, scope by verified id |
| BE-A09 | Webhooks verified | Stripe/RevenueCat/etc.: signature over raw body (`await req.text()`), timestamp tolerance, idempotent event table (`unique(event_id)`). RevenueCat: shared Authorization header secret compared in constant time. | P0 (forged purchase events) | Webhook template |
| BE-A10 | Cron/internal routes protected | `Authorization: Bearer ${CRON_SECRET}` checked; internal endpoints not reachable without a secret. | P1 (P0 if it mutates/sends to all users) | Constant-time compare |
| BE-A11 | Secrets only in server env | No `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` secrets; server env set in Vercel / `supabase secrets` / EAS env. | P0 | Move + rotate |
| BE-A12 | Idempotency on mutations that create value | Payments, orders, invites, messages: `Idempotency-Key` header stored with response. | P1 for payments; P2 otherwise | Idempotency table |
| BE-A13 | CORS only for real web origins | Explicit allow-list; no `*` with credentials; native-only APIs need no CORS headers. | see signal | Allow-list |
| BE-A14 | Versioning and inventory | `/api/v1/...`; deprecated routes listed and removed; no debug/test routes in production (`/api/test`, `/api/seed`). | P1 for live debug/seed routes; P2 otherwise | Route inventory, OpenAPI |
| BE-A15 | Typed contract with the app | OpenAPI (`openapi-typescript`) or shared zod schemas; app does not hand-write response types that drift. | P2 | Generate types in CI |
| BE-A16 | Logging without PII/tokens | Structured logs with request id + user id; `Authorization`, cookies, bodies with personal data excluded. | P1 | Logger redaction |
| BE-A17 | Third-party/SSRF hygiene | Server fetches of user-supplied URLs are allow-listed; third-party responses validated before use; timeouts. | P1 (P0 if internal metadata/DB reachable) | Allow-list + schema |

Black-box tests (when a staging URL + two test accounts exist): call each route without a token (expect 401), with user A's token on user B's ids (expect 403/404), with a forged token signed by a random key (expect 401), with extra body fields `role`, `user_id`, `price` (expect ignored or 400), burst 50 requests on login/OTP (expect 429).

---

## Not a problem when

- RLS enabled with zero policies on tables only the server (service role/secret key, definer RPC) touches: deliberate deny-all.
- `using (true)` on `select` for genuinely public reference data (countries, plans, public catalog) with no write policy.
- `grant select … to anon` on public reference tables protected by `using (true)` select-only policy.
- `routesWithoutAuthSignal` entries that are webhooks (signature-verified), health checks, public catalog reads, or covered by a verified wrapper/proxy.
- `corsWildcard` on a Bearer-token API with no cookies (browsers cannot send the token cross-origin without script access to it).
- Service-role usage in a webhook handler after signature verification, or in a route after `requireAuth` + ownership check.
- `security definer` functions living in a schema not exposed through the API and not executable by `anon`/`authenticated`.
- `authUidNotWrapped` on small tables (low-row admin tables): P2 at most.

## Score anchors

- **0–2**: multiple user-data tables without RLS or `using (true)`; or API routes unauthenticated/decode-only; service-role routes trusting client ids.
- **3–4**: one confirmed P0 (one table without RLS, one BOLA route, unverified webhook, `user_metadata` in a policy).
- **5–6**: no P0, but P1s: definer functions without search_path, no rate limits on auth endpoints, error leaks, missing validation on mutations, client-side multi-step writes for invariants.
- **7–8**: solid RLS/authz, validated inputs, mapped errors, limits on sensitive endpoints; P2 gaps (unwrapped `auth.uid()`, no OpenAPI, CORS wildcard on Bearer API, advisors warnings).
- **9–10**: everything verified live (advisors clean, black-box BOLA tests pass), private storage with owner paths, idempotent webhooks/payments, versioned inventory, typed contract, PII-free logs.
