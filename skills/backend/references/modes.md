# Backend modes: direct-db vs api vs hybrid

Use this to decide (new feature or new app) and to know which rules bind the mobile app in each mode. Scan reports the detected mode in `backend.mode` (`direct-db` | `api` | `hybrid` | `none`).

## Definitions

- **direct-db**: the app uses `@supabase/supabase-js` with the anon/publishable key to call PostgREST (`.from()`), RPCs (`.rpc()`), Storage and Realtime. **Postgres RLS + grants are the only trust boundary.**
- **api**: the app calls HTTP endpoints you own (Next.js route handlers on Vercel, Supabase Edge Functions, Expo API Routes on EAS Hosting). The server holds secrets and enforces authn/authz/validation. The app may still use Supabase Auth for sign-in.
- **hybrid**: both. Typical: reads of simple owned data direct; anything with secrets, money, side effects or cross-user logic through the API.

## Decision guide (per feature, not per app)

Route a feature through the **API** if any of these is true:

| Need | Why direct-db fails |
|---|---|
| Uses a secret (Stripe secret, OpenAI key, email/SMS provider, signing keys, pepper) | Anything in the app is public. |
| Calls a third-party API | Same; also needs timeouts, retries, response validation. |
| Payments, purchases, entitlements, webhooks | Must verify signatures and be idempotent server-side; client cannot be trusted with price/entitlement. |
| Business invariants across rows/tables (balances, quotas, seat limits, state machines, scheduling conflicts) | Client-side sequences are bypassable and non-atomic. A `security invoker` RPC can work for pure-DB invariants; anything else → API. |
| Rate limits / abuse controls per user/IP (invites, OTP, messaging, AI calls, exports) | PostgREST has no per-route rate limiting you control. |
| Aggregation/joins across users (leaderboards, coach dashboards, analytics) | RLS row filters make cross-user aggregates either impossible or leaky; use a server query with explicit scoping. |
| Multi-client reuse (web app, partner integrations, admin tool) | One contract, versioned, documented with OpenAPI. |
| Heavy work (image processing, PDF, AI) or long-running jobs | Needs server runtime/queues. |
| Audit trail requirements | Server writes audit rows with verified actor. |

**direct-db is OK** for: simple per-user CRUD (profile, settings, own notes/items), membership-scoped reads with well-tested RLS, Realtime subscriptions on owned rows, private storage under the user's own path. Condition: RLS policies exist per operation, are tested, and advisors are clean.

When in doubt, start API for anything touching money, other users, or secrets; direct-db for the user's own rows.

## Rules for the mobile app in direct-db mode

