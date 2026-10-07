/**
 * query-snapshot-cache.ts — per-family persisted query snapshots on encrypted app-storage.
 *
 * Deps: app-storage.ts, session-generation.ts, @tanstack/react-query (types only).
 *
 * Why not persistQueryClient: whole-cache persistence restores everything at startup, grows
 * without bound and revives data of a different user. Snapshots are opt-in per family, carry a
 * version + timestamp, are shape-checked on read and expire.
 *
 * Storage key: `snapshot:<family>:<key>` → `{ v, t, d }` (version, savedAt ms, data).
 * - revalidateTtlMs: how long a restored snapshot counts as fresh (used as the query's staleTime).
 * - maxAgeMs: older snapshots are deleted instead of shown.
 * - isValid: shape guard; anything that fails it is deleted (schema changed, corruption).
 * - persist: false → memory only (high-churn or sensitive families). Also automatic when
 *   app-storage is ephemeral.
 *
 * Adapt:
 * - Include the user id in `key` (or rely on sign-out wiping the `snapshot:` prefix — sign-out.ts does).
 * - Bump `version` whenever the cached shape changes.
 */
import type { QueryKey } from '@tanstack/react-query';
import { appStorage } from './app-storage';
import { captureGeneration, isCurrent } from './session-generation';

export const SNAPSHOT_PREFIX = 'snapshot:';

interface Envelope<T> { v: number; t: number; d: T }

export interface SnapshotFamilyConfig<T> {
  family: string;
  revalidateTtlMs: number;
  maxAgeMs: number;
  isValid: (value: unknown) => value is T;
  version?: number;
  persist?: boolean;
  /** Skip persisting payloads larger than this (serialized chars). */
  maxChars?: number;
}

const memory = new Map<string, Envelope<unknown>>();

export function defineSnapshotFamily<T>(cfg: SnapshotFamilyConfig<T>) {
  const version = cfg.version ?? 1;
  const persist = cfg.persist ?? true;
  const maxChars = cfg.maxChars ?? 200_000;
  const storageKey = (key: string) => `${SNAPSHOT_PREFIX}${cfg.family}:${key}`;

  const isEnvelope = (x: unknown): x is Envelope<T> =>
    typeof x === 'object' && x !== null &&
    (x as Envelope<T>).v === version && typeof (x as Envelope<T>).t === 'number' && cfg.isValid((x as Envelope<T>).d);

  function read(key: string): { data: T; savedAt: number } | undefined {
    const k = storageKey(key);
    const env = (memory.get(k) as Envelope<T> | undefined) ?? (persist ? appStorage.getJSON<Envelope<T>>(k, isEnvelope) : undefined);
    if (!env) return undefined;
    if (Date.now() - env.t > cfg.maxAgeMs) {
      remove(key);
      return undefined;
    }
    memory.set(k, env);
    return { data: env.d, savedAt: env.t };
  }

  /** Pass the generation captured before the fetch started to drop late writes after sign-out. */
  function write(key: string, data: T, generation = captureGeneration()): void {
    if (!isCurrent(generation)) return;
    const k = storageKey(key);
    const env: Envelope<T> = { v: version, t: Date.now(), d: data };
    memory.set(k, env);
    if (!persist) return;
    const json = JSON.stringify(env);
    if (json.length > maxChars) {
      if (__DEV__) console.warn(`[snapshot] ${cfg.family} payload too large (${json.length}), memory only`);
      appStorage.remove(k);
      return;
    }
    appStorage.setString(k, json);
  }

  function remove(key: string): void {
    const k = storageKey(key);
    memory.delete(k);
    appStorage.remove(k);
  }

  /** Spread into useQuery options: seeds initialData from the snapshot. */
  function queryOptions(key: string) {
    return {
      initialData: () => read(key)?.data,
      initialDataUpdatedAt: () => read(key)?.savedAt,
      staleTime: cfg.revalidateTtlMs,
    };
  }

  /** Wrap a fetcher so successful results are snapshotted (guarded by session generation). */
  function withSnapshot<A extends unknown[]>(key: string, fetcher: (...args: A) => Promise<T>) {
    return async (...args: A): Promise<T> => {
      const gen = captureGeneration();
      const data = await fetcher(...args);
      write(key, data, gen);
      return data;
    };
  }

  return { read, write, remove, queryOptions, withSnapshot };
}

/** Drop every snapshot (memory + disk). Called by sign-out. */
export function clearAllSnapshots(): void {
  memory.clear();
  appStorage.clearPrefix(SNAPSHOT_PREFIX);
}

/** Stable string for a query key, for families keyed by filters. */
export const snapshotKeyOf = (queryKey: QueryKey) => JSON.stringify(queryKey);

/*
 * Example
 *
 * const itemsSnapshot = defineSnapshotFamily<Item[]>({
 *   family: 'items-list', revalidateTtlMs: 5 * 60_000, maxAgeMs: 7 * 24 * 3600_000,
 *   isValid: (v): v is Item[] => Array.isArray(v) && v.every((i) => typeof i?.id === 'string'),
 * });
 *
 * export function useItems(userId: string) {
 *   const sk = `${userId}:all`;
 *   return useQuery({
 *     queryKey: keys.items.list(),
 *     queryFn: itemsSnapshot.withSnapshot(sk, () => fetchItems()),
 *     ...itemsSnapshot.queryOptions(sk),
 *   });
 * }
 */
