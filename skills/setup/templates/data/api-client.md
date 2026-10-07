# data (API client) — agent rules

The app reaches its backend only through `{{API_CLIENT_MODULE}}`. Every request, header and retry policy lives there.

## Use

- One client, base URL from `EXPO_PUBLIC_API_URL` via the validated `env` module (https only outside local dev).
- Typed contract per endpoint: request/response types shared with the server or generated (OpenAPI / zod schemas); parse responses with zod at the boundary.
- Auth header injected by the client (`Authorization: Bearer <access token>` read from the session), never by callers.
- 401 → single-flight token refresh (all concurrent 401s await the same promise) → retry the request once → if still 401, call the sign-out callback.
- Every request has a timeout via `AbortSignal` (default ~15s) and accepts the query `signal` for cancellation.
- Non-idempotent writes that may be retried (payments, orders, sends) pass an `Idempotency-Key` (a `randomUUID()` per user action, reused on retry).
- Errors normalized to `ApiError { status, code, message }`; UI branches on `code`, never on server message text.
- Endpoint functions live next to their hooks or in `lib/api/<resource>.ts` and return typed data.

## Never

- `fetch` to the backend from screens, components or hooks directly.
- Tokens in query strings, path segments or logs.
- Automatic retries of POST/PATCH without an idempotency key.
- Infinite refresh loops: the refresh call itself must not trigger refresh, and retry happens at most once.
<!-- if:supabase -->
- Direct table access (`supabase.from(...)`) for data the API owns; the client keeps Supabase for auth only.
<!-- endif -->
- Show raw server error messages or stack traces to users.
- Put API secrets in `EXPO_PUBLIC_*` to "call the third party directly"; proxy through the API.

## Patterns

```ts
// lib/api/items.ts
const Item = z.object({ id: z.string(), title: z.string(), updatedAt: z.string() });

export const getItems = (opts?: { signal?: AbortSignal }) =>
  api.get('/v1/items', { signal: opts?.signal, schema: z.array(Item) });

export const createOrder = (body: NewOrder, idempotencyKey: string) =>
  api.post('/v1/orders', { body, idempotencyKey, schema: Order });

// hook
useQuery({ queryKey: keys.items.lists(), queryFn: ({ signal }) => getItems({ signal }) });

// UI
if (err instanceof ApiError && err.code === 'quota_exceeded') showUpgrade();
```

## Before finishing

- [ ] New endpoints go through `{{API_CLIENT_MODULE}}` with a response schema.
- [ ] Retried writes carry an idempotency key.
- [ ] Errors surface as `ApiError` codes; no secrets or tokens in logs.
- [ ] Tested the expired-token path (401 → refresh → retry) and offline/timeout.
- [ ] `{{TYPECHECK_CMD}}` and `{{TEST_CMD}}` pass.
