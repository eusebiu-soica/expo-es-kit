# Secure storage checks (category `secure-storage`)

Scope: where the app persists credentials, keys and personal data on the device, and whether each store matches the sensitivity of what it holds.

Check-IDs below are stable references. Finding `id`s follow `shared/contract.md` (`SEC-001`, `SEC-002`, … numbered per report); put the Check-ID in the finding `title` or `evidence`.

## Signals to start from

| Signal | Meaning | Next step |
|---|---|---|
| hit `asyncstorage-sensitive` | `AsyncStorage.setItem/multiSet/mergeItem` with a key/value that looks like token/session/password | Open the line. Confirm the value is a credential (not e.g. a boolean `hasSeenAuthIntro`). Confirmed credential = P0. |
| hit `mmkv-sensitive-key` | MMKV `.set('access_token'…)` style write | Find the MMKV instance. Encrypted with a key from SecureStore = fine. Unencrypted = P1 (P0 if refresh token). |
| hit `securestore-call` | SecureStore is used | List every key written. Check size of values (2048-byte guidance) and options. |
| hit `securestore-options` | `keychainAccessible` / `requireAuthentication` set | Check the chosen accessibility class (see SEC-05). |
| hit `mmkv-instance` + `mmkv-encryption` | MMKV present; encryption configured or not | For each instance holding personal data, confirm `encryptionKey` comes from SecureStore, never a literal. |
| hit `storage-clear-all` | Wipe calls exist | Cross-check with `auth-sessions` sign-out wipe (AUTH-08). |
| hit `query-persist-whole` | Whole query cache persisted | The persisted blob probably contains personal data; check where it is written and whether it is encrypted. |
| hit `sqlite-usage` | Local SQLite | Check whether it holds personal data and whether it is encrypted (SQLCipher) or wiped on sign-out. |
| hit `supabase-storage-adapter` / file rule `supabase-client-no-secure-storage` | Supabase client storage option | Read the adapter: AsyncStorage / `expo-sqlite/localStorage` / plain MMKV = plaintext session on disk. |
| `stack.libs` | `expo-secure-store`, `react-native-mmkv`, `@react-native-async-storage/async-storage`, `expo-sqlite` | Missing `expo-secure-store` in an app with auth is itself a strong signal. |
| `config.android.allowBackup` | Android auto-backup | `true`/unset + plaintext personal data in AsyncStorage/MMKV = data leaves the device in backups. |

Signals are not findings. Read the code before writing anything.

Note: Expo's "Using Supabase" guide initializes the client with `import 'expo-sqlite/localStorage/install'` and `storage: localStorage`. That is a plaintext SQLite file: same class as AsyncStorage. A documented quickstart is not an exemption for an app holding personal data.

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| SEC-01 | Credentials (access/refresh token, session JSON, API keys issued to the user, device-session secret, PIN) live only in SecureStore or in a store encrypted with a SecureStore-held key | Trace every write of the session/token. Include the Supabase `auth.storage` adapter and any custom token cache. | P0 if refresh token / session in AsyncStorage, `expo-sqlite/localStorage` or unencrypted MMKV. P1 if short-lived access token only | SecureStore adapter, or LargeSecureStore pattern (see Proven patterns) |
| SEC-02 | No oversized values in SecureStore | Estimate the value size: Supabase session JSON with provider tokens/user metadata can exceed 2 KB. Look for chunking code (`key_0`, `key_1`…). | P1 if chunking a large JSON blob (perf + partial-write corruption); P2 if close to limit | Encrypt bulk data with AES key held in SecureStore, store ciphertext in MMKV/file |
| SEC-03 | SecureStore not used as a database | Count keys/reads at startup. Each `getItemAsync` is a Keychain/Keystore decrypt (~ms each). A 100 KB JSON chunked into ~55 SecureStore items meant ~55 keystore decrypts on every cold start. | P1 if >10 reads on startup path | One 32-byte key in SecureStore; bulk ciphertext in MMKV (`encryptionKey`) |
| SEC-04 | Personal data at rest (profile, health/progress photos, messages, cached API responses) is encrypted or not persisted | List MMKV instances, AsyncStorage keys, persisted query caches, files in `FileSystem.documentDirectory`. | P1 for sensitive personal data in plaintext; P2 for low-sensitivity profile basics | Encrypted MMKV instance per user; memory-only for high-sensitivity query families |
| SEC-05 | `keychainAccessible` appropriate | `AFTER_FIRST_UNLOCK` is needed if background tasks read the token; `WHEN_UNLOCKED_THIS_DEVICE_ONLY` for highest-sensitivity values. `ALWAYS*` is deprecated-grade weak. | P2 (P1 if `ALWAYS`) | Pick explicitly; prefer `*_THIS_DEVICE_ONLY` for credentials so they do not migrate in encrypted backups to a new device |
| SEC-06 | iOS Keychain survives uninstall: stale credentials handled | Look for a first-run marker (MMKV/AsyncStorage flag) that clears SecureStore on fresh install. | P2 (P1 for shared-device / regulated apps) | On first launch with no install marker, `deleteItemAsync` all known keys, then set marker |
| SEC-07 | No credential inside a storage key or query key | Grep MMKV/AsyncStorage keys and TanStack `queryKey` arrays for tokens/invite codes (e.g. `['invite', inviteToken]`). Keys are logged, persisted and visible in devtools. | P1 | Key by user id / hashed id; pass credential only in request headers |
| SEC-08 | Encryption keys are not hard-coded | `encryptionKey: 'my-secret'`, keys in `EXPO_PUBLIC_*`, keys derived from user id. | P1 (anyone with the bundle decrypts every device) | Random 32 bytes from `expo-crypto` `getRandomBytes`, stored in SecureStore |
| SEC-09 | Legacy plaintext snapshots removed, not migrated | Look for one-time migration code. Personal data previously in AsyncStorage must be **deleted**, not copied into the new store (copying keeps history in backups and wastes a startup read). | P2 (P1 if old plaintext copy still read/written) | One-shot `multiRemove` of legacy keys behind a version flag |
| SEC-10 | Per-user namespacing | MMKV ids / key prefixes include the user id (or role + user id) so sign-out can wipe one user and account switch never reads another user's data. | P1 if a shared unscoped store holds personal data on multi-account devices | `createMMKV({ id: \`user.${userId}\`, encryptionKey })` |
| SEC-11 | Web fallback documented | If the app ships to web (`web.output`), SecureStore is not available there; any fallback to `localStorage` is weaker (XSS-readable). | P2 (document); P1 if web target is production and stores refresh tokens in localStorage without CSP | Document the trade-off; prefer httpOnly cookie session for web builds |
| SEC-12 | Android backup does not leak plaintext stores | `config.android.allowBackup` and any custom backup rules vs. plaintext MMKV/AsyncStorage/SQLite containing personal data. SecureStore itself is excluded from Auto Backup automatically. | P2 (P1 for sensitive personal data) | Encrypt stores (keys in SecureStore do not restore → data unreadable after restore) or set `allowBackup: false` |
| SEC-13 | Files with sensitive content (downloads, photos, PDFs) not left in shared/cache dirs indefinitely | Grep `FileSystem.downloadAsync`, `cacheDirectory`, `documentDirectory`, `MediaLibrary.saveToLibraryAsync`. | P2 (P1 for medical/identity docs saved to camera roll without user action) | Store under per-user dir, delete on sign-out, never auto-save to media library |

