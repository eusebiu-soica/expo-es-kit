# API on Next.js (App Router) + Vercel

Route handlers under `app/api/v1/**/route.ts` serve the mobile app. Every handler goes through one wrapper (`withApiHandler`) and, unless explicitly public, one auth guard (`requireAuth`). Load `vercel:nextjs`, `vercel:vercel-functions`, `vercel:vercel-firewall`, `vercel:env-vars` skills if installed.

Version notes (verified against nextjs.org/docs, v16.x):
- **Next.js 16 deprecated `middleware.ts` and renamed it `proxy.ts`** (export `proxy` or default). Codemod: `npx @next/codemod@canary middleware-to-proxy .`. Proxy defaults to the Node.js runtime and the `runtime` segment option is not allowed there. In 15.x the file is still `middleware.ts`.
- Proxy/middleware is a pre-routing filter, not an authorization layer. Next.js docs say to verify auth inside each handler/Server Function, since matcher changes can silently drop coverage. Use proxy for coarse things (CORS preflight, redirects, request ids), and keep `requireAuth` in handlers.
- Since 15, dynamic route `params` is a Promise: `{ params }: { params: Promise<{ id: string }> }` → `const { id } = await params`. GET handlers are not cached by default since 15.
- Segment config: `export const runtime = 'nodejs'` (default; use it for Stripe SDK, `node:crypto`), `export const maxDuration = 30` (seconds, bounded by plan), `export const dynamic = 'force-dynamic'` for user-specific GETs if caching is in play.

## Layout

```
app/api/v1/
  notes/route.ts            GET list, POST create
  notes/[id]/route.ts       GET/PATCH/DELETE one
  webhooks/stripe/route.ts  public, signature-verified
  cron/cleanup/route.ts     CRON_SECRET
lib/api/
  errors.ts  handler.ts  auth.ts  rate-limit.ts  body.ts  idempotency.ts  supabase.ts
```

## errors.ts

```ts
export type ErrorCode =
  | 'bad_request' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict'
  | 'payload_too_large' | 'rate_limited' | 'internal';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400, unauthenticated: 401, forbidden: 403, not_found: 404, conflict: 409,
  payload_too_large: 413, rate_limited: 429, internal: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(public code: ErrorCode, message = code, public details?: unknown, public headers?: HeadersInit) {
    super(message);
    this.status = STATUS[code];
  }
}

export const errorBody = (code: ErrorCode, message: string, requestId: string, details?: unknown) =>
  ({ error: { code, message, requestId, ...(details ? { details } : {}) } });
```

## handler.ts — wrapper

```ts
import { ZodError } from 'zod';
import { ApiError, errorBody } from './errors';

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: Request, ctx: { params: P; requestId: string }) => Promise<Response>;

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function withApiHandler<P = Record<string, string>>(fn: Handler<P>) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    const started = Date.now();
    let res: Response;
    try {
      res = await fn(req, { params: await ctx.params, requestId });
    } catch (err) {
      res = toErrorResponse(err, requestId);
    }
    for (const [k, v] of Object.entries(BASE_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
    res.headers.set('x-request-id', requestId);
    // Structured log: no bodies, no Authorization, no tokens, no emails.
    console.log(JSON.stringify({
      level: res.status >= 500 ? 'error' : 'info', requestId, method: req.method,
      path: new URL(req.url).pathname, status: res.status, ms: Date.now() - started,
    }));
    return res;
  };
}

function toErrorResponse(err: unknown, requestId: string): Response {
  if (err instanceof ApiError) {
    return Response.json(errorBody(err.code, err.message, requestId, err.details), { status: err.status, headers: err.headers });
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return Response.json(errorBody('bad_request', 'Invalid request', requestId, details), { status: 400 });
  }
  // Unknown: log server-side (message + stack stay in logs), return generic body.
  console.error(JSON.stringify({ level: 'error', requestId, err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err) }));
  return Response.json(errorBody('internal', 'Something went wrong', requestId), { status: 500 });
}
```

Never return `error.message` from Postgres/Supabase/Stripe/OpenAI to the client: it carries table/column/constraint names, upstream account details, or prompt text. Map known cases (`23505` unique violation → `conflict`) explicitly.

## auth.ts — verified JWT, never decode-only

```ts
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { ApiError } from './errors';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`)); // cached across invocations

export type AuthUser = { id: string; role: string | undefined; aal: string | undefined; claims: JWTPayload };

export async function requireAuth(req: Request): Promise<AuthUser & { token: string }> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError('unauthenticated', 'Missing token');
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: 'authenticated' });
    if (!payload.sub) throw new Error('no sub');
    const appMeta = (payload as { app_metadata?: { role?: string } }).app_metadata;
    return { id: payload.sub, role: appMeta?.role, aal: payload.aal as string | undefined, claims: payload, token };
  } catch {
    throw new ApiError('unauthenticated', 'Invalid token');
  }
}

