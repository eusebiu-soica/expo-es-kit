# API on Supabase Edge Functions

Deno functions in `supabase/functions/<name>/index.ts`, shared code in `supabase/functions/_shared/`. Same rules as any API: verified auth, per-resource authorization, validation, limits, mapped errors. Load `supabase:supabase` if installed. Conventions move fast here: re-check https://supabase.com/docs/guides/functions/auth before writing a new function.

Verified conventions (supabase.com/docs, 2026):
- Entry point: `Deno.serve(handler)` or `export default { fetch: handler }` (current docs examples use the latter).
- `verify_jwt = true` is the default per function in `supabase/config.toml`: the platform rejects requests without a valid JWT before your code runs. That proves "some valid project JWT" (the publishable/anon key also passes when it is a legacy JWT). It does not identify the user or authorize anything: you still verify the user in code.
- Official helper: `withSupabase` / `createSupabaseContext` from `npm:@supabase/server@1`, auth modes `'user'` (valid user JWT in `Authorization`), `'secret'` (secret key in `apikey`, for service-to-service/cron), `'publishable'`, `'none'` (signed webhooks). Gives `ctx.supabase` (RLS-scoped to caller), `ctx.supabaseAdmin`, `ctx.userClaims`, `ctx.authMode`.
- Platform env: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` (JSON maps of named keys), `SUPABASE_JWKS`; locally single-key fallbacks `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`. Older projects/functions read `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. Check which ones the project actually has before writing code.
- CORS: `import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors'` (supabase-js ≥ 2.95) or a `_shared/cors.ts`.

## Preferred: `withSupabase`

```ts
// supabase/functions/notes-create/index.ts
import { withSupabase } from 'npm:@supabase/server@1';
import { z } from 'npm:zod@3';
import { json, fail, readJson } from '../_shared/http.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

const Body = z.object({ title: z.string().trim().min(1).max(200), projectId: z.string().uuid() }).strict();

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return fail(405, 'method_not_allowed');
    const userId = ctx.userClaims!.sub as string;
    if (!(await rateLimit(ctx.supabaseAdmin, `notes-create:${userId}`, 30, 60))) return fail(429, 'rate_limited');
    const parsed = Body.safeParse(await readJson(req, 32_768));
    if (!parsed.success) return fail(400, 'bad_request', 'Invalid request');
    // ctx.supabase carries the caller's JWT: RLS decides what they can touch.
    const { data, error } = await ctx.supabase.from('notes')
      .insert({ title: parsed.data.title, project_id: parsed.data.projectId })
      .select('id,title').single();
    if (error) return fail(error.code === '42501' ? 403 : 400, 'write_failed');
    return json({ data }, 201);
  }),
};
```

## Manual pattern (no helper)

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) return fail(401, 'unauthenticated');

  // User-scoped client: forwards the caller's JWT so RLS applies to every query.
  const supabase = createClient(URL_, PUBLISHABLE, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Verify the token: getClaims verifies via JWKS (asymmetric keys) or asks Auth; getUser always asks Auth.
  const { data: claims, error } = await supabase.auth.getClaims(token);
  if (error || !claims?.claims?.sub) return fail(401, 'unauthenticated');
  const userId = claims.claims.sub;
  // ... validate, authorize, query with `supabase`
  return json({ ok: true, userId });
});
```

Never: `JSON.parse(atob(token.split('.')[1]))`, `jwt-decode`, or reading `user_metadata` for roles.

## Service role / secret key: only after authz

```ts
const admin = createClient(URL_, Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// 1) user verified  2) authorization checked (membership/ownership/role from app_metadata or roles table)
// 3) every admin query scoped by the verified userId, never by ids from the body alone
const { data } = await admin.from('coach_clients').select('client_id').eq('coach_id', userId).eq('client_id', body.clientId).maybeSingle();
if (!data) return fail(404, 'not_found');
const { data: signed } = await admin.storage.from('progress-photos').createSignedUrl(`${body.clientId}/${body.photoId}.jpg`, 120);
```

This is the pattern for media served only through API-mediated signed URLs: the bucket has no client policies; the function authorizes the viewer and returns a short-TTL URL.

## _shared/http.ts

```ts
import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors';
const BASE = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders };

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: BASE });
export const fail = (status: number, code: string, message = code) =>
  json({ error: { code, message, requestId: crypto.randomUUID() } }, status);

export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new Response(null, { status: 413 });
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Response(null, { status: 413 });
  try { return JSON.parse(text); } catch { return undefined; }
}

