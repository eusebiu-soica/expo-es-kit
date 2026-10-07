# API routes (+api.ts) — agent rules

Expo Router API routes (`*+api.ts`) for {{APP_NAME}}, run on the server (EAS Hosting or a Node adapter), never in the app bundle. Authenticate, authorize, validate, then act.

## Use

- `web.output: "server"` in the app config; routes export `GET`/`POST`/... taking a `Request` and returning `Response`.
- One handler wrapper for every `+api.ts`: auth guard, zod validation, rate limit, error mapping, request id.
- Auth guard verifies the bearer JWT server-side: signature + `exp` + `aud`/`iss` (`supabase.auth.getClaims(token)` / `getUser(token)`, or `jose.jwtVerify` with the JWKS). Decode-only is not auth.
- Per-resource authorization: load the row and check ownership/membership for every id from params/body (IDOR).
- zod schemas for params, query and body; `.strict()`, length caps.
- Rate limits per user + IP on auth, OTP, invite, upload and costly endpoints.
- Generic error bodies `{ error: { code, message } }`; details only in server logs.
- Secrets read from server env without the `EXPO_PUBLIC_` prefix (`process.env.STRIPE_SECRET_KEY`), set in EAS environment variables for the server deployment.
- Service-role / admin DB client only after authz, in server-only modules imported solely by `+api.ts` files.
- Webhooks: verify signature on the raw body (`await request.text()`), check timestamp, dedupe by event id.
- Cron/scheduled calls: require a shared secret header, compared in constant time.

## Never

- Import a server-only module (DB admin client, secrets) from a screen or component; that ships it to the device.
- Prefix server secrets with `EXPO_PUBLIC_` (inlined into the public bundle).
- Trust `userId`, `role`, prices or tenant ids sent by the client.
- Return stack traces, SQL errors or upstream bodies.
- Log tokens, `Authorization` headers or full request bodies.

## Patterns

```ts
// app/api/items/[id]+api.ts
const Body = z.object({ title: z.string().min(1).max(200) }).strict();

export const PATCH = withHandler({ auth: true, body: Body, rateLimit: 'write' },
  async ({ user, body, params }) => {
    const id = z.string().uuid().parse(params.id);
    const item = await db.items.get(id);
    if (!item || item.ownerId !== user.id) throw new HttpError(404, 'not_found');
    return db.items.update(id, { title: body.title });
  });

// server/with-handler.ts (server-only)
export function withHandler<B>(opts: HandlerOpts<B>, fn: HandlerFn<B>) {
  return async (req: Request, params: Record<string, string>) => {
    try {
      const user = opts.auth ? await verifyBearer(req) : null; // throws 401
      await rateLimit(opts.rateLimit, user?.id ?? clientIp(req));
      const body = opts.body ? opts.body.parse(await req.json()) : undefined;
      return Response.json(await fn({ req, user, body, params }));
    } catch (e) { return toErrorResponse(e); } // generic body, logs with request id
  };
}
```

## Before finishing

- [ ] Every `+api.ts` uses the wrapper (verified JWT, zod, rate limit).
- [ ] Ownership checked for every id; service role only after authz.
- [ ] No server module imported from app UI code; no `EXPO_PUBLIC_` secret.
- [ ] Tested 401, other user's id, bad body, 429 against `npx expo serve`.
- [ ] `{{TYPECHECK_CMD}}`, `{{LINT_CMD}}`, `{{TEST_CMD}}` pass.
