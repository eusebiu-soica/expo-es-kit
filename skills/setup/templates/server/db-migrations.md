# migrations — agent rules

Postgres / Supabase schema migrations for {{APP_NAME}}. Each file is applied once to production data; it must be safe, reversible in intent, and secure by default.

## Use

- New migration per change: `supabase migration new <name>`. Never edit a migration that already ran in any shared environment.
- `alter table ... enable row level security;` in the same migration that creates the table. Then one policy per operation (`select`, `insert`, `update`, `delete`) and per role (`to authenticated`).
- Wrap auth calls for per-statement evaluation: `(select auth.uid())`, `(select auth.jwt())`. Index every column used in policies.
- `update` policies need both `using` and `with check`.
- `security definer` functions: `set search_path = ''`, fully qualified names (`public.items`), check `auth.uid()` inside, `revoke execute ... from public, anon` and grant only to the roles that need it.
- Add indexes from evidence: `explain (analyze, buffers)` on the real query; `create index concurrently` on large tables (outside a transaction).
- Breaking changes as expand → dual-write/backfill → switch reads → drop, across separate releases (old app versions keep running for weeks).
- Backfills in batches; never one giant `update` on a large table.
- Statement-level triggers (`for each statement` with transition tables) for bulk audit/denormalization instead of row-level triggers when sets are large.
- Regenerate client types after the migration (`supabase gen types typescript`).

## Never

- A table in an exposed schema without RLS, or with RLS and zero policies "for now".
- `using (true)` on anything user-owned; `to public` / `anon` grants without a stated reason.
- Policies reading `user_metadata` / `raw_user_meta_data` (user-editable) for authorization.
- Rename/drop a column the shipped app still reads.
- `security definer` without `set search_path`.
- Data-destructive statements without a backup plan noted in the migration header.

## Patterns

```sql
create table public.items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) <= 200),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.items enable row level security;
create index items_owner_id_idx on public.items (owner_id);

create policy "items_select_own" on public.items for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "items_insert_own" on public.items for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "items_update_own" on public.items for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "items_delete_own" on public.items for delete to authenticated
  using ((select auth.uid()) = owner_id);

create function public.archive_item(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.items set archived = true where id = p_id and owner_id = (select auth.uid());
  if not found then raise exception 'not_found'; end if;
end $$;
revoke execute on function public.archive_item(uuid) from public, anon;
grant execute on function public.archive_item(uuid) to authenticated;
```

## Before finishing

- [ ] Every new table: RLS enabled + policies for each operation used; policy columns indexed.
- [ ] Definer functions pin `search_path = ''` and restrict `execute`.
- [ ] Change is backward compatible with the currently shipped app version.
- [ ] Applied locally (`supabase db reset`) and RLS tested as two different users + anon.
- [ ] Types regenerated; `supabase db lint` / advisors clean.