export async function safe(handler: (req: Request) => Promise<Response>, req: Request) {
  try { return await handler(req); }
  catch (e) {
    if (e instanceof Response) return e;
    console.error(JSON.stringify({ level: 'error', err: e instanceof Error ? e.message : String(e) })); // no tokens/bodies
    return fail(500, 'internal', 'Something went wrong');
  }
}
```

Error rules: never return `error.message` from Postgres/upstreams; never return stacks; log a request id.

## CORS

Only browser callers need CORS. The default `corsHeaders` use `Access-Control-Allow-Origin: *`; acceptable for Bearer-token APIs without cookies. For functions called by your own web app with cookies, or to reduce abuse from arbitrary sites, replace with an allow-list echoing the request `Origin`. Native apps ignore CORS.

## Validation

`npm:zod@3` / `npm:valibot` via `npm:` specifiers (pin major versions; use a `deno.json` import map per function or shared). `.strict()` objects; server sets owner ids, roles, prices, status.

## Rate limiting options

- Postgres counter via RPC (works everywhere, adds a DB round trip):

```sql
create table private.rate_limits (key text primary key, count int not null, window_start timestamptz not null);
create or replace function public.hit_rate_limit(p_key text, p_max int, p_window_s int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  insert into private.rate_limits as r (key, count, window_start) values (p_key, 1, now())
  on conflict (key) do update set
    count = case when r.window_start < now() - make_interval(secs => p_window_s) then 1 else r.count + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_s) then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_max;
end $$;
revoke execute on function public.hit_rate_limit(text,int,int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text,int,int) to service_role;
```

```ts
// _shared/rate-limit.ts — `admin` is the secret-key client (ctx.supabaseAdmin)
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
export async function rateLimit(admin: SupabaseClient, key: string, max: number, windowS: number) {
  const { data, error } = await admin.rpc('hit_rate_limit', { p_key: key, p_max: max, p_window_s: windowS });
  return !error && data === true; // fail closed on auth-adjacent endpoints; consider fail-open elsewhere
}
```

- Upstash Redis REST (`npm:@upstash/ratelimit`, `npm:@upstash/redis`) with `UPSTASH_*` secrets: lower latency.
- Supabase Auth has its own built-in limits for sign-in/OTP/signup emails (configure in dashboard); custom OTP/invite functions need their own.

Key by user id and by IP (`x-forwarded-for` first hop). Stricter on invite exchange, OTP verify, password reset, AI/expensive functions.

## Secrets

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... INVITE_PEPPER=...
supabase secrets list            # names + digests only
```

Local: `supabase/functions/.env` (gitignored). Never put secrets in `config.toml`, code, or the app's `EXPO_PUBLIC_*`.

## Webhooks (public functions)

```toml
# supabase/config.toml
[functions.stripe-webhook]
verify_jwt = false
```

Then verify the provider signature over the raw body (`await req.text()`), e.g. `stripe.webhooks.constructEventAsync(body, sig, secret, undefined, Stripe.createSubtleCryptoProvider())`, and insert `event.id` into a `webhook_events` table with a unique key before acting (idempotent on retries). `withSupabase({ auth: 'none' })` is the documented wrapper for this case.

## Function-to-function, cron, pg_net

Internal callers send the secret key in `apikey` (current docs) and the callee uses `withSupabase({ auth: 'secret' })` with `verify_jwt = false`. Do not let internal-only functions accept user JWTs unless designed for both (`auth: ['user', 'secret']` and branch on `ctx.authMode`). Never forward a user's JWT to a function that then elevates to service role without its own authorization check.

## Deploy hygiene

- `supabase functions deploy <name>`; one function per concern; keep `verify_jwt` explicit in `config.toml` for every function so audits can read intent.
- Pin `npm:` versions; avoid `latest`.
- Timeouts: wrap outbound `fetch` with `AbortSignal.timeout(10_000)`; Edge Functions have wall-clock and CPU limits, so long work goes to queues (`pgmq`) or background tasks (`EdgeRuntime.waitUntil`).
- Logs: `console.log(JSON.stringify({...}))` without tokens, emails, or request bodies; view in Logs Explorer.

## Audit signals specific to Edge Functions

- `api.routes[].framework === 'supabase-edge'`.
- `config.toml` entries with `verify_jwt = false`: each must be a signed webhook, a `secret`-mode internal function, or an intentionally public endpoint with its own rate limit.
- Functions creating an admin client at module scope and using it for user-scoped reads without filtering by verified user id = BOLA (P0).
- Functions trusting `req.json().userId` = P0.
