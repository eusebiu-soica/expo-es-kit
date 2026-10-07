# storage — agent rules

Local persistence: expo-secure-store for credentials, encrypted MMKV for bulk app data. Every other folder goes through these wrappers.

## Use

- Credentials (access/refresh tokens, API keys issued to the user, PINs, private keys): expo-secure-store only, via `{{SECURE_STORE_MODULE}}`.
<!-- if:mmkv -->
- Bulk app data (snapshots, preferences, drafts): `{{STORAGE_MODULE}}`, one encrypted MMKV instance whose key (16+ random bytes from `expo-crypto`) lives in SecureStore.
- Canary key: on init, read a known value; if it cannot be decrypted, `clearAll()` and recreate instead of crashing or reading garbage.
- Bounded init (~400ms timeout). On timeout/failure fall back to an ephemeral in-memory store and expose `isAppStorageEphemeral()`; never block the splash forever.
<!-- endif -->
- Per-user key prefixes: `u:<userId>:<name>` for anything user-scoped. Device-level keys (theme, onboarding seen) use `device:`.
- Sign-out / account switch wipes the user prefix, user SecureStore items and caches through the sign-out orchestrator.
- Keychain accessibility `AFTER_FIRST_UNLOCK` for items background tasks need; `WHEN_UNLOCKED_THIS_DEVICE_ONLY` for secrets that must not leave the device or be read while locked.
- Versioned JSON values with a shape guard on read; invalid → delete and return `undefined`.

## Never

- Tokens, passwords or secrets in AsyncStorage or unencrypted MMKV.
- Credentials or PII inside key names (`token:<jwt>`, `user:<email>`). Keys are often stored and logged in clear.
- A new `createMMKV` / `new MMKV` / `AsyncStorage` call outside this folder.
- Migrate sensitive legacy data (old AsyncStorage tokens) into the new store: delete it and let the user re-authenticate.
- AsyncStorage for new code. Only to read legacy non-sensitive data once, then delete.
- SecureStore values > 2KB (iOS may reject them); chunk or store the key in SecureStore and the data in encrypted MMKV.
- Synchronous SecureStore calls (`getItem`/`setItem`) on startup or render paths; they block the JS thread.

## Patterns

```ts
import { appStorage, isAppStorageEphemeral } from '{{STORAGE_MODULE}}';

const key = (userId: string, name: string) => `u:${userId}:${name}`;
appStorage.setJSON(key(userId, 'draft'), { v: 1, text });
const draft = appStorage.getJSON(key(userId, 'draft'), isDraftV1); // guard → undefined if invalid

// Sign-out wipes the user scope
appStorage.clearPrefix(`u:${userId}:`);

// Legacy cleanup: delete, do not migrate
await AsyncStorage.multiRemove(['session', 'auth_token']);
```

## Before finishing

- [ ] No credential outside SecureStore; no secret in a key name.
- [ ] User-scoped keys prefixed and covered by the sign-out wipe.
- [ ] Reads validate shape; corrupted data is deleted, not thrown.
- [ ] App still starts when storage init times out (ephemeral fallback tested).
- [ ] `{{TYPECHECK_CMD}}` and `{{TEST_CMD}}` pass.
