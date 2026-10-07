# Direct-DB with Supabase: RLS, functions, storage, realtime, migrations

The app holds a public key (publishable `sb_publishable_…` or legacy `anon` JWT). Anyone can call PostgREST, RPCs, Storage and Realtime with it, plus their own user JWT. **Every table, view, function and bucket reachable through the Data API must be safe against a hostile authenticated user.**

If the `supabase` plugin is installed, load `supabase:supabase` and `supabase:supabase-postgres-best-practices` before writing SQL. With the Supabase MCP, use `list_tables`, `execute_sql` (read-only for audits), `apply_migration` (for fixes, with user approval) and `get_advisors` (`security` and `performance`).

## 1. RLS on every table in exposed schemas

```sql
alter table public.notes enable row level security;
-- optional hardening for table owners too (service role still bypasses):
-- alter table public.notes force row level security;
```

- Exposed schemas: `public` plus anything listed under API settings → "Exposed schemas". Put server-only tables in a non-exposed schema (`private`, `internal`) when possible.
- RLS on + zero policies = deny-all for `anon`/`authenticated`. Correct for server-only tables (service role/secret key bypasses RLS). Only a problem when the app is expected to read the table.

## 2. Policies per operation

```sql
create policy "notes_select_own" on public.notes
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "notes_insert_own" on public.notes
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "notes_update_own" on public.notes
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);   -- prevents moving a row to another user

create policy "notes_delete_own" on public.notes
  for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.notes alter column user_id set default auth.uid();
create index if not exists notes_user_id_idx on public.notes (user_id);
```

Rules:
- One policy per operation; avoid `for all` (hides intent, easy to forget `with check`).
- `to authenticated` unless anon access is intended. A policy without `to` applies to `public` (every role, including `anon`).
- `update` needs both `using` (which rows) and `with check` (what they may become).
- Wrap `auth.uid()` / `auth.jwt()` as `(select auth.uid())` so Postgres evaluates it once per statement (initPlan) instead of per row. Index every column used in a policy predicate.
- Membership (teams/orgs/coach–client): use a `security definer` helper returning the caller's org ids, or an `exists` on a membership table with an index. Avoid policies that join large tables per row.
- Never `using (true)` on tables with user data. Allowed for public reference data (`select` only).
- Multiple permissive policies for the same role/operation are OR-ed (and each is evaluated: performance cost). Use `as restrictive` for "must also be true" conditions (e.g. `aal2` for sensitive tables).

Membership example:

```sql
create or replace function private.user_org_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$ select org_id from public.memberships where user_id = (select auth.uid()) $$;
revoke execute on function private.user_org_ids() from public, anon;
grant execute on function private.user_org_ids() to authenticated;

create policy "projects_select_member" on public.projects
  for select to authenticated
  using (org_id in (select private.user_org_ids()));
```

## 3. Authorization data: never `raw_user_meta_data`

`auth.users.raw_user_meta_data` (`user_metadata` in the JWT) is **editable by the user** via `supabase.auth.updateUser({ data })`. Never read roles/tenant/plan from it in policies, functions or API code.

Use either:
- `raw_app_meta_data` (`app_metadata` in the JWT) set only server-side (`auth.admin.updateUserById`), read as `(select auth.jwt() -> 'app_metadata' ->> 'role')`. Changes apply after the next token refresh.
- A `public.user_roles` table (RLS: users can select their own row, nobody can write except service role), optionally injected into the JWT with a Custom Access Token Hook.

## 4. Functions (RPCs)

Default to `security invoker` (RLS applies). Use `security definer` only when the function must read/write past RLS, and then:

```sql
create or replace function public.accept_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''                         -- mandatory: blocks search_path hijacking
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.invites%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_invite from public.invites
   where code_hash = encode(extensions.hmac(p_code,
           (select decrypted_secret from vault.decrypted_secrets where name = 'invite_pepper'), 'sha256'), 'hex')
     and used_at is null and expires_at > now()   -- single-use, short TTL; only the peppered hash is stored
   for update;
  if not found then raise exception 'invalid invite' using errcode = 'P0002'; end if;
  update public.invites set used_at = now(), used_by = v_uid where id = v_invite.id;
  insert into public.memberships (org_id, user_id, role) values (v_invite.org_id, v_uid, 'member');
  return v_invite.org_id;
end $$;

revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;
```

- Fully qualify every object (`public.invites`, `extensions.crypt`) because `search_path` is empty.
- Explicit auth checks inside (`auth.uid()` not null, ownership/membership checks). Definer functions bypass RLS: they are the policy.
- Postgres grants `execute` to `public` by default on new functions; Supabase also grants to `anon`/`authenticated` via default privileges. Revoke where not needed. Consider `alter default privileges in schema public revoke execute on functions from public, anon;`.
- Trigger functions on `auth.users` (e.g. `handle_new_user`) are definer functions: same rules, and never copy `raw_user_meta_data` into authorization columns.
- Rate-sensitive RPCs (invites, OTP-like codes) need server-side attempt counters; better, move them to the API so the pepper lives outside the database and rate limits are per IP. If kept in SQL, the pepper lives in Supabase Vault, never in a table or migration.

## 5. Views

Views run with the owner's privileges by default and **bypass RLS** of underlying tables.

