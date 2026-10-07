# data (Supabase direct) — agent rules

The app talks to Supabase directly through `{{SUPABASE_CLIENT_MODULE}}`. Row Level Security is the only thing between a user and everyone else's data.

## Use

- The single client from `{{SUPABASE_CLIENT_MODULE}}`, created with the anon/publishable key only.
- Generated types: `supabase gen types typescript` → `Database`; `createClient<Database>`. Regenerate after every migration.
- Treat RLS as the trust boundary: every query must be correct even if a malicious client sends it. Client-side filters (`.eq('user_id', me)`) are for narrowing, not security.
- Multi-step or cross-table writes (transfer, checkout, invite accept) go through an RPC (`supabase.rpc('fn', args)`) that runs in one transaction and checks `auth.uid()` server-side.
- Select only the columns the screen needs: `.select('id, title, updated_at')`, never `select('*')` on wide or sensitive tables.
- Paginate every list: `.range(from, to)` with a stable `.order(...)`, or keyset pagination (`.lt('created_at', cursor)`) for feeds.
- Storage: private buckets + `createSignedUrl` (short TTL) through the signed-URL cache; public buckets only for truly public assets.
- Realtime: one channel per screen/feature, filtered (`filter: 'room_id=eq.<id>'`), removed in cleanup (`supabase.removeChannel(ch)`).
- Check `{ error }` on every call and throw a typed error so {{QUERY_LIB}} sees it.
- `auth.getUser()` / `getClaims()` when you need a verified identity; `getSession()` only reads local storage.

## Never

- `service_role` key or any secret in the app (bypasses RLS; the bundle is public).
- Trust ids from the client for ownership: never send `user_id`/`owner_id` for the server to accept blindly; default it from `auth.uid()` in a column default, trigger or RPC.
- Rely on a hidden UI button as access control.
- Unbounded `select` without `range`/`limit` on user-generated tables.
- Long-lived signed URLs (days) or signed URLs put into analytics/logs.
- Leave realtime channels subscribed after unmount or sign-out.
- Create a second Supabase client for "admin" operations; move them to an Edge Function.

## Patterns

```ts
export async function fetchItems(page: number, signal: AbortSignal) { // signal from queryFn
  const from = page * PAGE, to = from + PAGE - 1;
  const { data, error } = await supabase
    .from('items').select('id, title, updated_at')
    .order('updated_at', { ascending: false }).range(from, to)
    .abortSignal(signal);
  if (error) throw error;
  return data;
}

// multi-step write → RPC (checks auth.uid() inside, one transaction)
const { data, error } = await supabase.rpc('accept_invite', { invite_id: inviteId });

useEffect(() => {
  const ch = supabase.channel(`room:${roomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, onInsert)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}, [roomId]);
```

## Before finishing

- [ ] Every table touched has RLS policies for the operation used (check `supabase/migrations`).
- [ ] No client-supplied ownership id is trusted; columns selected explicitly; lists paginated.
- [ ] Types regenerated if the schema changed.
- [ ] Channels removed on unmount; signed URLs short-lived.
- [ ] `{{TYPECHECK_CMD}}` and `{{TEST_CMD}}` pass.
