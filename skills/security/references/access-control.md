# Access control checks (area `access-control`)

Who can do what to which data, across every path the app's public key or token opens: PostgREST tables/views, RPCs, Storage, Realtime and API routes.
This file adds the method (access matrix, two-user test) and the attacker-side checks. It does not repeat the policy patterns: those live in `skills/backend/references/direct-db-supabase.md` (RLS, definer functions, views, storage, realtime) and `skills/backend/references/api-security-checklist.md` (API1/API3/API5). Findings use category `backend`, except client cache leaks, which use `auth-sessions`. Finding ids are per report (`ACL-001`); the check IDs below are stable.

| ID | Check | Typical severity |
|---|---|---|
| ACL-01 | Exposed surface inventoried, default deny | P0–P1 |
| ACL-02 | BOLA / IDOR in API routes | P0 |
| ACL-03 | Privileged clients (service role / secret key) scoped after authz | P0 |
| ACL-04 | BFLA: privileged routes and RPCs check verified roles | P0 |
| ACL-05 | Mass assignment / BOPLA on writes | P0–P1 |
| ACL-06 | Column-level exposure (BOPLA on reads) | P1 |
| ACL-07 | RLS predicate quality | P0–P1 |
| ACL-08 | Authorization inputs are trusted (no `user_metadata`, no client ids) | P0 |
| ACL-09 | Multi-tenant isolation and membership integrity | P0 |
| ACL-10 | Definer functions, RPCs and views that bypass RLS | P0–P1 |
| ACL-11 | Storage and Realtime authorization | P0–P1 |
| ACL-12 | Enumeration and guessable references | P1–P2 |

## The access matrix

Build it before judging individual policies. Most bugs show up as a cell whose "Allowed by" does not match the intended role.

1. **Resources.** Take every table and view in exposed schemas (`appMigrations.*`, `rls.policies[].table`) and every function in `public` (RPCs). Add storage buckets (`rls.issues.storagePolicies`), Realtime topics, and every API route (`api.*`, `api.routesWithoutAuthSignal`). In hybrid mode, mark which tables the app touches directly (`inputSurfaces[].sinks`).
2. **Roles.** The columns are:
   - `anon`: public key, no session
   - `user`: any authenticated user
   - `owner`: the row's user
   - `member`: same org/team
   - `admin`: an app role from verified claims or a roles table
   - `service`: server only
3. **Operations.** The operations are `select`, `insert`, `update`, `delete`, `rpc` (execute), `storage` (read/write/list), `realtime` (receive/send). Each API route method counts as one operation.
4. **Fill "Allowed by"** from the policy name or grant (`rls.policies[]`: `command`, `roles`, `using`, `withCheck`), the route guard (`requireAuth`, `requireRole`), or "nothing → denied".
5. **Fill "Scoped by"** with the predicate that limits rows: `owner_id = (select auth.uid())`, membership helper, `.eq('owner_id', userId)` in the route, or "none".
6. **Verdict:** ✅ intended, ❌ finding id, ❓ needs probe (`probes.md`).

| Resource | Role | Op | Allowed by | Scoped by | Verdict |
|---|---|---|---|---|---|
| `public.notes` | user | update | policy `notes_update_own` | `using` + `with check` owner | ✅ |
| `public.memberships` | user | insert | policy `members_insert` | `with check (user_id = auth.uid())` only | ❌ ACL-09 P0 (self-join any org) |
| `rpc admin_set_plan` | user | rpc | default `execute` grant | none (definer) | ❌ ACL-04 P0 |
| `GET /api/v1/notes/[id]` | user | select | `requireAuth` | `.eq('id', id)` via service client | ❌ ACL-02 P0 |
| bucket `avatars` | anon | storage read | public bucket | path = user id | ❓ ACL-12 |

Keep the matrix to the resources the app actually uses plus anything readable by `anon`. Put it in the report under "Access matrix".

---

### ACL-01 · Exposed surface inventoried, default deny
**Severity guide:** P0 when a table, view or bucket with user data is readable or writable by `anon`/`authenticated` without a scoping predicate (no RLS, or grants on a non-RLS object). · P1 when unused objects in exposed schemas are reachable (debug tables, old views, `pg_graphql` exposure the app never uses). · P2 when the inventory is undocumented.
**Signals:** `appMigrations.tablesWithoutRls`, `rls.issues.publicOrAnonWrite`, `rls.issues.viewsWithoutSecurityInvoker`, `api.routesWithoutAuthSignal`, `backend.mode`.
**How to verify:** run the verification SQL in `direct-db-supabase.md` §11 (tables without RLS, anon grants, public buckets), or Supabase MCP `get_advisors`. Each route in `api.routesWithoutAuthSignal` is either public by design (health, webhook with signature, public catalog) or a finding.
**Not a problem when:** RLS is on with zero policies on server-only tables (deny-all), the reference data is `select`-only and intentionally public, or the route is public by design and documented.
**Fix:** enable RLS, move server-only tables to a non-exposed schema, `revoke all … from anon`, and add the guard to the route.