```sql
create view public.note_summaries with (security_invoker = true) as
  select id, title, updated_at from public.notes;
-- existing:
alter view public.note_summaries set (security_invoker = true);
```

Materialized views have no RLS: keep them out of exposed schemas or revoke `select` from `anon`/`authenticated`.

## 6. Column-level exposure

RLS filters rows, not columns. If a user may read a row but not every column (internal notes, cost price, another party's phone, hashes):
- Split into a separate table with stricter policies (preferred), or
- `revoke select (internal_note) on public.orders from authenticated;` (then `select *` fails: clients must list columns), or
- Expose a `security_invoker` view / RPC returning only safe columns.

## 7. Storage

```sql
-- bucket private (dashboard or SQL)
insert into storage.buckets (id, name, public) values ('user-media', 'user-media', false)
on conflict (id) do update set public = false;

create policy "media_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'user-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'user-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'user-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

- Upload path `${userId}/${uuid}.jpg`. Never let the client choose another user's prefix (policy enforces it).
- Public buckets only for public assets (no listing of user content).
- Set bucket `file_size_limit` and `allowed_mime_types`.
- Sensitive/shared media (health photos, documents shared with a coach/doctor): **no client storage policies at all**; the API authorizes the viewer and returns short-TTL signed URLs (`createSignedUrl(path, 60–300)`). The anon key then has no direct storage access to those objects. Do not cache signed URLs past their TTL, and do not put them in persisted query caches.
- Account deletion must delete the user's prefix (Storage API `remove`, not just SQL rows).

## 8. Realtime

- `postgres_changes` delivers rows only if the subscriber passes the table's RLS `select` policy. Keep RLS correct; filter subscriptions (`filter: 'room_id=eq.123'`) for efficiency, not security.
- Broadcast/Presence: use private channels and policies on `realtime.messages`:

```sql
create policy "room_members_receive" on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'room:%'
    and exists (select 1 from public.room_members m
                where m.user_id = (select auth.uid())
                  and 'room:' || m.room_id::text = realtime.topic())
  );
```

```ts
supabase.channel(`room:${roomId}`, { config: { private: true } })
```

Disable "Allow public access" for Realtime in project settings once private channels are used.

## 9. Keys

- App: publishable/anon key only. Server (API, Edge Functions, cron): secret/service role key, read from server env, client created per request, used only after authorization.
- Legacy `anon`/`service_role` JWT keys are being deprecated in favor of `sb_publishable_…`/`sb_secret_…`; a secret key is rejected when sent from a browser User-Agent. Migrate and rotate if a secret ever reached a client build.
- Supabase anon key in `eas.json` / `app.config` is public by design; service keys never are.

## 10. Migrations discipline

- Every change is a migration file in `supabase/migrations` (CLI: `supabase migration new`, `supabase db diff`). No dashboard-only changes in production.
- Reproducible: `supabase db reset` on an empty local Postgres must succeed in CI; then run RLS tests (pgTAP via `supabase test db`, or a script using two test users).
- Breaking changes: **expand → migrate/dual-write → contract**. Add new column/table, deploy code writing both, backfill in batches, switch reads, ship app version, then drop the old column after the minimum supported app version no longer uses it. Mobile apps stay installed for months: old clients keep calling old columns.
- Indexes from `explain (analyze, buffers)` on real query shapes (the exact PostgREST filter/order/limit the app sends), not guesses. Include policy predicate columns.
- Prefer statement-level triggers (`for each statement` with transition tables `referencing new table as new_rows`) over row-level triggers that fan out (notifications, counters) on bulk writes.
- `create index concurrently` for large tables (outside a transaction; separate migration).
- Regenerate types after each migration: `supabase gen types typescript --local > src/lib/database.types.ts`.

## 11. Verification SQL

```sql
-- tables without RLS in public
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;

-- RLS on, zero policies (deny-all: fine if server-only)
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
  and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);

-- policies per table
select tablename, policyname, cmd, roles, permissive, qual, with_check
from pg_policies where schemaname in ('public','storage','realtime') order by 1, 3;

-- policies using user_metadata
select tablename, policyname from pg_policies
where coalesce(qual,'') || coalesce(with_check,'') ilike '%user_metadata%';

-- definer functions without search_path
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef and n.nspname in ('public','private')
  and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');

-- anon privileges on tables
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' order by 1;

-- public buckets
select id, public from storage.buckets where public;
```

Then `get_advisors` (security + performance) and fix every security lint (RLS disabled, security definer view, function search_path mutable, exposed auth.users, leaked password protection off, etc.).

## 12. RLS test (two users)

```ts
// scripts/rls-test.ts — run against local/staging, never prod data
const a = createClient(URL, PUBLISHABLE_KEY); await a.auth.signInWithPassword(userA);
const b = createClient(URL, PUBLISHABLE_KEY); await b.auth.signInWithPassword(userB);
const { data: bNote } = await b.from('notes').insert({ title: 'b' }).select('id').single();
expect((await a.from('notes').select('id').eq('id', bNote!.id)).data).toEqual([]);
expect((await a.from('notes').update({ title: 'x' }).eq('id', bNote!.id).select()).data).toEqual([]);
expect((await a.from('notes').insert({ title: 'x', user_id: userBId })).error).not.toBeNull();
expect((await createClient(URL, PUBLISHABLE_KEY).from('notes').select('id')).data).toEqual([]);
```