export function requireRole(user: AuthUser, ...roles: string[]) {
  if (!user.role || !roles.includes(user.role)) throw new ApiError('forbidden');
}
```

- JWKS verification works when the project uses asymmetric signing keys (ES256/RS256). Projects still on the legacy HS256 shared secret: use `supabase.auth.getClaims(token)` (verifies locally with JWKS when asymmetric, otherwise calls Auth) or `supabase.auth.getUser(token)` (always a network call; also detects revoked/deleted users).
- `jwtVerify` checks signature + `exp`/`nbf`; pass `issuer` and `audience` explicitly.
- Never `jwt-decode`, `decodeJwt`, `atob(token.split('.')[1])` for auth. Never `getSession()` on the server.
- Roles from `app_metadata` (server-set) or a roles table. Never `user_metadata`.
- For revocation-sensitive actions (delete account, change email, payouts) call `getUser(token)` to confirm the session is still valid.

## supabase.ts — clients per request

```ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// RLS applies: preferred for user-owned data.
export const userClient = (token: string) =>
  createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

// Bypasses RLS: only after requireAuth + explicit authorization, scope every query by the verified id.
export const adminClient = () =>
  createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
```

`import 'server-only'` at the top of `lib/api/*` so these can never be imported by client components (build error).

## body.ts — size-capped JSON

```ts
import { ApiError } from './errors';
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new ApiError('payload_too_large');
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiError('payload_too_large'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError('bad_request', 'Invalid JSON'); }
}
```

(Vercel Functions also cap request bodies at the platform level, ~4.5 MB; uploads go directly to storage via signed upload URLs, not through the function.)

## rate-limit.ts — Upstash

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ApiError } from './errors';

const redis = Redis.fromEnv(); // UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
const limiters = {
  default: new Ratelimit({ redis, prefix: 'rl:default', limiter: Ratelimit.slidingWindow(60, '1 m') }),
  auth:    new Ratelimit({ redis, prefix: 'rl:auth',    limiter: Ratelimit.slidingWindow(5, '10 m') }),
  costly:  new Ratelimit({ redis, prefix: 'rl:costly',  limiter: Ratelimit.tokenBucket(10, '1 h', 10) }),
};

export function clientIp(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
}

export async function rateLimit(kind: keyof typeof limiters, ...keys: string[]) {
  const results = await Promise.all(keys.map((k) => limiters[kind].limit(k)));
  const blocked = results.find((r) => !r.success);
  if (blocked) {
    const retry = Math.max(1, Math.ceil((blocked.reset - Date.now()) / 1000));
    throw new ApiError('rate_limited', 'Too many requests', undefined, { 'Retry-After': String(retry) });
  }
}
// usage: await rateLimit('default', `u:${user.id}`, `ip:${clientIp(req)}`)
//        await rateLimit('auth', `ip:${clientIp(req)}`, `email:${hash(email)}`)  // OTP, invite exchange, reset
```

Add Vercel WAF rate-limit rules (`vercel:vercel-firewall`) for `/api/v1/auth/*` as a second layer; they stop floods before function invocation.

## Validated POST route (with BOLA-safe follow-ups)

```ts
// app/api/v1/notes/route.ts
import { z } from 'zod';
import { withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/api/auth';
import { rateLimit, clientIp } from '@/lib/api/rate-limit';
import { readJson } from '@/lib/api/body';
import { userClient } from '@/lib/api/supabase';
import { withIdempotency } from '@/lib/api/idempotency';
import { ApiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const maxDuration = 15;

const CreateNote = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(10_000).default(''),
  projectId: z.string().uuid(),
}).strict(); // rejects user_id, role, created_at… (mass assignment)

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().datetime().optional(),
});

export const GET = withApiHandler(async (req) => {
  const user = await requireAuth(req);
  await rateLimit('default', `u:${user.id}`);
  const q = ListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  let query = userClient(user.token).from('notes').select('id,title,updated_at')
    .order('updated_at', { ascending: false }).limit(q.limit);
  if (q.cursor) query = query.lt('updated_at', q.cursor);
  const { data, error } = await query;
  if (error) throw error;
  return Response.json({ data });
});

export const POST = withApiHandler(async (req) => {
  const user = await requireAuth(req);
  await rateLimit('default', `u:${user.id}`, `ip:${clientIp(req)}`);
  const parsed = CreateNote.safeParse(await readJson(req));
  if (!parsed.success) throw parsed.error;
  return withIdempotency(req, user.id, async () => {
    const db = userClient(user.token);
    // Authorization for referenced ids: caller must be a member of projectId (RLS also enforces).
    const { data: project } = await db.from('projects').select('id').eq('id', parsed.data.projectId).maybeSingle();
    if (!project) throw new ApiError('not_found');
    const { data, error } = await db.from('notes')
      .insert({ title: parsed.data.title, body: parsed.data.body, project_id: project.id, user_id: user.id })
      .select('id,title,updated_at').single();
    if (error) throw error;
    return Response.json({ data }, { status: 201 });
  });
});
```

`[id]` routes: `const { id } = params; z.string().uuid().parse(id);` then fetch with the user client (RLS) or `adminClient().from('notes').select().eq('id', id).eq('user_id', user.id)`. Return 404 (not 403) for other users' ids to avoid enumeration.

## idempotency.ts

```ts
// table: idempotency_keys(user_id uuid, key text, request_hash text, status int, response jsonb,
//         created_at timestamptz default now(), primary key (user_id, key)); RLS on, no policies.
import 'server-only';
import { adminClient } from './supabase';
import { ApiError } from './errors';

export async function withIdempotency(req: Request, userId: string, run: () => Promise<Response>) {
  const key = req.headers.get('idempotency-key');
  if (!key) return run();                         // require it for payment routes instead
  const db = adminClient();
  const { error: claimErr } = await db.from('idempotency_keys').insert({ user_id: userId, key, status: 0 });
  if (claimErr) {
    const { data: prev } = await db.from('idempotency_keys').select('status,response').eq('user_id', userId).eq('key', key).single();
    if (!prev || prev.status === 0) throw new ApiError('conflict', 'Request in progress');
    return Response.json(prev.response, { status: prev.status });
  }
  const res = await run();
  const body = await res.clone().json().catch(() => null);
  await db.from('idempotency_keys').update({ status: res.status, response: body }).eq('user_id', userId).eq('key', key);
  return res;
}
```

## Webhook (Stripe) — raw body + idempotent events

```ts
// app/api/v1/webhooks/stripe/route.ts   (public: no requireAuth; signature is the auth)
import Stripe from 'stripe';
import { withApiHandler } from '@/lib/api/handler';
import { ApiError } from '@/lib/api/errors';
import { adminClient } from '@/lib/api/supabase';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
export const runtime = 'nodejs';

export const POST = withApiHandler(async (req) => {
  const sig = req.headers.get('stripe-signature');
  if (!sig) throw new ApiError('bad_request');
  const raw = await req.text();                     // raw body: do NOT JSON.parse first
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!); }
  catch { throw new ApiError('bad_request', 'Invalid signature'); }
  const db = adminClient();
  const { error } = await db.from('webhook_events').insert({ id: event.id, type: event.type }); // unique(id)
  if (error?.code === '23505') return Response.json({ received: true });                       // duplicate delivery
  if (error) throw error;
  await handleStripeEvent(event);  // re-fetch objects from Stripe if you need authoritative state
  return Response.json({ received: true });
});
```

RevenueCat: configure an Authorization header value in the dashboard; compare with `timingSafeEqual` against `REVENUECAT_WEBHOOK_AUTH`; same event table; fetch subscriber state from the RevenueCat API rather than trusting the payload for entitlements.

## Cron routes

```ts
import { timingSafeEqual } from 'node:crypto';
import { withApiHandler } from '@/lib/api/handler';
import { ApiError } from '@/lib/api/errors';
const ok = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const GET = withApiHandler(async (req) => {
  if (!ok(req.headers.get('authorization') ?? '', `Bearer ${process.env.CRON_SECRET}`)) throw new ApiError('unauthenticated');
  // ...
  return Response.json({ ok: true });
});
```

Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set in project env.

## CORS

Native apps do not send `Origin`-gated requests; they need no CORS. Add CORS only for real web clients, with an allow-list (proxy example in Next.js docs). Never `Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials: true` or cookie auth.

## Secrets and env

- Server-only env in Vercel project settings (`vercel env add`, mark Sensitive). Never `NEXT_PUBLIC_*` for secrets: inlined into browser bundles.
- `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `UPSTASH_*`, `INVITE_PEPPER`.
- Preview deployments: separate Supabase/Stripe test projects; Deployment Protection on previews.

## Versioning, inventory, contract

- Prefix `/api/v1`. Breaking change → `/api/v2` route alongside; mark v1 with `Deprecation`/`Sunset` headers; remove after min supported app version moves on.
- Generate OpenAPI from zod (`@asteasolutions/zod-to-openapi` or `zod-openapi`), publish `openapi.json` in CI, and generate the app's types with `openapi-typescript` (`openapi-fetch` client).
- No `/api/test`, `/api/seed`, `/api/debug` in production builds.

## Security headers (next.config)

```ts
async headers() {
  return [{ source: '/api/:path*', headers: [
    { key: 'Cache-Control', value: 'no-store' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  ]}];
}
```

## Route checklist

`withApiHandler` → `requireAuth` (or documented public + signature) → `rateLimit` → `safeParse` params/query/body (`.strict()`) → authorize every referenced id against the caller → user-scoped client or scoped admin query → explicit column selection → mapped errors → idempotency for value-creating mutations → no PII/tokens in logs.
