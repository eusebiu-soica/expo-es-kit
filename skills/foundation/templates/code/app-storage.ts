/**
 * app-storage.ts — encrypted MMKV store for bulk app data (snapshots, preferences, drafts).
 *
 * Deps:  npx expo install react-native-mmkv react-native-nitro-modules expo-secure-store expo-crypto
 *        (MMKV is native: rebuild the dev client after installing; it does not run in Expo Go.)
 *
 * Design:
 * - Encryption key: 16 random bytes (expo-crypto) → 32 hex chars, AES-256, kept in expo-secure-store.
 * - Canary: detects a store that cannot be decrypted with the current key (Android backup restored
 *   without its Keystore key, key lost, file corruption) → clearAll() and start clean.
 * - Bounded init: if SecureStore does not answer within `timeoutMs`, the app runs on an in-memory
 *   store for this session (`isAppStorageEphemeral()` → true) instead of hanging on the splash.
 * - Writes and clears issued before init are queued and replayed in order on the real store.
 *
 * Adapt:
 * - `await initAppStorage()` in the root layout before hiding the splash screen.
 * - No credentials here (use secure-session-storage.ts). User-scoped keys: `u:<userId>:<name>`.
 * - react-native-mmkv v3 (no Nitro): `import { MMKV } from 'react-native-mmkv'` and
 *   `new MMKV({ id, encryptionKey })`; v3 supports AES-128 only (key ≤ 16 bytes), so use a
 *   16-char key and drop `encryptionType`; `remove()` is `delete()` in v3.
 */
import { createMMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytesAsync } from 'expo-crypto';

const STORE_ID = 'app-storage.v1';
const KEY_NAME = 'app-storage.key.v1';
const CANARY_KEY = '__canary__';
const CANARY_VALUE = 'ok.v1';

/** The subset of the MMKV API this module uses (also implemented by the memory fallback). */
interface KV {
  getString(key: string): string | undefined; set(key: string, value: string): void; remove(key: string): void;
  contains(key: string): boolean; getAllKeys(): string[]; clearAll(): void;
}

function createMemoryKV(): KV {
  const m = new Map<string, string>();
  return {
    getString: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k),
    contains: (k) => m.has(k), getAllKeys: () => [...m.keys()], clearAll: () => m.clear(),
  };
}

type PendingOp = { t: 'set'; key: string; value: string } | { t: 'remove'; key: string }
  | { t: 'clearPrefix'; prefix: string } | { t: 'clearAll' };

let active: KV = createMemoryKV();
let ready = false;
let ephemeral = false;
let pending: PendingOp[] = [];
let initPromise: Promise<{ ephemeral: boolean }> | null = null;

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function getOrCreateKey(): Promise<string> {
  const opts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
  const existing = await SecureStore.getItemAsync(KEY_NAME, opts);
  if (existing) return existing;
  const key = toHex(await getRandomBytesAsync(16));
  await SecureStore.setItemAsync(KEY_NAME, key, opts);
  return key;
}

async function openEncrypted(): Promise<KV> {
  const encryptionKey = await getOrCreateKey();
  const store = createMMKV({ id: STORE_ID, encryptionKey, encryptionType: 'AES-256' });
  const canary = store.getString(CANARY_KEY);
  if (canary !== CANARY_VALUE) {
    // Empty store → first run. Non-empty without a valid canary → undecryptable: wipe.
    if (store.getAllKeys().length > 0) store.clearAll();
    store.set(CANARY_KEY, CANARY_VALUE);
  }
  return store;
}

function applyOp(kv: KV, op: PendingOp) {
  if (op.t === 'set') kv.set(op.key, op.value);
  else if (op.t === 'remove') kv.remove(op.key);
  else if (op.t === 'clearPrefix') clearPrefixOn(kv, op.prefix);
  else clearAllOn(kv);
}

function clearPrefixOn(kv: KV, prefix: string) {
  for (const k of kv.getAllKeys()) if (k.startsWith(prefix) && k !== CANARY_KEY) kv.remove(k);
}

function clearAllOn(kv: KV) {
  kv.clearAll();
  kv.set(CANARY_KEY, CANARY_VALUE); // harmless on the memory store; required on the encrypted one
}

/** Idempotent. Resolves within `timeoutMs`; on timeout/failure the session uses memory storage. */
export function initAppStorage({ timeoutMs = 400 } = {}): Promise<{ ephemeral: boolean }> {
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve) => {
    let settled = false;
    const fallback = (reason: unknown) => {
      if (settled) return;
      settled = true;
      ephemeral = true;
      ready = true;
      pending = []; // already applied to the memory store
      if (__DEV__) console.warn('[app-storage] using ephemeral storage:', String(reason));
      resolve({ ephemeral: true });
    };
    const timer = setTimeout(() => fallback('init timeout'), timeoutMs);
    openEncrypted().then(
      (store) => {
        if (settled) return; // timed out already: stay ephemeral for this session
        clearTimeout(timer);
        settled = true;
        for (const op of pending) applyOp(store, op);
        pending = [];
        active = store;
        ready = true;
        resolve({ ephemeral: false });
      },
      (err) => { clearTimeout(timer); fallback(err); },
    );
  });
  return initPromise;
}

export const isAppStorageEphemeral = () => ephemeral;
export const isAppStorageReady = () => ready;

function record(op: PendingOp) {
  if (!ready) pending.push(op);
  applyOp(active, op);
}

export const appStorage = {
  getString: (key: string): string | undefined => active.getString(key),
  setString: (key: string, value: string) => record({ t: 'set', key, value }),
  remove: (key: string) => record({ t: 'remove', key }),
  contains: (key: string) => active.contains(key),
  keys: (prefix = '') => active.getAllKeys().filter((k) => k !== CANARY_KEY && k.startsWith(prefix)),

  /** Returns undefined (and deletes the entry) when JSON is invalid or fails `isValid`. */
  getJSON<T = unknown>(key: string, isValid?: ((v: unknown) => v is T) | ((v: unknown) => boolean)): T | undefined {
    const raw = active.getString(key);
    if (raw === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValid && !isValid(parsed)) throw new Error('shape');
      return parsed as T;
    } catch {
      record({ t: 'remove', key });
      return undefined;
    }
  },
  setJSON: (key: string, value: unknown) => record({ t: 'set', key, value: JSON.stringify(value) }),

  clearPrefix: (prefix: string) => record({ t: 'clearPrefix', prefix }),
  clearAll: () => record({ t: 'clearAll' }),
};

export type AppStorage = typeof appStorage;
