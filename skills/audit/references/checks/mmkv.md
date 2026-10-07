# MMKV checks (category `mmkv`)
Scope: local key-value persistence — MMKV setup, encryption, init robustness, instance layout, per-user scoping, and AsyncStorage on hot paths.

Check ids (`MMKV-Cnn`) are stable references for this file; findings get report ids `MMKV-001…`. Token storage itself is scored in `secure-storage`; here score the bulk/key-value layer.

**n/a / not-installed rule (contract):** if `react-native-mmkv` is absent, score how much the app *would* need it (AsyncStorage on startup/hot paths → ≤ 6). Only mark `n/a` when there is no local persistence at all.

## API versions (verify against https://github.com/mrousavy/react-native-mmkv before quoting)

| | v3 | v4 (current) |
|---|---|---|
| Create | `new MMKV({ id, encryptionKey })` | `createMMKV({ id, encryptionKey, encryptionType? })` |
| Delete key | `storage.delete(key)` | `storage.remove(key)` |
| Re-key | `storage.recrypt(key)` | `storage.encrypt(key, type?)` / `storage.decrypt()` |
| Requirements | New Architecture (TurboModules) | Nitro Modules (`react-native-nitro-modules`), RN 0.76+ |
| Shared | `set`, `getString/Number/Boolean/Buffer`, `contains`, `getAllKeys`, `clearAll`, hooks `useMMKVString/Number/Boolean/Object` | same + `trim()`, `byteSize`, `importAllFrom()` |

Neither runs in Expo Go (dev client / prebuild required). On web, MMKV falls back to `localStorage` (plain text) — never rely on its encryption on web. Detect the installed major from `stack.libs["react-native-mmkv"]` and flag API mismatches (e.g. `new MMKV` with v4 installed).

## Signals to start from

| Scan path | Meaning |
|---|---|
| `stack.libs["react-native-mmkv"]` | Installed + major version. |
| `hits["mmkv-instance"]` | Instance creation sites — count, ids, options. Many sites = possible duplicate instances with the same id. |
| `hits["mmkv-encryption"]` | `encryptionKey:` or re-keying present. Absent while personal data is stored = finding. |
| `hits["mmkv-hooks"]` | Reactive hooks usage. |
| `hits["mmkv-sensitive-key"]` | Credential-looking keys written to a KV store (cross-check `secure-storage`). |
| `hits["asyncstorage-import"]`, `hits["asyncstorage-call"]` | AsyncStorage usage — find which are on startup or hot paths. |
| `hits["asyncstorage-sensitive"]` | Sensitive values in AsyncStorage (P0 in `secure-storage`; here: migration plan). |
| `hits["securestore-call"]` | Where the encryption key (and tokens) live. |
| `hits["storage-clear-all"]`, `hits["sign-out"]` | Wipe on sign-out. |
| `hits["sqlite-usage"]` | SQLite present — MMKV is for KV; large relational data belongs in SQLite. |
| `hits["query-persist-whole"]` | Persister target storage (often AsyncStorage). |

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| MMKV-C01 | Sync storage on hot paths | `hits["asyncstorage-call"]` inside startup bootstrap, root layout, render-time reads (feature flags, theme, onboarding flag), list rows. | P1 if it delays first content or causes flashes (theme/onboarding flicker); P2 otherwise | Move those keys to MMKV (sync reads). |
| MMKV-C02 | Encryption for personal data | Instance storing personal/cached user data created without `encryptionKey`. | P1 (personal data at rest in plain text); P2 for non-personal prefs | Encrypt the instance with a random key held in SecureStore (pattern). |
| MMKV-C03 | Encryption key handling | Key hard-coded, derived from user id/device id, or stored in AsyncStorage/MMKV itself. | P0 if hard-coded/derivable and the store holds sensitive data; P1 otherwise | `expo-crypto` random 16–32 bytes → hex/base64 → `SecureStore.setItemAsync('mmkv.key', …)` once; read at init. |
| MMKV-C04 | Not abusing SecureStore for bulk | Large JSON chunked across many SecureStore keys (each read = keystore decrypt; ~100 KB = dozens of decrypts at startup). | P1 if on startup path; P2 otherwise | SecureStore holds only the small key; MMKV (encrypted) holds the bulk. |
| MMKV-C05 | Undecryptable store recovery | What happens when the keystore was reset / backup restored to a new device / key missing but store exists? Look for a canary check. | P1 (startup crash or garbage reads) | Canary key written at creation; on init, if canary unreadable → `clearAll()` and continue (pattern). |
| MMKV-C06 | Bounded init | Init awaits SecureStore key with no timeout before rendering. | P1 (hangs on keystore hiccups) | Race with timeout (~400 ms); fall back to an ephemeral in-memory store. |
| MMKV-C07 | Ephemeral fallback is safe | While on the fallback, does the app still persist personal data anywhere (AsyncStorage fallback, unencrypted instance)? | P1 | Ephemeral = memory only; never persist personal data until the encrypted store is ready; retry init later. |
| MMKV-C08 | Early clears queued | `clear()`/sign-out called before init finishes is lost. | P2 (P1 if user data survives sign-out) | Queue clear requests and apply right after init. |
| MMKV-C09 | Instances per concern | One default instance mixing query snapshots, prefs, feature flags, drafts. | P2 | Separate ids: `cache` (wipeable, encrypted), `prefs` (device-level, survives sign-out), `drafts` (user, encrypted). |
| MMKV-C10 | Per-user scoping | Keys not prefixed by user/role; user switch shows previous user's cached data. | P1 (data leak between accounts on shared devices) | Prefix `u:<userId>:`; on sign-out remove all keys with the prefix (or `clearAll()` the user instance). |
| MMKV-C11 | Wipe on sign-out | `hits["sign-out"]` handler: user-scoped MMKV data removed? | P1 (score detail in `auth-sessions`) | `getAllKeys().filter(k => k.startsWith(prefix)).forEach(k => store.remove(k))` (v4) / `delete` (v3). |
| MMKV-C12 | Legacy AsyncStorage data handled | After moving to MMKV: old AsyncStorage keys left behind; sensitive ones migrated (copying secrets forward) instead of deleted. | P1 if sensitive data remains in AsyncStorage; P2 otherwise | One-time cleanup: non-sensitive → migrate; sensitive → delete (`AsyncStorage.multiRemove`) and re-fetch. Guard with a `migrated:v1` flag. |
| MMKV-C13 | API matches installed major | `new MMKV` with v4, `.delete` with v4, `.recrypt` with v4, hooks imported from wrong path. | P1 if it crashes at runtime; P2 if typed-out | Align with the installed major (table above). |
| MMKV-C14 | Single instance per id | Same `id` created in several modules (each `createMMKV`/`new MMKV` call). | P2 | Export one instance from `lib/storage/*`. |
| MMKV-C15 | Value sizes reasonable | Huge JSON blobs (> ~1 MB) per key, images/base64 in MMKV, unbounded lists appended forever. | P2 (P1 if it slows startup) | Bound sizes, prune; files → `expo-file-system`; relational/large → SQLite. |
| MMKV-C16 | Parsing is guarded | `JSON.parse(store.getString(k)!)` without try/catch or shape validation. | P2 (P1 if a corrupt value crashes startup) | `safeParse` + schema/shape guard; drop invalid values. |
| MMKV-C17 | Reactive reads where UI depends on them | Components read once (`getString` in render) but the value changes elsewhere (theme, flags) → stale UI. | P2 | `useMMKVString`/listeners, or a store (zustand) backed by MMKV. |
| MMKV-C18 | Web fallback considered | App targets web (`react-native-web` / `platforms`) and stores personal data via MMKV → plain `localStorage`. | P2 (P1 if tokens/personal data) | Platform split: on web, no persistence of personal data, or a server session. |
| MMKV-C19 | Native rebuild acknowledged | MMKV (or its major upgrade) added but not in dev client/EAS build; Expo Go instructions in README. | P2 | Document dev-client requirement; rebuild. |

