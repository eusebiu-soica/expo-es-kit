# API on Expo Router API Routes + EAS Hosting

Server endpoints living in the app repo: `app/**/<name>+api.ts`. Same security rules as any API (verified auth, per-resource authz, validation, rate limits, mapped errors). The extra risk here is **code proximity**: server code and client code share one repo and one `app/` directory, so a wrong import ships a secret to every device.

Verified against docs.expo.dev (router/reference/api-routes, eas/hosting):
- File: `app/api/notes+api.ts` → `/api/notes`; dynamic `app/api/notes/[id]+api.ts`. Platform extensions (`+api.web.ts`) are not supported.
- Handlers: `export async function GET(request: Request, params: Record<string, string>)`, also `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`. Standard `Request`/`Response` (`request.json()`, `Response.json()`).
- `StatusError` (from `expo-server`) can be thrown to produce a JSON error response with a status.
- Config: `app.json` → `"web": { "output": "server" }` (or `"static"` with the `expo-router` plugin option `apiRoutes: true`). The `expo-router` plugin `origin` sets the server URL the native app uses for relative fetches; for production use an explicit `EXPO_PUBLIC_API_URL`.
- Server routes can read **all** env vars, not only `EXPO_PUBLIC_*`. A secret used inside a `+api.ts` file is not included in the client bundle. **But client code that imports a module containing a secret pulls that module into the client bundle** (docs wording: "Client code that imports code with a secret is included in the client bundle").
- Limitations: no dynamic imports; ESM output not supported (transpiled to CommonJS); no native-binary deps (e.g. `sharp`).
- Deploy: `npx expo export --platform web` then `eas deploy` (`--prod` for production alias). EAS Hosting runs on Cloudflare Workers (V8 isolates): Node APIs are partially available; prefer Web Crypto (`crypto.subtle`, `crypto.randomUUID`) over `node:crypto`.
- Env on EAS Hosting: `eas env:create …` then `eas deploy --environment production`. Only **plain text** and **sensitive** visibility variables can be used by EAS Hosting; **`secret`-visibility variables cannot be deployed**. Store server secrets as `sensitive`. Deployments are immutable: after changing a variable, re-export and redeploy. `EXPO_PUBLIC_*` values are inlined at export time.

## Layout that prevents leaks

```
app/
  api/
    notes+api.ts            thin: parse → call server/ → respond
    webhooks/stripe+api.ts
  (tabs)/...                client screens
server/                     server-only modules (secrets, admin clients, rate limiter)
  auth.ts  db.ts  errors.ts  handler.ts  rate-limit.ts
src/                        client-only modules
```

Rules:
1. Secrets and privileged clients live only in `server/` (scanner rules already treat `server/` and `+api` files as server scope).
2. **Nothing under `src/` or any screen/component imports from `server/`.** Enforce with ESLint:

```js
// eslint.config.js
{
  files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
  ignores: ['app/**/*+api.ts'],
  rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@/server/*', '**/server/*'], message: 'Server-only module: import only from +api files.' }] }] },
}
```

3. Shared code between client and server (zod schemas, types, constants) lives in `shared/` and contains no env reads.
4. Server modules read env lazily inside functions (`process.env.X` at call time) and throw if missing, so a mis-import fails loudly instead of inlining `undefined`.
5. Never reference a secret through `EXPO_PUBLIC_*` "to make it work on the server": server routes already see non-public vars.
6. Audit check: grep client bundle output (`dist/_expo/static/js/**`) for secret names/prefixes after `npx expo export` (`sk_live_`, `sb_secret_`, `whsec_`, `SERVICE_ROLE`).

## server/handler.ts

```ts
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message = code, public headers?: HeadersInit) { super(message); }
}

export function handler(fn: (req: Request, params: Record<string, string>) => Promise<Response>) {
  return async (req: Request, params: Record<string, string>) => {
    const requestId = crypto.randomUUID();
    try {
      const res = await fn(req, params);
      res.headers.set('x-request-id', requestId);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: { code: e.code, message: e.message, requestId } }, { status: e.status, headers: e.headers });
      if (e instanceof ZodError) return Response.json({ error: { code: 'bad_request', message: 'Invalid request', requestId } }, { status: 400 });
      console.error(JSON.stringify({ level: 'error', requestId, err: e instanceof Error ? e.message : String(e) }));
      return Response.json({ error: { code: 'internal', message: 'Something went wrong', requestId } }, { status: 500 });
    }
  };
}
```

