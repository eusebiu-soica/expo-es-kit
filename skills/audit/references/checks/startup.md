# Startup checks (category `startup`)
Scope: everything between process start and the first screen showing real content — splash, fonts, root layout work, storage/SDK init, initial data.

Check ids (`START-Cnn`) are stable references for this file; findings get report ids `START-001…`. Measure with `../measuring.md` §5.

## Signals to start from

| Scan path | Meaning |
|---|---|
| `hits["splash-prevent"]`, `hits["splash-hide"]` | Splash control. Prevent without hide on all paths = stuck splash risk; neither = default auto-hide (possible white flash). |
| `hits["use-fonts"]` | Runtime font loading gate (`useFonts`/`Font.loadAsync`). |
| `config.plugins` | `expo-font` (embedded fonts), `expo-splash-screen` (native splash config), `expo-updates`. |
| `hits["top-level-await-storage"]` | Module-level awaits on storage. |
| `hits["asyncstorage-call"]`, `hits["securestore-call"]`, `hits["mmkv-instance"]` | Storage reads that may sit on the startup path. |
| `hits["query-persist-whole"]` | Whole query cache restored before first render. |
| `hits["sentry-init"]`, `stack.libs["react-native-purchases"]`, analytics libs | SDK inits — check where they run. |
| `hits["lazy-screen"]` | Dynamic imports / lazy screens already in use. |
| `hits["interaction-manager"]` | Deferral mechanism in use. |
| `config.jsEngine` | Hermes expected. |
| `config.updates` | `checkAutomatically`/`fallbackToCacheTimeout` > 0 can block launch on network. |
| `stack.libs["react-native-performance"]`, `["@shopify/react-native-performance"]`, `["expo-insights"]` | Startup measurement already wired. |
| `largestComponents` containing `app/_layout.tsx` | Heavy root layout. |

Files to read first: `app/_layout.tsx` (and `app/(tabs)/_layout.tsx`), `index.ts`/`App.tsx`, providers file, storage init module, auth bootstrap, analytics/purchases init.

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| START-C01 | Splash held until real content | `preventAutoHideAsync()` at module scope; `hideAsync()`/`hide()` called when the first meaningful screen (or its cached data) is laid out, not in a `useEffect` of the root layout before data. | P2 (white/empty flash); P1 if a blank screen > 1 s | Hide in `onLayout` of the first content view once ready flags are true. |
| START-C02 | Splash always hides | Every path (auth error, storage failure, update error, offline) reaches `hideAsync`. Look for `return null` branches before hide. | P0 if a realistic path leaves the app stuck on splash (crash-equivalent); P1 otherwise | `try/finally` around bootstrap; timeout fallback that hides splash and shows an error/retry UI. |
| START-C03 | Fonts embedded, not gated | `useFonts` with `if (!loaded) return null` in root; vs `expo-font` config plugin in `plugins`. | P2 (P1 with many/large fonts) | Embed via `["expo-font", { fonts: ["./assets/fonts/X.ttf"] }]`; remove the runtime gate (rebuild required). |
| START-C04 | Non-critical SDKs deferred | Analytics, purchases, crash-reporting extras, remote config, push registration initialized at module scope/root effect before first content. | P2 (P1 if awaited before render) | Crash reporting early (it must catch startup errors); everything else after first frame via `InteractionManager.runAfterInteractions` or `requestIdleCallback`-like deferral. |
| START-C05 | Storage init bounded | Awaited storage/DB/encryption key init with no timeout before render. | P1 (keystore hiccups can hang startup) | `Promise.race([init(), timeout(400)])` → fall back to ephemeral store and continue. |
| START-C06 | No top-level await / sync heavy work in root | `hits["top-level-await-storage"]`; large JSON parse, migrations, crypto, date-locale loading in module scope of root layout. | P2 (P1 if > ~200 ms measured) | Move into a bounded async bootstrap; parse lazily. |
| START-C07 | Cached data on first frame | First screen shows persisted snapshot immediately (MMKV sync read) vs spinner until network. | P2 (P1 for primary screen with known data) | Read per-family snapshot synchronously as `initialData`/`placeholderData`; refresh in background. |
| START-C08 | ≤ 1 deduped refresh at launch | Count requests fired on cold start: duplicate fetches of the same resource from root + screen + focus effects. | P2 (P1 if 3+ duplicates or waterfall) | Single owner per query family; TanStack Query dedupes by key — remove manual parallel fetches; `Promise.all` the independent ones. |
| START-C09 | Whole-cache restore avoided | `hits["query-persist-whole"]`: `PersistQueryClientProvider` restoring the full cache before rendering children. | P2 (P1 if cache is large/unbounded) | Per-family snapshots (see `caching.md`), high-churn families memory-only. |
| START-C10 | Heavy screens lazy | Rarely used heavy screens/modules (charts, editors, PDF, maps, Skia scenes) imported eagerly by the root/tab layout. | P2 | Layouts and providers evaluate at startup — never import heavy modules from them; load heavy libs on demand with dynamic `import()` or `React.lazy` inside the screen that needs them. |
| START-C11 | Hermes enabled | `config.jsEngine`. | P1 if `jsc` without a documented reason | Remove `jsEngine: "jsc"`. |
| START-C12 | OTA check not blocking | `config.updates.fallbackToCacheTimeout` > 0 or `checkAutomatically: "ON_LOAD"` with sync download expectation. | P2 (P1 if timeout ≥ 5 s) | `fallbackToCacheTimeout: 0`; download in background and apply on next launch or via prompt. |
| START-C13 | Auth bootstrap not serial | `getSession()` → `getUser()` → profile fetch → settings fetch awaited serially before any UI. | P2 (P1 if > 3 serial network calls) | Render from the stored session immediately; validate/refresh in background; parallelize profile + settings. |
| START-C14 | Root providers lean | Root layout mounts many providers with expensive init (theme computation, i18n loading all locales, large stores hydrated). | P2 | Load only the active locale; lazy-hydrate stores; move feature providers down to the routes that need them. |
| START-C15 | Initial route correct without redirect chains | Root redirects (`/` → `/onboarding` → `/(tabs)`) each mounting screens. | P2 | Decide the route from the synchronous session/onboarding flag before mounting; `<Redirect>` once. |
| START-C16 | Startup measured | Custom TTI mark or perf library; documented cold start number on min-spec. | P2 if absent (blocks score > 8) | Add marks per `measuring.md` §5; record in `docs/audits/`. |
| START-C17 | Error boundary around bootstrap | Root `ErrorBoundary` export in `app/_layout.tsx`; startup exceptions handled. | P1 if a thrown bootstrap error leaves a white screen | `export function ErrorBoundary(props)` in root layout with retry. |
| START-C18 | Assets preloaded sensibly | `Asset.loadAsync` of many large images in root gate. | P2 | Preload only what the first screen shows; let expo-image cache the rest. |

