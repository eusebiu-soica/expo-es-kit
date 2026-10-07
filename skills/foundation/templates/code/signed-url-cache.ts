/**
 * signed-url-cache.ts — bounded cache of signed URLs for private storage objects.
 *
 * Deps: none (pass a `sign` function, e.g. Supabase Storage `createSignedUrl`).
 *
 * Behavior:
 * - One record per path holds the URL, its expiry and the in-flight signing promise, so N
 *   components asking for the same path trigger one request.
 * - The same URL string is returned until the last `refreshWindowMs` before expiry; only then is it
 *   re-signed. Stable strings keep list cells and image caches from reloading on every render.
 * - LRU-bounded (`maxEntries`); expired/overflow entries pruned at most every `pruneIntervalMs`.
 *
 * Adapt:
 * - With expo-image pass a stable cache key so a re-signed URL reuses the cached file:
 *   `<Image source={{ uri: url, cacheKey: `${bucket}/${path}` }} cachePolicy="memory-disk" />`
 * - Keep TTLs short (minutes to an hour); never log signed URLs or send them to analytics.
 * - Register `cache.clear` with sign-out (`registerStoreReset(() => cache.clear())`).
 */

export interface SignedUrlCacheOptions {
  sign: (path: string, expiresInSec: number) => Promise<string>;
  ttlSec?: number;
  refreshWindowSec?: number;
  maxEntries?: number;
  pruneIntervalMs?: number;
}

interface Entry {
  url?: string;
  expiresAt: number; // ms epoch; 0 while the first signing is in flight
  inFlight?: Promise<string>;
}

export function createSignedUrlCache({
  sign,
  ttlSec = 3600,
  refreshWindowSec = 300,
  maxEntries = 500,
  pruneIntervalMs = 30_000,
}: SignedUrlCacheOptions) {
  const entries = new Map<string, Entry>(); // insertion order = LRU order
  const refreshWindowMs = Math.min(refreshWindowSec, ttlSec / 2) * 1000;
  let lastPrune = 0;

  function touch(path: string, entry: Entry) {
    entries.delete(path);
    entries.set(path, entry);
  }

  function prune(now: number) {
    if (now - lastPrune < pruneIntervalMs) return;
    lastPrune = now;
    for (const [path, e] of entries) if (!e.inFlight && e.expiresAt <= now) entries.delete(path);
    for (const [path, e] of entries) {
      if (entries.size <= maxEntries) break;
      if (!e.inFlight) entries.delete(path); // oldest first
    }
  }

  function startSigning(path: string, entry: Entry): Promise<string> {
    const p = sign(path, ttlSec).then(
      (url) => {
        entry.url = url;
        entry.expiresAt = Date.now() + ttlSec * 1000;
        entry.inFlight = undefined;
        return url;
      },
      (err: unknown) => {
        entry.inFlight = undefined;
        if (!entry.url || entry.expiresAt <= Date.now()) entries.delete(path);
        throw err;
      },
    );
    entry.inFlight = p;
    return p;
  }

  /** Valid URL synchronously if cached (use for first render), else undefined. */
  function peek(path: string): string | undefined {
    const e = entries.get(path);
    return e?.url && e.expiresAt > Date.now() ? e.url : undefined;
  }

  async function get(path: string): Promise<string> {
    const now = Date.now();
    prune(now);
    let entry = entries.get(path);
    if (!entry) {
      entry = { expiresAt: 0 };
      entries.set(path, entry);
    } else {
      touch(path, entry);
    }
    const remaining = entry.expiresAt - now;
    if (entry.url && remaining > refreshWindowMs) return entry.url;
    if (entry.inFlight) return entry.url && remaining > 0 ? entry.url : entry.inFlight;
    const pending = startSigning(path, entry);
    // Inside the refresh window the old URL is still valid: return it, re-sign in the background.
    if (entry.url && remaining > 0) {
      pending.catch(() => undefined);
      return entry.url;
    }
    return pending;
  }

  return {
    get,
    peek,
    invalidate: (path: string) => void entries.delete(path),
    clear: () => entries.clear(),
    size: () => entries.size,
  };
}

/*
 * Example (Supabase Storage, private bucket)
 *
 * export const avatarUrls = createSignedUrlCache({
 *   ttlSec: 3600,
 *   sign: async (path, ttl) => {
 *     const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, ttl);
 *     if (error || !data) throw error ?? new Error('sign failed');
 *     return data.signedUrl;
 *   },
 * });
 *
 * const { data: uri } = useQuery({ queryKey: ['signed', 'avatars', path], queryFn: () => avatarUrls.get(path),
 *   initialData: avatarUrls.peek(path), staleTime: 5 * 60_000 });
 */
