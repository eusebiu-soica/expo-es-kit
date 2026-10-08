# Mobile platform hardening (PLAT-01..10)

Platform mechanics that decide whether data stays inside the app: input fields, clipboard, screen capture, WebViews, transport, Android manifest surface, backups, device integrity and local encryption. DATA-05/06/08 in `secrets-and-exposure.md` decide *which* data is sensitive; this file covers *how* the platform is configured.
Findings use `category: client-security` with `area: platform`, except PLAT-08 and PLAT-10 which go under `secure-storage`. Baselines: CSEC-07/08/12 in `skills/audit/references/checks/client-security.md`, SEC-01..13 in `skills/audit/references/checks/secure-storage.md`.
Native config lives in `app.json`/`app.config.*` (CNG). To see the generated manifest/Info.plist without writing files use `npx expo config --type introspect`; library manifests merge only at build time (inspect a built APK with Android Studio's APK Analyzer when available).

| ID | Check | Typical severity |
|---|---|---|
| PLAT-01 | Password/OTP inputs: secure entry, autofill hints, no autocorrect/keyboard learning | P2 (P1 if secrets shown in clear) |
| PLAT-02 | Clipboard writes of sensitive values are avoided or expire | P2 (P1 for credentials) |
| PLAT-03 | Screenshot / recording / app-switcher protection on sensitive screens | P2 (P1 regulated) |
| PLAT-04 | WebView hardened (origins, navigation, files, bridge) | P1 |
| PLAT-05 | Transport: ATS on, no Android cleartext in release | P1 |
| PLAT-06 | Certificate pinning only when warranted, with rotation plan | P2 (optional) |
| PLAT-07 | Android exported components, intent filters and permissions minimal | P1 (P2 hygiene) |
| PLAT-08 | Backup configuration matches data sensitivity | P2 (P1 sensitive data) |
| PLAT-09 | Root/jailbreak and app attestation used as signals, not authentication | P2 (P1 finance/health/abuse-prone) |
| PLAT-10 | Local databases and files encrypted when they hold personal data | P1 |

---

### PLAT-01 · Password and OTP inputs
**Severity guide:** P1 when a password/PIN/recovery-code field lacks `secureTextEntry` (shoulder surfing, screen recording) or when a credential field has `autoCorrect`/suggestions on (keyboard dictionaries learn it) · P2 when autofill hints are missing (users pick weaker passwords without password managers) or OTP fields lack `one-time-code`.
**Signals:** `password-input-not-secure`; grep `<TextInput` / UI-kit input components with `password|pin|otp|code|secret` in `name`/`placeholder`/`label`.
**How to verify:**
1. Find the shared input component first (design-system `PasswordField`, HeroUI input wrappers); props set there apply everywhere.
2. Password: `secureTextEntry`, `autoCapitalize="none"`, `autoCorrect={false}`, `autoComplete` (`current-password` / `new-password`, both cross-platform), `textContentType` (`password` / `newPassword`, iOS). Note `secureTextEntry` does not work with `multiline`, and on Android not with `keyboardType="email-address"`/`"phone-pad"`.
3. OTP: `autoComplete="one-time-code"` (iOS) / `"sms-otp"` (Android) via `Platform.select`, `textContentType="oneTimeCode"`, `keyboardType="number-pad"`; no `secureTextEntry` needed for single-use codes.
4. "Show password" toggles: default hidden; check the toggle does not keep the field unsecured after leaving the screen.
**Not a problem when:** a custom PIN pad that never uses the system keyboard; email/username fields with autofill hints but no `secureTextEntry`.
**Fix:**
```tsx
<TextInput
  secureTextEntry={!visible}
  autoCapitalize="none"
  autoCorrect={false}
  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
  textContentType={mode === 'signup' ? 'newPassword' : 'password'}
/>
<TextInput
  keyboardType="number-pad"
  autoComplete={Platform.select({ ios: 'one-time-code', android: 'sms-otp', default: 'one-time-code' })}
  textContentType="oneTimeCode"
  maxLength={6}
/>
```

### PLAT-02 · Clipboard writes of sensitive values
**Severity guide:** P1 when passwords, tokens, API keys, recovery codes or full card numbers are copied programmatically · P2 for other personal data. Which values count: DATA-05.
**Signals:** `clipboard-sensitive`; grep `expo-clipboard` `setStringAsync`, `@react-native-clipboard/clipboard`.
**How to verify:**
1. List every clipboard write and the value source.
2. Platform facts: the general pasteboard is readable by the foreground app (iOS shows a paste banner, Android 12+ a toast, Android 13+ a preview overlay); iOS Universal Clipboard syncs to the user's other devices; clipboard managers on Android keep history.
3. `expo-clipboard` `setStringAsync(text, { inputFormat })` has no "sensitive", "local only" or expiration option; Android's `ClipDescription.EXTRA_IS_SENSITIVE` (hides the preview) or iOS `localOnly`/`expirationDate` need a small native module.
**Not a problem when:** user-initiated copy of shareable values (referral link, order number).
**Fix:** avoid copying secrets (reveal-on-tap instead). If unavoidable, clear after a timeout only if the clipboard still holds your value:
```ts
await Clipboard.setStringAsync(code);
setTimeout(async () => { if ((await Clipboard.getStringAsync()) === code) await Clipboard.setStringAsync(''); }, 60_000);
```

### PLAT-03 · Screenshot, recording and app-switcher protection
**Severity guide:** P1 for finance/health/identity screens when policy or regulation requires it, or for screens showing recovery codes/full card numbers · P2 otherwise. Which screens: DATA-06.
**Signals:** grep `expo-screen-capture`: `usePreventScreenCapture`, `preventScreenCaptureAsync`, `enableAppSwitcherProtectionAsync`, `addScreenshotListener`.
**How to verify:**
1. List sensitive screens; check each mounts `usePreventScreenCapture(key)` (distinct keys if several screens can be stacked; `allowScreenCaptureAsync(key)` must match).
2. Android: prevention sets `FLAG_SECURE`, which also blanks the Recents thumbnail. iOS: prevention blocks recordings and screenshots on recent iOS versions, but the app-switcher snapshot needs `enableAppSwitcherProtectionAsync(blurIntensity)` (iOS only), which blurs when the app goes to background/inactive.
3. `addScreenshotListener` only detects; it is not protection (and on older Android needs media permissions — avoid adding permissions for it).
**Not a problem when:** content is not sensitive or the feature intentionally supports screenshots (receipts) and the product documents it.
**Fix:**
```tsx
import * as ScreenCapture from 'expo-screen-capture';
export function RecoveryCodesScreen() {
  ScreenCapture.usePreventScreenCapture('recovery-codes');
  return <Codes />;
}
// app root, regulated apps (iOS app-switcher blur)
useEffect(() => { ScreenCapture.enableAppSwitcherProtectionAsync(0.8); return () => { ScreenCapture.disableAppSwitcherProtectionAsync(); }; }, []);
```

### PLAT-04 · WebView hardened
**Severity guide:** P1 when a WebView loads remote or user-influenced content and has a bridge (`onMessage`, `injectedJavaScript*`, `injectedJavaScriptObject`), passes tokens into the page, enables file access, or navigates anywhere · P2 for bundled static HTML with minor gaps.
**Signals:** `webview-usage`, `webview-risky`, `webview-onmessage-no-origin`, `webview-html-interpolation`.
**How to verify:** for each `<WebView>`:
1. `source`: bundled HTML, first-party https URL, or user/remote-controlled? Remote/user-controlled raises everything below to P1.
2. `originWhitelist`: default allows `http://*`/`https://*`; restrict to your origin(s). `['*']` is required only for `source={{ html }}` — then navigation must be blocked with `onShouldStartLoadWithRequest`.
3. `onShouldStartLoadWithRequest`: allow-lists host + https; external links go to the system browser. Note: on Android it is not called for the first load, so validate `source.uri` yourself.
4. File access: `allowFileAccess` (Android, default false), `allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs` (both default false) must stay false; `allowingReadAccessToURL` (iOS) scoped to a dedicated folder.
5. `mixedContentMode` stays `never`; `webviewDebuggingEnabled` only in `__DEV__`; `setSupportMultipleWindows` not set to `false` (documented iframe escape risk); `javaScriptEnabled={false}` when the page needs no JS.
6. Bridge: `onMessage` must check `event.nativeEvent.url` origin and parse `event.nativeEvent.data` with a schema; never `eval`/navigate/`Linking.openURL` from message content.
7. `injectedJavaScript` / `source.html` built with template literals from data (`webview-html-interpolation`) = XSS into a privileged context; never inject access tokens or session JSON.
8. Cookies: `sharedCookiesEnabled`/`thirdPartyCookiesEnabled` only when required; `incognito` for one-off untrusted content.
**Not a problem when:** static bundled HTML with no bridge and navigation blocked; a first-party page loaded over https with origin-checked, schema-validated messages.
**Fix:**
```tsx
const ORIGIN = 'https://help.example.com';
<WebView
  source={{ uri: `${ORIGIN}/faq` }}
  originWhitelist={[ORIGIN]}
  onShouldStartLoadWithRequest={(r) => {
    if (r.url.startsWith(`${ORIGIN}/`)) return true;
    if (r.url.startsWith('https://')) Linking.openURL(r.url);
    return false;
  }}
  onMessage={(e) => {
    if (!e.nativeEvent.url.startsWith(`${ORIGIN}/`)) return;
    const msg = BridgeMessage.safeParse(safeJson(e.nativeEvent.data));
    if (msg.success) handle(msg.data);
  }}
  webviewDebuggingEnabled={__DEV__}
/>
```
Pass data into HTML with `JSON.stringify` + escaping of `<`, or via `postMessage` after load — never string interpolation.

### PLAT-05 · Transport: ATS on, no Android cleartext in release
**Severity guide:** P1 when release builds allow arbitrary loads (`NSAllowsArbitraryLoads: true`), Android `usesCleartextTraffic: true`, or API/auth endpoints use `http://` · P2 when exceptions exist for a third-party domain with a documented reason.
**Signals:** `config.ios.nsAllowsArbitraryLoads`, `config.android.usesCleartextTraffic`, `http-cleartext`; read `ios.infoPlist.NSAppTransportSecurity`, `expo-build-properties` options, custom network-security-config plugins.
**How to verify:**
1. Read `app.config.*`: is the cleartext/ATS setting conditional on a dev profile (`process.env.APP_VARIANT === 'development'`)? Unconditional = applies to production.
2. Android: since API 28, cleartext is blocked by default; Expo's debug manifest allows it only for debug builds. Check `expo-build-properties` `android.usesCleartextTraffic` and any plugin adding `network_security_config.xml` (look for `cleartextTrafficPermitted="true"` and `<certificates src="user"/>` outside `debug-overrides`).
3. iOS: `NSExceptionDomains` entries — each should be a specific host with `NSExceptionAllowsInsecureHTTPLoads` justified.
**Not a problem when:** `http://localhost`/`10.0.2.2`/LAN IPs in development builds only; `NSAllowsLocalNetworking`.
**Fix:** `https://` everywhere; scope dev exceptions per variant:
```ts
plugins: [['expo-build-properties', { android: { usesCleartextTraffic: IS_DEV } }]],
ios: { infoPlist: IS_DEV ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {} },
```

### PLAT-06 · Certificate pinning only when warranted
**Severity guide:** P2 informational by default (TLS + ATS + server-side authz are the primary controls). Raise to P1 only for high-risk domains (banking/payments/health with a documented threat model or regulator requirement) where pinning is absent. Report misconfigured pinning (single pin, no backup, leaf-pinned to a provider-managed cert) as P1 — it is an outage risk.
**Signals:** `stack.libs` (`react-native-ssl-public-key-pinning`, TrustKit), `ios.infoPlist.NSPinnedDomains`, network security config `<pin-set>`.
**How to verify:**
1. Is pinning present? Which hosts? Pinning `*.supabase.co`, `*.vercel.app` or other provider-managed certificates breaks when the provider rotates its chain — only pin domains whose keys you control.
2. Pins are SPKI hashes with at least one backup key; Android `<pin-set expiration>` set; a kill switch exists (remote config or pins delivered via OTA-updatable JS config).
3. Does pinning cover only API calls you own, not third-party SDK endpoints?
**Not a problem when:** no pinning in a consumer app without a specific threat model.
**Fix (if warranted):** `react-native-ssl-public-key-pinning` (works with dev builds/CNG) with primary + backup SPKI hashes; or native `NSPinnedDomains` (iOS 14+) and Android `<pin-set>` via a config plugin. Document rotation: add the new key's pin one release before switching certificates.
```ts
import { initializeSslPinning } from 'react-native-ssl-public-key-pinning';
await initializeSslPinning({ 'api.example.com': { includeSubdomains: false, publicKeyHashes: [PRIMARY_SPKI, BACKUP_SPKI] } });
```

### PLAT-07 · Android exported components, intent filters and permissions minimal
**Severity guide:** P1 when an exported activity/service/receiver/provider performs privileged actions without permission checks, a `FileProvider` exposes broad paths, or intent filters capture `https` links for hosts you do not verify · P2 for unused dangerous permissions or broad `<data>` filters.
**Signals:** `config.android.intentFilters`, `config.android.permissions`, `config.scheme`; `plugins` array in app config (each may add manifest entries).
**How to verify:**
1. `npx expo config --type introspect` and read the `AndroidManifest` mod result: every `activity`/`service`/`receiver`/`provider` with `android:exported="true"`. Since Android 12 (targetSdk 31+) any component with an intent filter must declare `android:exported` explicitly; config plugins that omit it break the build, plugins that set `true` widen the surface.
2. For each exported component from a third-party plugin: is the author known, and does it need to be exported (push receivers, auth redirect activities usually are by design)?
3. Intent filters: `autoVerify` https filters limited to your hosts and path prefixes; no catch-all `scheme: 'https'` without host; custom scheme unique to the app.
4. Permissions: compare `config.android.permissions` with features; remove `READ_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`, `READ_PHONE_STATE`, location-in-background etc. when unused (`android.blockedPermissions` strips ones added by libraries).
**Not a problem when:** the launcher `MainActivity` (must be exported), library-standard push/redirect receivers, `expo-auth-session` redirect activity.
**Fix:** remove unneeded plugins; `android.blockedPermissions: ['android.permission.READ_PHONE_STATE']`; narrow intent filters (URL-06); for custom native code, `exported="false"` unless another app must call it, and protect with `android:permission` when it must.

### PLAT-08 · Backup configuration matches data sensitivity
**Severity guide:** P1 when plaintext personal data (AsyncStorage, unencrypted MMKV/SQLite, documents) is included in Android Auto Backup / device transfer or iOS iCloud/Finder backups · P2 when backup rules are default but only non-sensitive data is stored. Report under `secure-storage` (SEC-12); data classification in DATA-08.
**Signals:** `config.android.allowBackup`; secure-storage hits; `stack.libs` (`expo-secure-store` config plugin options).
**How to verify:**
1. Android: `android.allowBackup` defaults to true (Auto Backup to Google Drive + device-to-device transfer). `expo-secure-store`'s plugin option `configureAndroidBackup` (default true) adds rules excluding SecureStore data; custom backup rules must keep that exclusion (`data-extraction-rules` for Android 12+, `full-backup-content` for 11 and lower).
2. iOS: `Documents/` and `Library/Application Support/` are backed up; `Library/Caches` and `tmp` are not (but can be purged). Keychain items with `*_THIS_DEVICE_ONLY` do not migrate to a new device.
3. List where sensitive data is written (`documentDirectory`/`Paths.document`, SQLite files, MMKV default dir).
**Not a problem when:** sensitive stores are encrypted with a key in SecureStore/Keychain (restored ciphertext is unreadable), or the data is safe to restore.
**Fix:** encrypt (PLAT-10) — preferred, keeps backups useful; or `"android": { "allowBackup": false }`; or a config plugin with explicit `dataExtractionRules`/`fullBackupContent` excluding sensitive files (and SecureStore, with `configureAndroidBackup: false`). iOS: no first-party Expo API sets `NSURLIsExcludedFromBackupKey` at the time of writing (check the installed `expo-file-system`); keep sensitive files encrypted, or set the flag on a dedicated directory via a small native module.

### PLAT-09 · Root/jailbreak and app attestation as signals, not authentication
**Severity guide:** P2 informational for most apps. P1 for finance/health apps or abuse-prone flows (sign-up bonuses, free trials, SMS/AI cost endpoints) with no attestation or abuse controls at all. Report as P1 if the app treats a client-side "device is safe" boolean as authorization.
**Signals:** `stack.libs` (`@expo/app-integrity`, `@react-native-firebase/app-check`, `jail-monkey`, `react-native-device-info`); grep `isJailBroken`, `isRooted`, `attest`, `integrity`.
**How to verify:**
1. If root/jailbreak checks exist: are they only UX warnings / telemetry? Client checks are bypassable (Frida, Magisk hide); never gate security on them alone.
2. If attestation exists: is the token verified **server-side** (Play Integrity verdict decrypted by Google or your server; App Attest attestation + assertion verified with Apple's steps; App Check token verified in the API/Edge Function) and bound to a server challenge/nonce?
3. Which endpoints require it? Attestation belongs on abuse-prone flows, not every request.
**Not a problem when:** a low-risk consumer app without attestation, with server-side rate limits (HARD-01) and business-flow limits.
**Fix:** `@expo/app-integrity` (Play Integrity Standard requests + App Attest; alpha — pin the version and read the SDK-specific docs) or Firebase App Check; verify server-side; fail open with monitoring at first, then enforce. Keep root detection as a warning/telemetry signal.

### PLAT-10 · Local databases and files encrypted when they hold personal data
**Severity guide:** P1 when SQLite databases, MMKV instances or files with personal/health/financial data are plaintext, or the encryption key is hard-coded · P2 for low-sensitivity caches. Report under `secure-storage`; this extends SEC-04, SEC-08, SEC-13 (do not double-report).
**Signals:** `sqlite-usage`, `mmkv-instance`, `mmkv-encryption`, `query-persist-whole`; grep `FileSystem.documentDirectory`, `Paths.document`, `new File(`, `writeAsStringAsync`.
**How to verify:**
1. SQLite: `expo-sqlite` plugin `["expo-sqlite", { "useSQLCipher": true }]` and `PRAGMA key` run right after `openDatabaseAsync`, with the key from SecureStore (not a literal, not `EXPO_PUBLIC_*`). SQLCipher is not available in Expo Go.
2. MMKV: `encryptionKey` from SecureStore (secure-storage proven pattern).
3. Files: sensitive downloads/exports under a per-user directory, deleted on sign-out (AUTH-08), not saved to the media library automatically.
**Not a problem when:** the store holds only public catalog/offline content.
**Fix:**
```ts
const db = await SQLite.openDatabaseAsync(`user-${userId}.db`);
const key = await getOrCreateDbKey(userId); // random 32 bytes (hex) in SecureStore
await db.execAsync(`PRAGMA key = "x'${key}'"`); // raw hex key, no passphrase derivation
```
See `skills/audit/references/checks/secure-storage.md` for the key-in-SecureStore patterns.