## Proven patterns

**Root layout bootstrap**
```tsx
SplashScreen.preventAutoHideAsync();               // module scope

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await withTimeout(initStorage(), 400);       // falls back to ephemeral store
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => { alive = false; };
  }, []);
  if (!ready) return null;                            // splash still visible
  return (
    <Providers>
      <Stack />
    </Providers>
  );
}

// first content screen
<View onLayout={() => SplashScreen.hideAsync()}>…</View>

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) { … }
```

**Bounded init**
```ts
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}
```

**Embedded fonts (app.json)**
```json
{ "expo": { "plugins": [["expo-font", { "fonts": ["./assets/fonts/Inter-Regular.ttf", "./assets/fonts/Inter-SemiBold.ttf"] }]] } }
```

**Deferred SDK init**
```ts
useEffect(() => {
  const task = InteractionManager.runAfterInteractions(() => {
    initAnalytics();
    initPurchases();
  });
  return () => task.cancel();
}, []);
```

**Cached first frame**
```ts
const snapshot = readSnapshot('feed');               // sync MMKV read, shape-validated
useQuery({ queryKey: feedKeys.list(), queryFn: fetchFeed, initialData: snapshot?.data, initialDataUpdatedAt: snapshot?.savedAt });
```

## Not a problem when

- `useFonts` used only for an icon font on a non-root screen, or fonts cached after first launch with negligible measured cost.
- `splash-prevent` without `splash-hide` in the same file — hide may live in the first screen; search the whole repo.
- Crash reporting (`hits["sentry-init"]`) at module scope — it must initialize early.
- `query-persist-whole` with a tiny, bounded cache (few small queries) and measured restore < 50 ms → P2 note only.
- `lazy-screen` absent: only flag it when a heavy module is imported eagerly from a layout/provider or the first screen; plain route files need no manual lazy-loading.
- Await on SecureStore for the session token at launch — needed; flag only if serial with other awaits or unbounded.

## Score anchors

| Band | `startup` looks like |
|---|---|
| 0–2 | Splash can get stuck (P0) or app crashes on storage failure; multiple serial network calls before any UI; cold start > 6 s on min-spec. |
| 3–4 | White flash or blank screen; fonts + SDKs + full cache restore all awaited in root; unbounded storage init; no error boundary. |
| 5–6 | Splash handled; some deferral; fonts gated at runtime; duplicate launch requests; cached data not shown on first frame. |
| 7–8 | Embedded fonts, deferred SDKs, bounded init, cached first frame, ≤ 1 refresh per family; not measured → max 8. |
| 9–10 | All of 7–8 plus measured cold start to content < 2 s on min-spec, TTI marks in place, bootstrap failure paths tested. |