## server/auth.ts

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'; // jose works on Workers (Web Crypto)
import { ApiError } from './handler';

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
export async function requireAuth(req: Request) {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL missing');
  const issuer = `${url}/auth/v1`;
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new ApiError(401, 'unauthenticated');
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
    return { id: payload.sub!, token, appRole: (payload as any).app_metadata?.role as string | undefined };
  } catch {
    throw new ApiError(401, 'unauthenticated');
  }
}
```

Legacy HS256 projects: verify with `supabase.auth.getClaims(token)` / `getUser(token)` instead of JWKS. Never decode-only.

## Route example

```ts
// app/api/notes+api.ts
import { z } from 'zod';
import { handler, ApiError } from '@/server/handler';
import { requireAuth } from '@/server/auth';
import { userClient } from '@/server/db';
import { rateLimit } from '@/server/rate-limit';

const Create = z.object({ title: z.string().trim().min(1).max(200) }).strict();

export const POST = handler(async (req) => {
  const user = await requireAuth(req);
  await rateLimit(`notes:${user.id}`, 30, 60);
  if (Number(req.headers.get('content-length') ?? 0) > 32_768) throw new ApiError(413, 'payload_too_large');
  const body = Create.parse(await req.json().catch(() => ({})));
  const { data, error } = await userClient(user.token).from('notes')
    .insert({ title: body.title }).select('id,title').single();
  if (error) throw new ApiError(400, 'write_failed');
  return Response.json({ data }, { status: 201 });
});

export const GET = handler(async (req) => {
  const user = await requireAuth(req);
  const { data, error } = await userClient(user.token).from('notes').select('id,title,updated_at').limit(50);
  if (error) throw error;
  return Response.json({ data });
});
```

`[id]+api.ts`: validate `params.id` (`z.string().uuid()`), then fetch through the user-scoped client (RLS) or an admin query filtered by `user.id`. Return 404 for other users' ids.

## Rate limiting

No in-memory counters (isolates are ephemeral and many). Use:
- Upstash Redis REST (`@upstash/ratelimit`, works over fetch on Workers), or
- a Postgres RPC counter (see `api-supabase-edge.md`), or
- Cloudflare/EAS-level protections if available on your plan.
Key by user id + IP (`cf-connecting-ip` / `x-forwarded-for`). Stricter on auth/OTP/invite/expensive routes.

## Webhooks

Raw body via `await request.text()`; verify signatures with Web Crypto-compatible SDK paths (Stripe: `constructEventAsync` + `Stripe.createSubtleCryptoProvider()`); idempotent `webhook_events` table. Public by design: no `requireAuth`, the signature is the auth.

## CORS

The native app does not need CORS. If the same routes serve the Expo web build from the same origin, still no CORS needed. Add an allow-list only for third-party web origins.

## Native app → API routes

- Native builds call absolute URLs: `EXPO_PUBLIC_API_URL` (e.g. `https://myapp.expo.app`), per EAS build profile. Do not rely on dev-server origin in production.
- Keep a version prefix (`/api/v1/...`): deployed API and installed app versions diverge; old app builds keep calling old routes for months.
- Use the same API client rules as `modes.md` (auth header, single-flight refresh, timeouts, idempotency keys).

## Audit signals

- `appApiRoutes` in scan JSON (Expo `+api` files inside the app): run the Mode api checks from `audit/references/checks/backend.md` on them.
- Any non-`+api` file under `app/` or `src/` importing `server/` or reading a non-`EXPO_PUBLIC_` secret env var = P0 candidate (secret in bundle). Confirm by exporting and grepping the bundle.
- `eas.json` / EAS env with secrets under `EXPO_PUBLIC_*` = P0.
- Server secrets stored with `secret` visibility and routes failing in production with missing env: switch to `sensitive`.
