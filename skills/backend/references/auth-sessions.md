# Auth & sessions: client + server lifecycle

Implementation guide for the session lifecycle in an Expo app backed by Supabase Auth (direct-db or API), plus custom device sessions for passwordless/invite flows. Audit counterpart: `skills/audit/references/checks/auth-sessions.md`.

## 1. Supabase client for React Native

```ts
// src/lib/supabase.ts
import 'react-native-url-polyfill/auto'; // only if the installed supabase-js/RN combo needs it
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { sessionStorage } from './auth/session-storage';
import type { Database } from './database.types';

export const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, // or legacy anon key: public by design
  {
    auth: {
      storage: sessionStorage,       // SecureStore adapter or LargeSecureStore — never AsyncStorage/plain localStorage
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,     // RN has no window.location; callbacks are handled explicitly
      flowType: 'pkce',
    },
  },
);

// Refresh only while foregrounded (timers are unreliable in background; avoids refresh storms on resume).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
```

Expo's own Supabase guide uses `expo-sqlite/localStorage/install` as storage: that is a plaintext file. Use one of the adapters below for any app holding personal data.

## 2. Session storage adapters

SecureStore (session JSON typically 1–2 KB; measure yours: provider tokens and large `user_metadata` push it over the ~2048-byte guidance):

```ts
// src/lib/auth/session-storage.ts
import * as SecureStore from 'expo-secure-store';
const OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const sessionStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key, OPTS),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTS),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key, OPTS),
};
```