1. **Anon/publishable key only.** `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `…_ANON_KEY`). Never `service_role`/`sb_secret_…` anywhere in the app repo's client code.
2. **Typed client from generated types.** `supabase gen types typescript --project-id <id> > src/lib/database.types.ts`; `createClient<Database>(…)`. Regenerate in CI after migrations; fail CI on drift.
3. **RLS is the only boundary.** Write every query assuming the user can rewrite it (they can: the key is public, PostgREST is reachable from curl). UI hiding is not authorization.
4. **Never trust client-provided ids for ownership.** Insert without `user_id` and let `default auth.uid()` + `with check` set it; never filter "my rows" only by `.eq('user_id', userId)` assuming that is the security (RLS must enforce it).
5. **Multi-step writes → RPC.** One `security invoker` function in a transaction instead of three client calls. Use `security definer` only when needed, with `set search_path = ''` and explicit auth checks.
6. **Select explicit columns.** `.select('id,title,updated_at')` not `*`; keeps sensitive columns out of caches and reduces payload. Put truly sensitive columns in separate tables.
7. **Storage via private buckets.** Owner-prefixed paths `${userId}/...`; signed URLs with short TTL. For shared media (e.g. coach sees client photos), mint signed URLs server-side after authorization.
8. **Realtime**: subscribe only to RLS-protected tables or private channels; filter by user/room.
9. **Errors**: show generic messages; never surface PostgREST error details to users (they may include constraint/column names).
10. **Pagination**: `.range()` with a capped page size; never unbounded selects.

## Rules for the mobile app in api mode

1. **One API client module** (`src/lib/api/client.ts`). No `fetch` to the API scattered across screens.
2. **Base URL from env**: `EXPO_PUBLIC_API_URL` (public, fine). Per-build profile values in EAS env. HTTPS only.
3. **Auth header injection** in the client: `Authorization: Bearer <access_token>` from `supabase.auth.getSession()` (or your token store). Never tokens in query strings.
4. **Typed contract**: generate types from OpenAPI (`openapi-typescript` + `openapi-fetch`) or share zod schemas from a workspace package. Validate responses at the boundary for critical flows (`schema.parse(json)`), at least in dev.
5. **401 handling**: single-flight refresh → retry the request once → on second 401 run sign-out wipe. Never parallel refreshes.
6. **Timeouts**: every request has `AbortSignal.timeout(ms)` (combine with screen-unmount signal via `AbortSignal.any`), default 10–15 s, longer for uploads.
7. **Idempotency keys** on mutations that create value (orders, payments, invites, messages): `Idempotency-Key: <uuid>` generated once per user intent and reused on retries.
8. **Retries**: only idempotent methods or requests with an idempotency key; exponential backoff with jitter; no retry on 4xx except 408/429 (respect `Retry-After`).
9. **No direct table access** except reads explicitly allowed in an inventory (document them in `docs/backend-access.md` or CLAUDE.md). Writes go through the API.
10. **Error shape**: client expects `{ error: { code, message } }`; maps `code` to UI copy; never displays raw server text.
11. **Versioning**: client calls `/api/v1/...`; server keeps old versions until the minimum supported app version moves past them (force-update screen via a `/api/v1/config` min-version field).

API client skeleton:

```ts
// src/lib/api/client.ts
import { supabase } from '@/lib/supabase';
import { refreshOnce } from './refresh';
import { sessionGeneration } from '@/lib/auth/generation';

const BASE = process.env.EXPO_PUBLIC_API_URL!;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string; timeoutMs?: number } = {}): Promise<T> {
  const gen = sessionGeneration.current();
  const doFetch = async () => {
    const { data } = await supabase.auth.getSession();
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
    if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);
    const timeout = AbortSignal.timeout(init.timeoutMs ?? 15_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(`${BASE}${path}`, { ...init, headers, signal });
  };
  let res = await doFetch();
  if (res.status === 401) {
    const ok = await refreshOnce();         // single-flight
    if (!ok) throw new ApiError(401, 'unauthenticated', 'Session expired');
    res = await doFetch();                   // retry once
  }
  if (!sessionGeneration.isCurrent(gen)) throw new ApiError(0, 'stale_session', 'Discarded');
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'unknown', body?.error?.message ?? 'Request failed');
  return body as T;
}
```

(`AbortSignal.any` needs a recent Hermes/RN; if unavailable, combine signals manually with an `AbortController`.)

## Rules for hybrid

- Keep an explicit **access inventory**: table/RPC/bucket → direct or API → why. Anything not listed is server-only (RLS on, no client policies).
- Same user identity both ways: the API verifies the same Supabase JWT the app uses for PostgREST.
- Do not duplicate writes: a resource is written by either the app (RLS) or the API, not both, unless the RLS policy is the stricter of the two.
- Server-only tables: RLS enabled, zero policies (deny-all), server uses service role/secret key after its own authz.
- Cache invalidation: API mutations return the updated entity or explicit invalidation hints; the app does not rely on Realtime for its own writes.

## Migrating direct-db → api for a feature

1. Add the API route with the same authorization semantics (or a user-scoped client so RLS still applies).
2. Ship the app version using the route.
3. After the minimum supported app version uses the route, drop the client policy (`drop policy …`) so the old path is closed.
4. Verify with the black-box test: old direct write with a user token now fails.