## Proven patterns

SecureStore adapter for Supabase (session usually fits; verify size):

```ts
import * as SecureStore from 'expo-secure-store';
const opts: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
export const secureStorage = {
  getItem: (k: string) => SecureStore.getItemAsync(k, opts),
  setItem: (k: string, v: string) => SecureStore.setItemAsync(k, v, opts),
  removeItem: (k: string) => SecureStore.deleteItemAsync(k, opts),
};
```

Bulk encrypted store: small key in SecureStore, data in encrypted MMKV (react-native-mmkv v3 API `new MMKV`, v4 `createMMKV`; check the installed major). Prefer `encryptionType: 'AES-256'` with a 32-character key when the installed version supports it:

```ts
import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { createMMKV } from 'react-native-mmkv';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; // 64 chars = 6 bits each
const randomKey = (len: number) => Array.from(getRandomBytes(len), (x) => ALPHABET[x & 63]).join('');

export async function openUserStore(userId: string) {
  const keyName = `mmkv-key.${userId}`;
  let key = await SecureStore.getItemAsync(keyName);
  if (!key) {
    // AES-128 default takes a 16-byte key string; v4 also offers encryptionType 'AES-256' (32-byte key).
    // Verify the key-length rules of the installed major before changing this.
    key = randomKey(16); // 16 chars x 6 bits = 96 bits; use randomKey(32) with AES-256
    await SecureStore.setItemAsync(keyName, key, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
  return createMMKV({ id: `user.${userId}`, encryptionKey: key });
}
```

LargeSecureStore (Supabase's documented pattern for sessions > 2 KB): AES key in SecureStore, ciphertext in AsyncStorage/MMKV. Acceptable as SEC-01 pass.

Fresh-install Keychain reset (iOS keeps Keychain after uninstall):

```ts
const marker = storage.getBoolean('installed');
if (!marker) {
  await Promise.all(KNOWN_SECURE_KEYS.map((k) => SecureStore.deleteItemAsync(k)));
  storage.set('installed', true);
}
```

## Not a problem when

- `AsyncStorage` holds non-sensitive UI prefs (theme, onboarding seen, last tab, feature flags). `asyncstorage-sensitive` can match keys like `authScreenSeen` — read the value.
- `mmkv-sensitive-key` fires on an MMKV instance created with an `encryptionKey` loaded from SecureStore.
- Supabase **anon / publishable key** stored or shipped in config: public by design (RLS is the boundary). Not a storage finding.
- Session > 2 KB stored via LargeSecureStore / encrypted MMKV with SecureStore-held key — this is the recommended fix, not a violation.
- SecureStore items with no `keychainAccessible` option: default is `WHEN_UNLOCKED`, acceptable unless background tasks need the token.
- `expo-sqlite` holding public catalog/offline content with no personal data.
- Web-only fallbacks that are documented and the web target is internal/dev only.

## Score anchors

- **0–2**: refresh token/session in plaintext storage AND personal data in plaintext; or hard-coded encryption key protecting credentials.
- **3–4**: one confirmed P0 (e.g. Supabase session in AsyncStorage / `expo-sqlite/localStorage`), rest reasonable.
- **5–6**: credentials secure, but sensitive personal data in plaintext (P1) or SecureStore abused as bulk storage (55 decrypts at startup), no per-user namespacing.
- **7–8**: credentials in SecureStore, bulk data encrypted, minor gaps (accessibility class implicit, no fresh-install reset, legacy keys not removed).
- **9–10**: credentials SecureStore-only with explicit accessibility, bulk personal data encrypted with per-user keys, legacy plaintext deleted, backup/web trade-offs documented, no credentials in keys.