### ACL-02 · BOLA / IDOR in API routes
**Severity guide:** P0 when an id from params/query/body selects, updates, deletes or exports a resource with no owner/tenant scope (privileged client), or with a user client on a table whose RLS is weak. · P1 when a nested id is unchecked (`projectId` in a create body, `ids[]` in bulk routes). · P2 when the route leaks existence only (403 vs 404 differences).
**Signals:** `id-access-without-owner-filter`, `api.serviceRoleRoutes`, `api.routesWithoutAuthSignal`, `inputSurfaces[].sinks`.
**How to verify:**
1. Read the auth helper and the DB client factory (`api.sharedHelpers`) first.
2. For each route that takes an id, check:
   - Where does `userId` come from? It must be the verified token.
   - Which client runs the query?
   - Does the query include `.eq('owner_id', userId)` or membership, or does RLS apply via the user-scoped client?
3. Check every id, including nested ids and arrays. Check follow-up queries too: the first query may be scoped and the second not.
4. Next.js 15/16: `const { id } = await params`. Expo API Routes: the second argument holds params. Edge: parse `new URL(req.url)`.
**Not a problem when:** a user-scoped client (`Authorization: Bearer <user JWT>` forwarded) is used and RLS on that table passes ACL-07, or the route resolves the resource through the caller (`/me/...`).
**Fix:** `.eq('id', id).eq('owner_id', userId).maybeSingle()` → 404 when null. Prefer the user-scoped client. Treat bulk `ids` with `.in('id', ids).eq('owner_id', userId)` and compare counts.

### ACL-03 · Privileged clients scoped after authz
**Severity guide:** P0 when a service-role/secret client is created at module scope or shared and used before or without an authorization check, or its results are returned unfiltered. · P1 when it is used after authz but selects `*` across users (`count`, exports). · P0 always for `service-role-in-client` (key in the app bundle).
**Signals:** `service-role-in-client`, `api.serviceRoleRoutes`, BE-A08.
**How to verify:** for each route in `api.serviceRoleRoutes`, find the line where authz is decided and the first privileged call. Authz must come first, and every privileged query must carry the scope.
**Not a problem when:** the route is a webhook or cron with signature or secret verification (HARD-03, BE-A10) that only touches the rows named in the verified event.
**Fix:** use the user-scoped client by default and the privileged client only inside a small, named function (`adminDeleteUser(userId)`) after `requireAuth` plus the ownership check.

### ACL-04 · BFLA: privileged routes and RPCs check verified roles
**Severity guide:** P0 when admin/staff routes or RPCs are callable by any authenticated user, or the role comes from the body, a header, `user_metadata`, or a client-side flag. · P1 when the role check exists but the method is not checked (GET guarded, DELETE not), or the check is in middleware/`proxy.ts` only and matchers miss the route.
**Signals:** `api.middleware` (matchers), `rls.issues.userMetadata`, route paths with `admin|staff|internal|manage`, `appMigrations.*` functions with `security definer`.
**How to verify:** list privileged operations: routes, RPCs (`grant execute` / default grants), and tables with admin-only writes. For each, find the check and its data source (`app_metadata`, roles table, Custom Access Token Hook claim).
**Not a problem when:** the check reads `app_metadata.role` or a roles table that only the service role writes, and is enforced in the handler or the function body.
**Fix:** `requireRole(claims, 'admin')` inside the handler. Use `revoke execute on function … from public, anon, authenticated` plus a definer function that checks the role. Keep admin APIs under a separate prefix with their own guard.

