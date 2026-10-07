/**
 * session-generation.ts — drop late async writes after sign-out or an account switch.
 *
 * Deps: none.
 *
 * Problem: a request started as user A resolves after A signed out (or B signed in) and writes
 * A's data into the query cache, a snapshot, a store or storage. Clearing caches at sign-out
 * does not help if a write lands a moment later.
 *
 * Fix: a monotonically increasing generation number. Capture it before `await`, check it before
 * writing. sign-out.ts (and account switch) call `bumpGeneration()` first, so every in-flight
 * operation from the old session becomes stale.
 *
 * Adapt:
 * - Use `captureGeneration()` + `isCurrent()` in any async path that writes to a cache or store
 *   (query snapshot writes, optimistic updates, background sync, realtime handlers).
 * - `onGenerationChange` lets long-lived subscribers (realtime, polling) tear down.
 */

export type Generation = number & { readonly __brand: 'SessionGeneration' };

let current = 0;
const listeners = new Set<(gen: Generation) => void>();

/** Snapshot of the current generation; store it before any `await`. */
export function captureGeneration(): Generation {
  return current as Generation;
}

/** True only if no sign-out / account switch happened since `gen` was captured. */
export function isCurrent(gen: Generation): boolean {
  return gen === current;
}

/** Invalidate every in-flight operation. Call first in sign-out and on account switch. */
export function bumpGeneration(): Generation {
  current += 1;
  const gen = current as Generation;
  for (const fn of listeners) {
    try {
      fn(gen);
    } catch (err) {
      if (__DEV__) console.warn('[generation] listener failed', err);
    }
  }
  return gen;
}

export function onGenerationChange(fn: (gen: Generation) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Runs `task`, then `apply` only if the session is still the same. Returns whether it applied. */
export async function runIfCurrent<T>(task: () => Promise<T>, apply: (value: T) => void): Promise<boolean> {
  const gen = captureGeneration();
  const value = await task();
  if (!isCurrent(gen)) return false;
  apply(value);
  return true;
}

/*
 * Example
 *
 * const gen = captureGeneration();
 * const profile = await api.get('/v1/me', { schema: Profile });
 * if (!isCurrent(gen)) return;          // user signed out meanwhile: discard
 * queryClient.setQueryData(keys.me, profile);
 */
