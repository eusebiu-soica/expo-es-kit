# supabase/functions — agent rules

Supabase Edge Functions (Deno) that serve the {{APP_NAME}} app. Public internet surface: authenticate, authorize, validate, then act.

## Use

- A shared handler wrapper in `supabase/functions/_shared/handler.ts`: auth guard, zod validation, rate limit, error mapping, CORS (only if a web client exists).
- Keep `verify_jwt = true` (default) in `config.toml` for user-facing functions, and still resolve the user in code: `supabase.auth.getClaims(token)` or `getUser(token)`. Decode-only is not auth.
- Per-request user client created with the caller's `Authorization` header so RLS applies to every query by default.
- Per-resource authorization for anything RLS does not cover: check ownership/membership of every id from the request (IDOR).
- zod (`npm:zod`) for body and query; `.strict()`, length caps.
- Rate limits on auth-adjacent and costly functions (Upstash Redis / a Postgres counter keyed by user + IP).
- Generic error bodies `{ error: { code, message } }`; log details with a request id.
- Secrets from `Deno.env.get(...)`, set via `supabase secrets set`; never in code or the app.
- Service-role / secret-key client only after authz passed, for the specific privileged query.
- Webhooks (`verify_jwt = false`): verify the provider signature on the raw body, check timestamp, dedupe by event id before side effects.
- Scheduled functions (pg_cron + pg_net): require a shared secret header, compared in constant time.

## Never

- Trust `user_id`, `role`, prices or tenant ids from the body.
- Disable `verify_jwt` on a user-facing function to "fix" a 401.
- Return Postgres errors, stack traces or upstream responses to the client.
- Log `Authorization` headers, tokens or full bodies.
- Create the service-role client at module scope and use it for every request.
- Import whole npm SDKs when one function is needed (cold start).

## Patterns

```ts
// supabase/functions/items-update/index.ts
import { z } from 'npm:zod';
import { handler, HttpError } from '../_shared/handler.ts';

const Body = z.object({ id: z.string().uuid(), title: z.string().min(1).max(200) }).strict();

Deno.serve(handler({ auth: true, body: Body }, async ({ userClient, user, body }) => {
  // userClient carries the caller's JWT → RLS enforces row access
  const { data, error } = await userClient.from('items')
    .update({ title: body.title }).eq('id', body.id).select('id, title').single();
  if (error || !data) throw new HttpError(404, 'not_found');
  return data;
}));
```

```ts
// _shared/auth.ts
const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
const { data, error } = await anonClient.auth.getClaims(token);
if (error || !data) throw new HttpError(401, 'unauthorized');
```

## Before finishing

- [ ] JWT verified in code; user client used unless a privileged step is justified.
- [ ] Every request id authorized; body validated.
- [ ] Secrets via `supabase secrets`, none in the app; webhooks verify signature + dedupe.
- [ ] Tested with `supabase functions serve`: 401, other user's id, bad body.
- [ ] `{{TYPECHECK_CMD}}` (`deno check`) and `{{LINT_CMD}}` pass.
