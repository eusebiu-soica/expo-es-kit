# app/api (Next.js) — agent rules

Route handlers that serve the {{APP_NAME}} mobile app. Every handler is public internet surface: authenticate, authorize, validate, then act.

## Use

- One handler wrapper (`withHandler`) for every `route.ts`: auth guard, zod validation, rate limit, error mapping, request id. No bare `export async function POST` without it.
- Auth guard verifies the bearer JWT server-side: signature + `exp` + `aud`/`iss` (`supabase.auth.getClaims(token)` / `getUser(token)`, or `jose.jwtVerify` against the JWKS). Decode-only is not auth.
- Per-resource authorization on every read/write: load the row, check `row.ownerId === user.id` (or membership/role) before returning or mutating. Path/body ids are attacker-controlled (IDOR).
- zod schemas for params, query and body (`.strict()`); reject unknown fields; cap string/array lengths.
- Rate limits per user and per IP on auth, OTP, password reset, invite, upload and any costly endpoint (Upstash Ratelimit, Vercel WAF, or equivalent).
- Generic error bodies: `{ error: { code, message } }` with safe messages; log details server-side with the request id.
- Secrets only in server env (`process.env.X`, never `NEXT_PUBLIC_*`); `import 'server-only'` in modules that touch them.
- Service-role / admin DB client only after authz passed, scoped to the minimum query.
- Webhooks: verify the provider signature on the raw body (`await req.text()`), reject stale timestamps, dedupe by event id (idempotency table) before side effects.
- Cron routes: require `Authorization: Bearer ${process.env.CRON_SECRET}` and compare in constant time.
- Idempotency-Key header honored on retried writes (store key → response for 24h).

## Never

- Trust `userId`, `role`, `orgId` or prices from the request body.
- Return stack traces, SQL errors or upstream error bodies to the client.
- Log tokens, `Authorization` headers, full request bodies or PII.
- Use the service-role client to "make RLS go away" before checking who the caller is.
- Wildcard CORS with credentials; mobile clients do not need CORS at all.
- Long-running work inline in the request; enqueue it.

## Patterns

```ts
// app/api/items/[id]/route.ts
const Params = z.object({ id: z.string().uuid() });
const Body = z.object({ title: z.string().min(1).max(200) }).strict();

export const PATCH = withHandler({ auth: true, params: Params, body: Body, rateLimit: 'write' },
  async ({ user, params, body }) => {
    const item = await db.item.findUnique({ where: { id: params.id } });
    if (!item || item.ownerId !== user.id) throw new HttpError(404, 'not_found'); // 404, not 403: no existence leak
    return db.item.update({ where: { id: item.id }, data: { title: body.title } });
  });

// app/api/cron/cleanup/route.ts
export async function GET(req: Request) {
  if (!safeEqual(req.headers.get('authorization') ?? '', `Bearer ${process.env.CRON_SECRET}`)) return new Response(null, { status: 401 });
  // ...
}
```

## Before finishing

- [ ] Handler uses the wrapper: verified JWT, zod, rate limit, generic errors.
- [ ] Ownership/role checked for every resource id in the request.
- [ ] No secret reachable from client bundles; service role used only post-authz.
- [ ] Webhooks verify signature + dedupe; cron checks `CRON_SECRET`.
- [ ] Tests cover 401, 403/404 (other user's id), 400 (bad body), 429.
- [ ] `{{TYPECHECK_CMD}}`, `{{LINT_CMD}}`, `{{TEST_CMD}}` pass.