## Proven patterns

**Encrypted instance with SecureStore-held key, canary and bounded init (v4 API)**
```ts
import { createMMKV, type MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const KEY_NAME = 'storage.cache.key';
const CANARY = '__canary';
let store: MMKV | null = null;
let ephemeral = true;
const pendingClears: Array<() => void> = [];

async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const bytes = Crypto.getRandomBytes(16);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_NAME, key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  return key;
}

export async function initStorage(timeoutMs = 400) {
  const key = await Promise.race([getOrCreateKey(), sleep(timeoutMs).then(() => null)]);
  if (!key) return;                                     // stay ephemeral (memory only), retry later
  const s = createMMKV({ id: 'cache', encryptionKey: key });
  if (s.getAllKeys().length > 0 && s.getString(CANARY) !== 'ok') s.clearAll();  // undecryptable / key reset
  s.set(CANARY, 'ok');
  store = s;
  ephemeral = false;
  pendingClears.splice(0).forEach((fn) => fn());
}

export function clearUser(prefix: string) {
  const run = () => store?.getAllKeys().filter((k) => k.startsWith(prefix)).forEach((k) => store!.remove(k));
  ephemeral ? pendingClears.push(run) : run();
}
```
(v3: `new MMKV({ id, encryptionKey })` and `store.delete(k)`.)

**Instance layout**
```ts
export const prefs = createMMKV({ id: 'prefs' });                 // theme, onboarding seen — not personal
// cache (encrypted, per-user prefix, wiped on sign-out) created in initStorage()
```

**AsyncStorage cleanup**
```ts
if (!prefs.getBoolean('migrated.asyncstorage.v1')) {
  await AsyncStorage.multiRemove(['session', 'user_profile_cache']);  // sensitive: delete, don't migrate
  const theme = await AsyncStorage.getItem('theme');
  if (theme) prefs.set('theme', theme);
  prefs.set('migrated.asyncstorage.v1', true);
}
```

## Not a problem when

- AsyncStorage used for rare, non-startup, non-sensitive writes (e.g. "last export date") — P2 suggestion at most.
- Unencrypted `prefs` instance holding only non-personal UI prefs (theme, language, onboarding flag).
- `hits["mmkv-sensitive-key"]` on an instance that is encrypted with a SecureStore-held key — verify the instance, then drop.
- `@react-native-async-storage/async-storage` installed only as a transitive requirement of another lib, with no app-level calls.
- `clearAll()` without per-user prefix when the instance is user-only and recreated per session.
- Apps with SQLite as the main store and only a handful of prefs — MMKV optional; score the prefs path.

## Score anchors

| Band | `mmkv` looks like |
|---|---|
| 0–2 | Personal data and/or credentials in AsyncStorage or unencrypted MMKV; hard-coded encryption key; startup crashes on corrupt store. |
| 3–4 | AsyncStorage awaited at startup and in render paths; MMKV (if any) unencrypted for personal data; no per-user scoping; nothing wiped on sign-out. |
| 5–6 | MMKV used for hot keys but single unencrypted instance, no canary, unbounded init, leftover AsyncStorage data. |
| 7–8 | Encrypted instance with SecureStore key, bounded init + ephemeral fallback, per-user prefix wiped on sign-out, instances per concern. |
| 9–10 | All of 7–8 plus canary recovery, queued clears, guarded parsing, legacy cleanup done, web path considered, API matches installed major. |