### ACL-05 · Mass assignment / BOPLA on writes
**Severity guide:** P0 when a client can set `role`, `is_admin`, `plan`, `credits`, `verified`, `user_id`, `org_id` or `price`, either through a route spreading the body (`.insert({ ...body })`, `.update(body)`) or directly through PostgREST because the table grants `update` on all columns. · P1 when it can set workflow fields (`status`, `approved_at`) or timestamps used in business rules.
**Signals:** `mass-assignment`, `rls.issues.insertWithoutCheck`, BE-A04, BE-D05.
**How to verify:**
1. Read each write route: is the body parsed with a `.strict()` / `.pick()` schema before reaching the DB?
2. In direct-db, list the columns of each table the user can `update`/`insert`. Without column grants, every column is writable within the rows RLS allows.
3. A `with check` that only pins `user_id` does not protect `role`.
**Not a problem when:** column-level grants limit writes, a `before update` trigger rejects changes to protected columns, or sensitive fields live in a separate table the user cannot write.
**Fix:**
```sql
revoke insert, update on public.profiles from authenticated;
grant insert (id, display_name, avatar_url), update (display_name, avatar_url) on public.profiles to authenticated;
```
```ts
const Body = z.object({ title: z.string().max(200), body: z.string().max(10_000) }).strict();
await db.from('notes').insert({ ...Body.parse(json), owner_id: userId }); // server sets ownership
```

### ACL-06 · Column-level exposure (BOPLA on reads)
**Severity guide:** P1 when readable rows carry columns the caller should not see: other parties' email/phone, internal notes, hashes, cost data, `stripe_customer_id`, push tokens. This is P0 if it covers secrets, tokens or health data of other users. · P2 when an API returns `select('*')` but the extra columns are harmless.
**Signals:** `rls.policies[]` on shared tables (members, messages, profiles), `select('*')` in routes, BE-D09.
**How to verify:** for every table readable by users other than the owner, list its columns. With the decompiled app, an attacker selects any column RLS lets through.
**Not a problem when:** you have a public projection (`security_invoker` view or RPC), split tables, or `revoke select (col)`.
**Fix:** see `direct-db-supabase.md` §6. In API routes, select explicit columns and map them to a response DTO.

### ACL-07 · RLS predicate quality
**Severity guide:** P0 when a policy on user data uses `using (true)` / `with check (true)`, is `to public` (includes `anon`), or an `insert`/`update` policy lacks `with check` so rows can be moved to another owner. · P1 for `for all` policies that hide intent, select policies broader than intended (`is_public or true`), or permissive policies OR-ed into something wider. · P2 for an unwrapped `auth.uid()` (performance) or missing indexes on predicate columns.
**Signals:** `rls.issues.usingTrue`, `rls.issues.insertWithoutCheck`, `rls.issues.publicOrAnonWrite`, `rls.policies[].usesAuthUid` = false, `rls.policies[].roles`.
**How to verify:** for each table in the matrix, read all policies together (permissive policies are OR-ed). Then answer, per operation:
- Which rows does `using` allow?
- What can a row become under `with check`?
- Which roles does the policy cover?
`update` without `with check` reuses `using`. Check whether that is really enough, given the column freedom in ACL-05.
**Not a problem when:** `using (true)` is on public reference data with `for select` only, or a `restrictive` policy adds the missing condition.
**Fix:** one policy per operation `to authenticated` with `(select auth.uid())` predicates, following the patterns in `direct-db-supabase.md` §2.

### ACL-08 · Authorization inputs are trusted
**Severity guide:** P0 when policies, functions or routes authorize with `user_metadata` / `raw_user_meta_data` (user-editable via `updateUser`), with a `user_id`/`org_id`/`role` taken from the request, or with a decode-only JWT. · P1 when claims are stale: a role in the JWT is revoked but stays valid until expiry, and there is no server re-check on sensitive actions.
**Signals:** `rls.issues.userMetadata`, AUTH-04, BE-D06, grep `user_metadata`, `body.userId`, `searchParams.get('userId')`.
**How to verify:** for every authz decision, find the data source. Only these are trusted:
- the verified token `sub` / `app_metadata`
- tables written only by the server
**Fix:** move roles to `app_metadata` or a roles table, and derive `userId` from `getClaims()` / `getUser()` / `jwtVerify`. For instant revocation, check a roles table on sensitive routes.

### ACL-09 · Multi-tenant isolation and membership integrity
**Severity guide:** P0 when a tenant column (`org_id`, `team_id`) exists but policies or routes ignore it, or users can write their own membership. Examples: an insert into `memberships` with only `with check (user_id = auth.uid())` lets anyone join any org, and an `update` of their own `role` column lets them promote themselves. · P1 when a membership helper is a definer function without fixed `search_path`, or is evaluated per row without an index.
**Signals:** `rls.issues.tenantColumnIgnored`, `rls.policies[]` on `memberships`/`members`/`invites`.
**How to verify:** for each tenant-scoped table, check that every policy constrains `org_id in (select private.user_org_ids())` (or `exists` on memberships) in **both** `using` and `with check`. Then check how a membership row comes to exist: invite RPC (good) or direct insert (bad).
**Not a problem when:** memberships are written only by a definer RPC that validates an invite (`direct-db-supabase.md` §4) and role changes go through an admin-checked RPC.
**Fix:** no client insert/update policy on `memberships`. Use `with check (org_id in (select private.user_org_ids()))` on tenant tables and a helper `security definer set search_path = ''` with `execute` revoked from `anon`.

