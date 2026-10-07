# Caching checks (category `caching`)
Scope: server-state caching (TanStack Query or equivalent), persisted snapshots, image/URL caching, request deduplication and offline behaviour.

Check ids (`CACHE-Cnn`) are stable references for this file; findings get report ids `CACHE-001…`. Storage engine details live in `mmkv.md`; sign-out wipes are scored in `auth-sessions` (mention, don't double-count).

## Signals to start from

| Scan path | Meaning |
|---|---|
| `stack.libs["@tanstack/react-query"]` | Query layer present (v5 API: `gcTime`, `isPending`, `throwOnError`, `placeholderData`). Other: SWR, RTK Query, Apollo, custom. |
| `hits["query-client"]` | Where `new QueryClient` is created — read its `defaultOptions`. Multiple hits = multiple clients (suspect). |
| `hits["query-stale-time"]`, `hits["query-gc-time"]` | Defaults/overrides present. `cacheTime` = v4 name (upgrade leftover). |
| `hits["query-focus-manager"]` | `focusManager`/`onlineManager` wired to AppState/NetInfo. |
| `hits["query-invalidate-all"]` | `invalidateQueries()` with no filter — refetches every active query. |
| `hits["query-persist-whole"]`, `stack.libs["@tanstack/react-query-persist-client"]`, persister libs | Whole-cache persistence. |
| `hits["use-query"]` | Query usage density; compare with `hits["fetch-in-effect"]` (manual fetching). |
| `hits["fetch-in-effect"]` | Fetch inside `useEffect` — no dedupe, no cache, race conditions. |
| `hits["supabase-signed-url"]` | Signed URL creation — check cache + batching. |
| `hits["expo-image-cache-policy"]`, `hits["expo-image-no-cache-policy"]` | Image cache settings (perf overlap; here: URL stability). |
| `hits["query-cache-clear"]`, `hits["image-cache-clear"]` | Cache wipe exists (sign-out). |
| `stack.libs["@react-native-community/netinfo"]` | Needed for `onlineManager`. |
| `hits["mmkv-instance"]`, `hits["asyncstorage-call"]` | Where snapshots are stored. |

Files to read first: the QueryClient module, the query-key module(s), 2–3 representative `useQuery`/`useMutation` hooks, any `snapshot`/`persist` module, the signed-URL/image-URL helper.

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| CACHE-C01 | A query layer is used | `hits["fetch-in-effect"]` ≫ `hits["use-query"]`; screens manage loading/error/data with `useState` + `useEffect`. | P1 (no dedupe/cache, refetch storms, races) | Adopt TanStack Query; migrate hot screens first. |
| CACHE-C02 | Sensible defaults | `defaultOptions.queries`: `staleTime` > 0 (e.g. 60 s), `gcTime` (e.g. 10 min), `retry: 1`; `mutations.retry: 0`. Default `staleTime: 0` refetches on every mount. | P2 (P1 if visible refetch storms / spinners on every navigation) | See pattern "QueryClient". Override per family where freshness differs. |
| CACHE-C03 | Focus/online wired for RN | `focusManager.setEventListener` with `AppState`, `onlineManager.setEventListener` with NetInfo; `refetchOnWindowFocus` semantics understood. | P2 | Wire both (pattern). Disable `refetchOnWindowFocus` globally only if foreground refresh is handled deliberately. |
| CACHE-C04 | Query key factories | Keys as ad-hoc string arrays scattered (`['posts', id]` in 12 places, typos) vs a `keys.ts` factory per family. | P2 (P1 if mismatched keys cause stale UI after mutations) | Key factory per family: `postKeys.all / lists() / list(filters) / detail(id)`. |
| CACHE-C05 | Invalidation scoped | `hits["query-invalidate-all"]`; `invalidateQueries({ queryKey: ['posts'] })` vs `invalidateQueries()`. | P2 (P1 when it fires on frequent mutations) | Invalidate the mutated family; use `setQueryData` for optimistic/known results. |
| CACHE-C06 | Persistence per family, not whole blob | `hits["query-persist-whole"]`: whole cache restored at startup, grows unbounded, no shape validation across app versions. | P2 (P1 if cache is large or restore is on the critical path) | Per-family snapshots `snapshot:<family>` with `revalidateTtlMs`, `maxAgeMs`, `isValid` shape guard (pattern). |
| CACHE-C07 | High-churn/unbounded families memory-only | Search results, infinite feeds, chat streams persisted to disk. | P2 | Persist only bounded, high-value families (home, profile, settings); keep others memory-only. |
| CACHE-C08 | TTL math correct | Read every TTL constant: `7*24*60_000` is 168 **minutes**, not 7 days; seconds vs ms mixups; `Date.now()` vs `updatedAt` in seconds. | P2 (P1 if it causes stale sensitive data or no caching at all) | Named constants: `const DAY_MS = 24 * 60 * 60 * 1000`; unit suffixes in names (`ttlMs`). |
| CACHE-C09 | No credentials in keys | Query keys or storage keys containing tokens, emails, phone numbers, signed URLs with tokens. | P1 (credentials end up in persisted caches/devtools/logs) | Key by stable ids; never by token. |
| CACHE-C10 | Signed URL cache | `hits["supabase-signed-url"]`: called per render/row without cache; no in-flight dedupe; regenerated before expiry; unbounded map. | P1 (N network calls per scroll, image cache misses because URL changes) | Cache record `{ url, expiresAt, promise }`; dedupe in-flight; re-sign only within a margin of expiry; bounded size with throttled prune (pattern). |
| CACHE-C11 | URL stability for image cache | Same image gets a new URL each visit (fresh signature/timestamp query param) → expo-image disk cache never hits. | P1 for feeds/avatars | Keep the cached URL until near expiry; or use `cacheKey` in expo-image source (`{ uri, cacheKey: path }`). |
| CACHE-C12 | Batch instead of N+1 | Per-row signing/fetch (`createSignedUrl` in row component, per-item detail fetch in a list). | P1 (lists > 20 items); P2 otherwise | `createSignedUrls(paths, ttl)` per page; join data server-side (view/RPC/endpoint). |
| CACHE-C13 | Counts from the server | Fetching full lists to compute `.length` (badges, totals). | P2 (P1 if lists are unbounded) | `select('*', { count: 'exact', head: true })` / a count endpoint. |
| CACHE-C14 | Mutation side-effects consistent | After create/update/delete: cache updated or invalidated for both list and detail; optimistic updates roll back on error. | P2 (P1 if users see stale or duplicated data) | `onMutate` snapshot + `onError` rollback + `onSettled` invalidate family. |
| CACHE-C15 | Unfocused screens not refetching | Hidden tab screens with polling/`refetchInterval` or active queries re-rendering. | P2 | `refetchInterval` only when focused; `subscribed: isFocused` (v5) or `enabled` tied to focus. |
| CACHE-C16 | Offline behaviour defined | What happens offline: cached data shown? mutations queued or blocked with a message? `networkMode` default understood. | P2 (P1 for apps advertised as offline-capable) | Show cached data + offline banner; block or queue mutations explicitly; resume paused mutations on reconnect. |
| CACHE-C17 | Single QueryClient | Multiple `new QueryClient` (`hits["query-client"]` count > 1 outside tests), or created inside a component without `useState`. | P1 if created per render (cache lost every render) | One module-level client (or `useState(() => new QueryClient())`). |
| CACHE-C18 | Image prefetch purposeful | `Image.prefetch` of large originals or whole lists on startup. | P2 | Prefetch only next-screen thumbnails; respect cellular. |
| CACHE-C19 | Caches cleared on identity change | `hits["query-cache-clear"]`, `hits["image-cache-clear"]`, snapshot prefix wipe on sign-out/user switch. | Score in `auth-sessions`; mention here as context | `queryClient.clear()`, snapshot prefix removal, `Image.clearMemoryCache()`/`clearDiskCache()` for private images. |
| CACHE-C20 | HTTP caching respected (API mode) | Custom API: ETag/Cache-Control on cacheable GETs; client not adding cache-busting params. | P2 | Server headers for public/static data; no `?t=Date.now()`. |

## Proven patterns

**QueryClient + RN wiring (v5)**
```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, gcTime: 10 * 60_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(!!s.isConnected)),
);
AppState.addEventListener('change', (s) => {
  if (Platform.OS !== 'web') focusManager.setFocused(s === 'active');
});
```
(`refetchOnWindowFocus: false` + `focusManager` wired = foreground refresh handled deliberately per family, e.g. `refetchOnWindowFocus: true` on the inbox query only.)

**Key factory + scoped invalidation**
```ts
export const postKeys = {
  all: ['posts'] as const,
  lists: () => [...postKeys.all, 'list'] as const,
  list: (f: PostFilter) => [...postKeys.lists(), f] as const,
  detail: (id: string) => [...postKeys.all, 'detail', id] as const,
};
useMutation({ mutationFn: createPost, onSuccess: () => queryClient.invalidateQueries({ queryKey: postKeys.lists() }) });
```

**Per-family snapshot**
```ts
type Snapshot<T> = { v: 1; savedAt: number; data: T };
const FAMILIES = {
  home:    { revalidateTtlMs: 60_000,          maxAgeMs: 7 * DAY_MS, isValid: isHomePayload },
  profile: { revalidateTtlMs: 5 * 60_000,      maxAgeMs: 30 * DAY_MS, isValid: isProfile },
} as const;

export function readSnapshot<K extends keyof typeof FAMILIES>(family: K) {
  const raw = cacheStore.getString(`${userPrefix()}snapshot:${family}`);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Snapshot<unknown>;
    const cfg = FAMILIES[family];
    if (s.v !== 1 || Date.now() - s.savedAt > cfg.maxAgeMs || !cfg.isValid(s.data)) return null;
    return { ...s, needsRevalidate: Date.now() - s.savedAt > cfg.revalidateTtlMs };
  } catch { return null; }
}
```

**Signed URL cache**
```ts
type Entry = { url?: string; expiresAt: number; promise?: Promise<string> };
const cache = new Map<string, Entry>();
const TTL_S = 3600, MARGIN_MS = 5 * 60_000, MAX = 500;

export function signedUrl(path: string): Promise<string> {
  const e = cache.get(path);
  if (e?.url && e.expiresAt - Date.now() > MARGIN_MS) return Promise.resolve(e.url);  // stable URL → image cache hit
  if (e?.promise) return e.promise;                                                    // in-flight dedupe
  const promise = sign(path, TTL_S).then((url) => {
    cache.set(path, { url, expiresAt: Date.now() + TTL_S * 1000 });
    pruneThrottled();                                                                   // bounded size
    return url;
  }).catch((err) => { cache.delete(path); throw err; });
  cache.set(path, { expiresAt: 0, promise });
  return promise;
}
// Lists: sign a page at once with createSignedUrls(paths, TTL_S), then seed the cache.
```

**Server count**
```ts
const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false);
```

## Not a problem when

- `staleTime: 0` on genuinely real-time families (chat, live scores) that also use realtime subscriptions.
- `invalidateQueries()` with no args only in sign-in/role-switch/pull-to-refresh-all handlers (but `clear()` is better on identity change).
- `query-persist-whole` with a bounded `dehydrateOptions.shouldDehydrateQuery` allowlist and `maxAge` + `buster` set — P2 note only.
- `fetch-in-effect` for fire-and-forget telemetry or one-off non-cached actions.
- Signed URLs created per item when the list is ≤ 5 items and cached.
- No query layer in an app with no remote data (score from what exists; caching rarely n/a — images still count).

## Score anchors

| Band | `caching` looks like |
|---|---|
| 0–2 | Manual fetch-in-effect everywhere, no dedupe, credentials in cache keys, signed URLs regenerated per render (image cache useless). |
| 3–4 | Query layer present with default `staleTime: 0`, global invalidation after every mutation, N+1 signing, whole-cache persister growing unbounded. |
| 5–6 | Reasonable defaults and key usage but no RN focus/online wiring, some N+1, persistence coarse, TTLs unchecked, offline undefined. |
| 7–8 | Key factories, scoped invalidation, per-family snapshots with validation, signed URL cache with dedupe and stable URLs, batch signing. |
| 9–10 | All of 7–8 plus verified ≤ 1 deduped refresh on cached return, bounded caches with pruning, explicit offline behaviour, TTL constants named and tested. |
