/**
 * sign-out.ts — one orchestrated, idempotent wipe of everything tied to the signed-in user.
 *
 * Deps:  npx expo install expo-image expo-secure-store expo-router
 *        Uses: session-generation.ts, query-client.ts, app-storage.ts, query-snapshot-cache.ts,
 *        supabase-client.ts (or your API's logout endpoint).
 *
 * Order matters:
 * 1. bump the session generation (in-flight requests can no longer write back),
 * 2. cancel queries + close realtime channels,
 * 3. revoke the session server-side (best effort, bounded by a timeout),
 * 4. clear the query cache, user-scoped storage, snapshots, SecureStore items, image caches,
 * 5. reset client stores through the registry,
 * 6. navigate to the auth screen.
 * Every step runs even if an earlier one fails; the wipe must never stop halfway.
 *
 * Adapt:
 * - Stores: call `registerStoreReset(() => useXStore.getState().reset())` next to each store.
 * - SecureStore: `registerSecureItem('push-token')` for every user-bound item you add.
 * - API backend: replace the Supabase revoke with `api.post('/v1/auth/logout', { auth: true })`.
 * - Route: change AUTH_ROUTE to your sign-in screen.
 * - Register for 401 handling: `api.setOnUnauthorized(() => signOut({ reason: 'expired' }))`.
 */
import { Image } from 'expo-image';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { bumpGeneration } from './session-generation';
import { queryClient } from './query-client';
import { appStorage } from './app-storage';
import { clearAllSnapshots } from './query-snapshot-cache';
import { supabase, SUPABASE_STORAGE_KEY } from './supabase-client';
import { secureSessionStorage } from './secure-session-storage';

const AUTH_ROUTE = '/sign-in';
const USER_PREFIX = 'u:';
const REVOKE_TIMEOUT_MS = 3_000;

export type SignOutReason = 'user' | 'expired' | 'account-switch' | 'account-deleted';

const storeResets = new Set<() => void>();
const secureItems = new Set<string>();

export function registerStoreReset(reset: () => void): () => void {
  storeResets.add(reset);
  return () => { storeResets.delete(reset); };
}

export function registerSecureItem(key: string): void {
  secureItems.add(key);
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

let inFlight: Promise<void> | null = null;

/** Safe to call concurrently (e.g. several 401s at once): all callers share one run. */
export function signOut(opts: { reason?: SignOutReason; navigate?: boolean } = {}): Promise<void> {
  inFlight ??= run(opts.reason ?? 'user', opts.navigate ?? true).finally(() => { inFlight = null; });
  return inFlight;
}

async function run(reason: SignOutReason, navigate: boolean): Promise<void> {
  const failures: string[] = [];
  const step = async (name: string, fn: () => unknown) => {
    try {
      await fn();
    } catch (err) {
      failures.push(`${name}: ${(err as Error)?.message ?? String(err)}`);
    }
  };

  bumpGeneration();
  await step('cancel queries', () => queryClient.cancelQueries());
  await step('realtime', () => supabase.removeAllChannels());

  // scope 'local' revokes this device's refresh token server-side (other devices stay signed in);
  // an expired session gets a 401 that supabase-js ignores. On a network failure supabase-js keeps
  // the stored session, so it is deleted explicitly below (auth reads it from storage).
  await step('revoke', () => withTimeout(supabase.auth.signOut({ scope: 'local' }), REVOKE_TIMEOUT_MS));
  await step('local session', () =>
    Promise.all([
      secureSessionStorage.removeItem(SUPABASE_STORAGE_KEY),
      secureSessionStorage.removeItem(`${SUPABASE_STORAGE_KEY}-code-verifier`),
    ]),
  );

  await step('query cache', () => queryClient.clear());
  await step('snapshots', () => clearAllSnapshots());
  await step('user storage', () => appStorage.clearPrefix(USER_PREFIX));
  await step('secure items', () => Promise.all([...secureItems].map((k) => SecureStore.deleteItemAsync(k))));
  await step('image disk cache', () => Image.clearDiskCache());
  await step('image memory cache', () => Image.clearMemoryCache());
  await step('stores', () => { for (const reset of storeResets) reset(); });

  if (__DEV__ && failures.length) console.warn(`[sign-out:${reason}] steps failed:`, failures);
  if (navigate) await step('navigate', () => router.replace(AUTH_ROUTE));
}