LargeSecureStore (Supabase's documented pattern for > 2 KB): random AES-256 key per storage key in SecureStore, ciphertext (AES-CTR via `aes-js`, with `react-native-get-random-values`) in AsyncStorage or MMKV. Equivalent: encrypted MMKV instance whose `encryptionKey` lives in SecureStore. Do **not** chunk a large JSON across many SecureStore keys: every item is a keystore decrypt at startup (a ~100 KB blob became ~55 decrypts per cold start in practice).

Web builds: SecureStore is unavailable; any fallback (`localStorage`) is XSS-readable. Document it; prefer cookie sessions (`@supabase/ssr`) for a production web target.

## 3. One source of truth: `onAuthStateChange`

```ts
// src/lib/auth/AuthProvider.tsx (root)
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the auth lock.
    const prevUserId = authStore.getState().userId;
    const nextUserId = session?.user.id ?? null;
    if (prevUserId && prevUserId !== nextUserId) {
      sessionGeneration.bump();                                    // covers server-initiated sign-out and account switch
      setTimeout(() => wipeLocalUserData(prevUserId), 0);
    }
    authStore.setState({ session, userId: nextUserId, ready: true });
    if (event === 'TOKEN_REFRESHED') { /* nothing: client reads session per request */ }
  });
  return () => subscription.unsubscribe();
}, []);
```

- Screens read `authStore`, not `getSession()` ad hoc.
- `getSession()` reads local storage: fine on device for UI routing and to get the current access token for headers. It is **not** verification. Servers must use `getUser(token)` / `getClaims(token)` / JWKS `jwtVerify`.
- Route protection in Expo Router: `<Stack.Protected guard={!!session}>` (SDK 53+) or a redirect in the group layout. This is UX only; the backend enforces access.

## 4. OAuth / magic link with PKCE

```ts
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';

WebBrowser.maybeCompleteAuthSession();
const redirectTo = makeRedirectUri({ scheme: 'myapp', path: 'auth/callback' });

export async function signInWithProvider(provider: 'google' | 'apple') {
  const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data.url) throw error ?? new Error('no url');
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success') return null;
  const code = parseCallback(res.url);
  if (!code) throw new Error('invalid callback');
  const { data: s, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exErr) throw exErr;
  return s.session;
}

function parseCallback(raw: string): string | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'myapp:' || `${u.host}${u.pathname}` !== 'auth/callback') return null; // allow-list scheme/host/path
  if (u.searchParams.get('error')) return null;
  return u.searchParams.get('code');
}
```

- Magic link / OTP: `signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })`; the link opens the app → same `parseCallback` → `exchangeCodeForSession`. Or a 6-digit OTP with `verifyOtp({ email, token, type: 'email' })` (no deep link needed; works across devices).
- Apple on iOS: prefer native `expo-apple-authentication` + `signInWithIdToken({ provider: 'apple', token, nonce })` with a hashed nonce.
- Supabase Auth → URL Configuration → Redirect URLs: list exact URIs (`myapp://auth/callback`, dev variants). Avoid broad wildcards.
- Never forward `redirect_to`/`next` query params from a link to arbitrary in-app or web destinations; map to an allow-listed route set.
- PKCE stores the code verifier on the device that started the flow: links opened on another device fail by design. Offer OTP codes for cross-device.

## 5. Password reset / email change

`resetPasswordForEmail(email, { redirectTo: makeRedirectUri({ path: 'auth/reset' }) })` → link → `exchangeCodeForSession(code)` → recovery session → `updateUser({ password })` on a screen reachable only with that session → sign out other sessions (`signOut({ scope: 'others' })`). Same for email change confirmation links.

## 6. API calls: single-flight refresh + retry once

```ts
// src/lib/api/refresh.ts
let inflight: Promise<boolean> | null = null;
export function refreshOnce(): Promise<boolean> {
  inflight ??= supabase.auth.refreshSession()
    .then(({ data, error }) => !error && !!data.session)
    .catch(() => false)
    .finally(() => { setTimeout(() => { inflight = null; }, 0); });
  return inflight;
}

// src/lib/api/fetch-with-auth.ts
export async function fetchWithAuth(input: string, init: RequestInit = {}) {
  const gen = sessionGeneration.current();
  const send = async () => {
    const { data } = await supabase.auth.getSession();
    const h = new Headers(init.headers);
    if (data.session) h.set('Authorization', `Bearer ${data.session.access_token}`);
    return fetch(input, { ...init, headers: h, signal: init.signal ?? AbortSignal.timeout(15_000) });
  };
  let res = await send();
  if (res.status === 401) {
    if (!(await refreshOnce())) { await signOutEverywhere({ reason: 'refresh_failed' }); throw new Error('unauthenticated'); }
    res = await send();
    if (res.status === 401) { await signOutEverywhere({ reason: 'unauthorized_after_refresh' }); throw new Error('unauthenticated'); }
  }
  if (!sessionGeneration.isCurrent(gen)) throw new Error('stale_session'); // user changed mid-flight
  return res;
}
```

Why single-flight: refresh tokens rotate. Two parallel refreshes → the second uses an already-rotated token → reuse detection can revoke the session → random sign-outs.

## 7. Session generation guard (sign-out / account-switch races)

```ts
// src/lib/auth/generation.ts
let gen = 0;
export const sessionGeneration = {
  current: () => gen,
  bump: () => ++gen,
  isCurrent: (g: number) => g === gen,
};

// usage in any async write into caches/stores
const g = sessionGeneration.current();
const data = await api.get('/v1/me/plan');
if (!sessionGeneration.isCurrent(g)) return;          // response belongs to the previous user
queryClient.setQueryData(['plan', userId], data);
```

Also: key every user-scoped query by user id (`['plan', userId]`), and `cancelQueries()` before wiping.

## 8. Sign-out wipe

```ts
export async function signOutEverywhere(opts: { scope?: 'local' | 'global' | 'others'; reason?: string } = {}) {
  const userId = authStore.getState().userId;
  sessionGeneration.bump();
  await queryClient.cancelQueries();
  try { await unregisterPushToken(); } catch {}                       // server-side, while still authenticated
  try { await supabase.auth.signOut({ scope: opts.scope ?? 'local' }); } catch {} // server revoke; never block wipe
  await wipeLocalUserData(userId);
  router.replace('/(auth)/sign-in');
}

export async function wipeLocalUserData(userId: string | null) {
  queryClient.clear();
  if (userId) {
    userMmkv(userId)?.clearAll();                                     // per-user encrypted instance
    for (const k of appMmkv.getAllKeys()) if (k.startsWith(`u:${userId}:`) || /^(coach|client):/.test(k)) appMmkv.remove(k); // role-prefixed snapshots (v4 `remove`, v3 `delete`)
    await SecureStore.deleteItemAsync(`mmkv-key.${userId}`);
  }
  await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]); // private photos are treated like medical records
  await Promise.all(USER_SECURE_KEYS.map((k) => SecureStore.deleteItemAsync(k)));
  resetStores();                                                       // zustand: each slice exposes reset()
}
```

- Scope: `signOut()` defaults to `global` (all devices). Use `local` for a normal "sign out" button, `global` for "sign out everywhere"/after password change.
- Wipe runs even offline or when `signOut` throws.
- If images are public, `clearDiskCache` is optional; if any are private (health/progress/identity photos, documents), clear both caches.

## 9. Token hygiene

Never put access/refresh tokens, invite codes, device-session secrets or signed-URL tokens in: URLs/query strings you build, React Navigation/Expo Router params, query keys, storage keys, logs, analytics events, crash reports, push payloads. Images from private storage: signed URLs minted server-side with short TTL (the token in a signed URL is scoped to one object and expires); never `?access_token=` on image URLs.

## 10. Biometric app lock

`expo-local-authentication` gates the UI over an existing valid session (app lock after N minutes in background) or unlocks a SecureStore item stored with `requireAuthentication: true`. It never replaces server authentication, and a failed/unenrolled biometric falls back to device passcode or full sign-in, not to "skip".

## 11. Device sessions for passwordless / invite flows

For users without email/password (e.g. clients invited by a professional):

1. Inviter creates an invite: server generates a random code (≥128 bits, or short human code + strict rate limit), stores `hmac_sha256(INVITE_PEPPER, code)`, `expires_at` (minutes to hours), `used_at null`. Sends the code/link. Raw code is never stored.
2. App exchanges the invite once (`POST /v1/invites/exchange`, rate-limited by IP + invite id): server recomputes HMAC, compares in constant time, checks expiry and unused, marks used **atomically** (`update … where used_at is null returning`), creates a device session: random 32-byte secret, stores `hmac_sha256(SESSION_PEPPER, secret)`, `revoked_at null`, device label. Returns `sessionId.secret` once.
3. App stores the credential in SecureStore only.
4. Every call sends it in a header; server (or a definer RPC) looks up by id, compares HMAC, checks `revoked_at`, updates `last_used_at`. Optionally exchange it for a short-lived JWT.
5. Revocation from the inviter's UI or the user's "sign out": set `revoked_at`. Client receiving `401 session_revoked` clears the credential and all caches (section 8) and routes to onboarding.
6. Peppers live in server env only; rotating a pepper invalidates all outstanding invites/sessions (plan for a `pepper_version` column).

## 12. Rate limits

Supabase Auth has built-in limits for sign-in, OTP, signup and email sends (configure in dashboard; enable CAPTCHA for signup/OTP if abused). Custom endpoints (invite exchange, device-session creation, OTP verification, password-reset requests through your API) need their own limits keyed by IP + identifier (email hash, invite id), with exponential lockout on repeated failures.

## 13. Account deletion (App Store requirement when sign-up exists)

Server endpoint (never client-only): authenticate → re-verify with `getUser(token)` → delete/anonymize rows (FK cascades or explicit) → delete storage objects under `${userId}/` in every bucket → cancel/flag subscriptions (cannot cancel App Store subscriptions server-side: tell the user) → `auth.admin.deleteUser(userId)` (revokes sessions) → client runs `wipeLocalUserData` and routes to sign-in. Log an audit record without personal data.

## 14. MFA (optional, recommended for admin/professional roles)

`supabase.auth.mfa.enroll({ factorType: 'totp' })` → `challenge` → `verify`. Enforce on sensitive tables/routes with `aal2`: RLS `as restrictive` policy `((select auth.jwt() ->> 'aal') = 'aal2')`, or check `aal` claim in `requireAuth` for admin routes.

## 15. Lifecycle checklist

- [ ] One client, secure storage adapter, PKCE, `detectSessionInUrl: false`, AppState refresh
- [ ] `onAuthStateChange` in root provider drives a store; callback synchronous
- [ ] OAuth/magic link/reset via `exchangeCodeForSession`; callback parser allow-lists scheme/host/path
- [ ] API client: auth header, single-flight refresh, retry once, sign-out on second 401
- [ ] Generation guard on async cache writes; queries keyed by user id
- [ ] Sign-out: revoke, cancel, clear query cache, per-user MMKV + role-prefixed keys, image caches, SecureStore, stores, push token
- [ ] No tokens in URLs/keys/logs/analytics/crash reports
- [ ] Device sessions: single-use short-TTL invites, peppered hashes, revocation, client wipe on revoked
- [ ] Rate limits on every custom auth endpoint
- [ ] Account deletion revokes sessions and deletes storage