### ACL-10 · Definer functions, RPCs and views that bypass RLS
**Severity guide:** P0 when a `security definer` RPC executable by `anon`/`authenticated` reads or writes by a parameter (`p_user_id`, `p_org_id`) without checking it against `auth.uid()`, or a view without `security_invoker` exposes other users' rows. · P1 when a definer function lacks `set search_path`, or there are unneeded `execute` grants. · P2 for definer functions that could be invoker.
**Signals:** `rls.issues.viewsWithoutSecurityInvoker`, `sqlDynamic[]`, `appMigrations.*` (functions, grants), BE-D07, BE-D08.
**How to verify:** for each definer function, find who can execute it, what parameters it trusts, and the first line that checks the caller. Materialized views have no RLS at all.
**Fix:** use the patterns in `direct-db-supabase.md` §4–§5. Replace `p_user_id` params with `(select auth.uid())` inside the function.

### ACL-11 · Storage and Realtime authorization
**Severity guide:** P0 when a public bucket holds private user files, or `storage.objects` policies don't scope by `bucket_id` plus `(storage.foldername(name))[1] = (select auth.uid())::text` (any user reads or overwrites any file). The same applies when private-data broadcast channels are public, or `postgres_changes` runs on tables whose select policy is weak. · P1 when list access exposes other users' file names, `upsert` lets a user overwrite shared objects, or "Allow public access" for Realtime is still on while private channels are used.
**Signals:** `rls.issues.storagePolicies`, BE-D11, BE-D12, client `channel(` without `private: true`.
**How to verify:** read the bucket definitions and every `storage.objects` / `realtime.messages` policy. Then compare the upload path built in the app with the policy's folder rule.
**Fix:** see `direct-db-supabase.md` §7–§8. For sensitive media, mint short-TTL signed URLs on the server after authz.

### ACL-12 · Enumeration and guessable references
**Severity guide:** P1 when sequential ids are combined with any BOLA weakness, or when public buckets use predictable paths (`avatars/<userId>.jpg` with user ids exposed elsewhere). It also covers signed URLs with long TTLs (days or more) that are stored or shared, and invite/reset codes that are short or unthrottled. · P2 for sequential ids with correct authz, or `count: 'exact'` revealing table sizes.
**Signals:** `bigserial`/`identity` primary keys in `appMigrations.*`, `createSignedUrl(` TTL arguments, `route-params-sensitive`.
**Fix:** use uuids (`gen_random_uuid()`), keep authz as the real control, and use signed URLs with 60–300 s TTL that are never persisted in query caches. Codes need ≥ 128 bits or rate limits (AUTH-11, AUTH-13).

## Cross-account leaks on the client

Access control can be correct on the server and still leak on the device. After sign-out or an account switch, user B can see A's cached queries, MMKV data, images or signed URLs, and late responses can land in B's cache. Audit these with AUTH-08 (sign-out wipes everything user-scoped), AUTH-09 (session generation guard) and SEC-10 (per-user namespacing). The patterns are in `skills/backend/references/auth-sessions.md` §7–§8. Report findings under `auth-sessions` with area `access-control`.

## Two-user test (SQL, local or branch DB only)

Run it inside a transaction that you roll back, in `supabase start` locally or on a Supabase branch. Never run it against production.

```sql
begin;
-- as user A
set local role authenticated;
set local request.jwt.claims to '{"sub":"<A_UUID>","role":"authenticated"}';
select count(*) from public.notes where owner_id = '<B_UUID>';               -- expect 0
update public.notes set title = 'x' where owner_id = '<B_UUID>' returning id; -- expect 0 rows
insert into public.notes (title, owner_id) values ('x', '<B_UUID>');          -- expect RLS error (42501)
update public.profiles set role = 'admin' where id = '<A_UUID>';              -- expect permission denied (column grant)
select public.admin_set_plan('<A_UUID>', 'pro');                              -- expect permission denied / exception
-- as anon
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select count(*) from public.notes;                                           -- expect 0 or permission denied
rollback;
```

Repeat it for each table and RPC in the matrix. Record results in the matrix (✅ / ❌). For the API-level A→B swap, token tampering and storage paths, use `probes.md` (BOLA swap, RLS two-user test via the Data API). `pgTAP` (`supabase test db`) turns these into regression tests.
