/**
 * secure-session-storage.ts — Supabase-compatible auth storage (getItem/setItem/removeItem)
 * backed by expo-secure-store, with transparent chunking for values over the ~2KB limit.
 *
 * Deps:  npx expo install expo-secure-store
 *
 * Why chunking: some iOS versions reject SecureStore values above ~2048 bytes and a Supabase
 * session (access + refresh token + user object) often exceeds that. Values are split by UTF-8
 * byte length; the base key holds either the plain value or a `__chunks__:<n>` manifest.
 * Alternative: keep only a random key in SecureStore and the session in encrypted MMKV
 * (app-storage.ts). Chunking keeps the session fully in Keychain/Keystore, which is preferred.
 *
 * Keychain accessibility: AFTER_FIRST_UNLOCK lets background tasks (push handlers, background
 * fetch) refresh the session while the device is locked, after the first unlock since boot.
 * Trade-off: the item is readable while locked (WHEN_UNLOCKED is stricter but breaks background
 * refresh) and it migrates to a new device via encrypted backups. Use
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY to keep sessions device-bound (users sign in again after
 * a device transfer). Changing this later only affects newly written items.
 *
 * Adapt:
 * - iOS keeps Keychain items after uninstall. On first launch after install (flag absent in
 *   app-storage), call `secureSessionStorage.removeItem(<supabase storage key>)` to drop stale sessions.
 * - Sync SecureStore APIs block the JS thread; this adapter is async only.
 */
import * as SecureStore from 'expo-secure-store';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
const MAX_CHUNK_BYTES = 1800; // under the ~2048-byte limit with headroom
const MANIFEST_PREFIX = '__chunks__:';

/** SecureStore keys allow only [A-Za-z0-9._-]. */
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');
const chunkKey = (key: string, i: number) => `${key}.chunk${i}`;

/** Split by UTF-8 byte length without breaking surrogate pairs. */
function splitUtf8(value: string, maxBytes: number): string[] {
  const out: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const isHighSurrogate = c >= 0xd800 && c <= 0xdbff;
    const size = c < 0x80 ? 1 : c < 0x800 ? 2 : isHighSurrogate ? 4 : 3;
    const width = isHighSurrogate ? 2 : 1;
    if (bytes + size > maxBytes) {
      out.push(value.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += size;
    i += width - 1;
  }
  out.push(value.slice(start));
  return out;
}

const parseCount = (v: string | null) =>
  v?.startsWith(MANIFEST_PREFIX) ? Number.parseInt(v.slice(MANIFEST_PREFIX.length), 10) || 0 : 0;

/** Serialize operations per key: refresh can call setItem/removeItem concurrently. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(key, next);
  void next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => undefined);
  return next;
}

async function deleteChunks(key: string, from: number, to: number) {
  for (let i = from; i < to; i++) await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
}

export const secureSessionStorage = {
  getItem(rawKey: string): Promise<string | null> {
    const key = safeKey(rawKey);
    return withLock(key, async () => {
      const head = await SecureStore.getItemAsync(key, OPTIONS);
      const count = parseCount(head);
      if (!count) return head; // plain value or null
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await SecureStore.getItemAsync(chunkKey(key, i), OPTIONS);
        if (part == null) return null; // torn write → treat as signed out
        parts.push(part);
      }
      return parts.join('');
    });
  },

  setItem(rawKey: string, value: string): Promise<void> {
    const key = safeKey(rawKey);
    return withLock(key, async () => {
      const oldCount = parseCount(await SecureStore.getItemAsync(key, OPTIONS));
      const chunks = splitUtf8(value, MAX_CHUNK_BYTES);
      if (chunks.length === 1) {
        await SecureStore.setItemAsync(key, value, OPTIONS);
        await deleteChunks(key, 0, oldCount);
        return;
      }
      // Chunks first, manifest last: a crash mid-write leaves at worst an unparsable session,
      // which Supabase treats as signed out (never a half-valid one).
      for (let i = 0; i < chunks.length; i++) await SecureStore.setItemAsync(chunkKey(key, i), chunks[i], OPTIONS);
      await SecureStore.setItemAsync(key, `${MANIFEST_PREFIX}${chunks.length}`, OPTIONS);
      await deleteChunks(key, chunks.length, oldCount);
    });
  },

  removeItem(rawKey: string): Promise<void> {
    const key = safeKey(rawKey);
    return withLock(key, async () => {
      const count = parseCount(await SecureStore.getItemAsync(key, OPTIONS));
      await SecureStore.deleteItemAsync(key, OPTIONS);
      await deleteChunks(key, 0, count);
    });
  },
};
