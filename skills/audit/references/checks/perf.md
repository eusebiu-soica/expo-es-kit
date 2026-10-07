# Performance checks (category `perf`)
Scope: runtime render cost, lists, images, animations, navigation transitions and data work on the JS thread.

Check ids (`PERF-Cnn`) are stable references for this file; findings get report ids `PERF-001…` per the contract. On-device confirmation: `../measuring.md`.

## Signals to start from

| Scan path | Meaning |
|---|---|
| `config.reactCompiler` | `true` → compiler memoizes components; manual memo is mostly redundant. `false`/`null` → manual memo discipline is mandatory (PERF-C01). |
| `config.babel.reanimatedOrWorkletsPluginLast` | `false` → worklets plugin not last (PERF-C03). `null` → plugin not listed (fine if babel-preset-expo handles it). |
| `stack.libs` | `react-native-reanimated`, `react-native-worklets`, `@shopify/flash-list`, `@legendapp/list`, `expo-image`, `react-native-fast-image`, `@gorhom/bottom-sheet`, `heroui-native`, `@shopify/react-native-skia`. |
| `largestComponents` | Files to read first for render cost (not a finding by itself). |
| `hits["scrollview-map"]`, `hits["scrollview"]` | Unbounded content in a ScrollView — check data size. |
| `hits["flatlist"]`, `hits["flashlist"]`, `hits["legendlist"]`, `hits["sectionlist"]` | List inventory. |
| `hits["flatlist-no-keyextractor"]`, `hits["key-index"]`, `hits["get-item-layout"]`, `hits["remove-clipped"]` | List config quality. |
| `hits["list-item-not-memo"]` | `renderItem` in a file with no `memo(` — check whether the row component is memoized elsewhere. |
| `hits["inline-style"]`, `hits["inline-handler"]` | Only matter on memoized children / list rows when compiler is off. |
| `hits["memo"]`, `hits["use-callback"]`, `hits["use-memo"]` | Discipline level; very high counts with compiler on = redundant noise. |
| `hits["context-value-inline"]` | Provider `value={{…}}` re-renders every consumer. |
| `hits["use-ref-eager"]` | `useRef(expensive())` runs every render. |
| `hits["find-in-loop"]`, `hits["json-parse-render"]` | O(n²) or repeated parse in render. |
| `hits["rn-image-import"]`, `hits["fast-image"]`, `hits["expo-image-import"]`, `hits["expo-image-no-cache-policy"]`, `hits["expo-image-cache-policy"]`, `hits["expo-image-recycling"]` | Image pipeline. |
| `hits["reanimated-usage"]`, `hits["animated-layout-prop"]`, `hits["old-animated"]`, `hits["use-native-driver-false"]`, `hits["run-on-js"]`, `hits["reduced-motion"]` | Animation quality. |
| `hits["with-alpha"]` | Translucent colours — overdraw suspects (PERF-C09). |
| `hits["freeze-on-blur"]` | Explicit freezing of inactive screens. |
| `hits["promise-all"]` | Parallel requests present; absence + sequential awaits = waterfall. |
| `hits["perf-log-not-dev"]` | Profiling/logging not gated by `__DEV__`. |
| `hits["heroui-bottom-sheet"]`, `hits["heroui-skeleton"]` | Sheet mounting and skeleton wrapper cost. |
| `hits["interaction-manager"]`, `hits["deferred-value"]` | Deferral already used. |

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| PERF-C01 | Memo strategy matches compiler setting | `config.reactCompiler`. If off: read top list rows/heavy children; are they `memo`'d, and do parents pass stable props (no inline objects/arrows/`style={{}}`)? If on: look for `'use no memo'` and redundant manual memo. | P1 (compiler off, rows/heavy children unstable on hot screens); P2 otherwise | Compiler off → `memo` rows, `useCallback` handlers, `useMemo` derived data, hoist constant styles. Compiler on → remove redundant memo, keep only where profiling proved it. |
| PERF-C02 | Compiler vs Reanimated conflict handled | If compiler on + Reanimated: worklet callbacks, shared values read in render, `useAnimatedStyle` closures — any compiler bailouts or broken animations reported in code comments/issues? | P2 (P1 if animations visibly broken) | Opt out the affected component with `'use no memo'`, or keep compiler off and apply PERF-C01 discipline. |
| PERF-C03 | Worklets/Reanimated babel plugin last | `babel.config.js`; `config.babel.reanimatedOrWorkletsPluginLast`. | P1 (worklets can silently break) | Move `react-native-worklets/plugin` (Reanimated 4) or `react-native-reanimated/plugin` (v3) to the end of `plugins`. |
| PERF-C04 | Unbounded content virtualized | `hits["scrollview-map"]`: is the mapped array bounded (≤ ~30 small items) or user-data driven (feeds, history, search)? | P1 (unbounded); none if bounded | `FlatList` with `keyExtractor`, stable `renderItem`, `getItemLayout` for fixed rows; or FlashList v2 / LegendList. Measure (see Not a problem). |
| PERF-C05 | List configuration | Each list: `keyExtractor` stable id (not index), `extraData` stable/minimal, `renderItem` stable, row memoized, no anonymous components inside `renderItem`. | P2 (P1 on the main feed) | See proven pattern "List row". |
| PERF-C06 | Image component and cache | Remote images through RN `Image` (`hits["rn-image-import"]`) or expo-image without `cachePolicy` (default is `disk`, no memory reuse). | P1 for feeds/avatars lists; P2 elsewhere | `expo-image` with `cachePolicy="memory-disk"`, `transition` small, `placeholder` (blurhash/thumbhash). |
| PERF-C07 | Recycling in lists | expo-image inside list rows with `key=` changes or no `recyclingKey`. | P2 (P1 if flicker/wrong image reported) | `recyclingKey={item.id}`; don't remount via `key=`. |
| PERF-C08 | Thumbnails use resized URLs | Grid/list images: is the URL an original upload or a transformed/resized preview? Check storage helpers (`getPublicUrl`, `createSignedUrl` options, CDN params). | P1 (decoded originals = huge GPU memory; seen ~700 MB) | Request transformed previews (width/quality params) for lists; originals only full-screen. Compress + strip metadata before upload (`expo-image-manipulator`). |
| PERF-C09 | Overdraw from translucent colours | `hits["with-alpha"]`: `rgba(...)`, `withAlpha()`, `bg-x/50` over a known solid background (cards, rows, sheets). | P2 (P1 if on list rows and measured overdraw ≥ 3×) | Pre-flatten to opaque hex computed against the known background; keep alpha only over images, gradients, blur, video. |
| PERF-C10 | Only the active bottom sheet is mounted | Count sheet components rendered at screen/root level; do closed sheets stay mounted (`hits["heroui-bottom-sheet"]`, `@gorhom/bottom-sheet` instances)? | P1 if many heavy sheets mounted per screen; P2 otherwise | Single sheet host + registry; render content only for the open sheet; unmount on close. |
| PERF-C11 | Skeleton wrapper bypassed once loaded | Skeleton components wrapping real content permanently (`<Skeleton isLoaded>` around rows). | P2 (P1 in lists; measured p95 65→42 ms after bypass) | `if (loaded) return children;` before rendering the skeleton wrapper. |
| PERF-C12 | `useRef(expensive())` | `hits["use-ref-eager"]`. | P2 | Lazy init: `const r = useRef<T>(null); if (r.current === null) r.current = create();` or `useState(() => create())[0]`. |
| PERF-C13 | No side effects in render body | Cache reads that write (`getOrCreate`, storage `set`, `queryClient.setQueryData`, analytics) called during render. | P2 (P1 if it triggers re-render loops) | Move into `useEffect`/event handlers; render must be pure. |
| PERF-C14 | Loop invariants hoisted, no O(n²) | `hits["find-in-loop"]`; read filters/selectors on large arrays: date ranges, regex, `new Date()`, `toLowerCase()` recomputed per item; `.find()` inside `.map()`. | P1 if on keystroke/scroll paths with large data; P2 otherwise | Hoist invariants outside the loop; build a `Map` by id once (`useMemo`) and look up O(1). |
| PERF-C15 | Derived data computed once | Same array sorted/normalized/filtered twice per render, or in both parent and child; `JSON.parse` in render (`hits["json-parse-render"]`). | P2 | One `useMemo` (or selector) with correct deps; parse at the data boundary. |
| PERF-C16 | Independent requests parallel | Sequential `await a(); await b();` where b doesn't depend on a (loaders, screen init). | P2 (P1 on screen entry with 3+ calls) | `const [a, b] = await Promise.all([...])`; or parallel `useQuery`s. |
| PERF-C17 | Inactive screens frozen | Nested stacks/tabs: `freezeOnBlur` explicitly set in `screenOptions`; `contentStyle` background set (avoids white flash and transparent overdraw). | P2 | `screenOptions={{ freezeOnBlur: true, contentStyle: { backgroundColor: bg } }}` on each nested navigator. |
| PERF-C18 | Navigation transitions not contended | Mount animations, path morphs, chart animations, heavy effects starting during a push/modal transition. | P2 (P1 if transition visibly drops frames) | Defer until transition end (`navigation.addListener('transitionEnd')`, `InteractionManager.runAfterInteractions`); charts `animated={false}` on mount. |
| PERF-C19 | Animate only transform/opacity on UI thread | `hits["animated-layout-prop"]` (width/height/top/margin in `useAnimatedStyle`), `hits["old-animated"]`, `hits["use-native-driver-false"]`. | P2 (P1 for continuous/scroll-linked animations) | Translate/scale/opacity; Reanimated layout animations for size changes; `useNativeDriver: true` for legacy Animated. |
| PERF-C20 | Reduced motion respected | `hits["reduced-motion"]` absent while many animations exist. | P2 | `useReducedMotion()` (Reanimated) or `AccessibilityInfo.isReduceMotionEnabled()`; shorten/skip animations. |
| PERF-C21 | Context values stable | `hits["context-value-inline"]`; providers near root with frequently changing values (auth + theme + data in one context). | P1 if root provider re-renders whole tree on frequent updates; P2 otherwise | `useMemo` the value; split contexts by update frequency; use selectors (zustand/jotai) for high-churn state. |
| PERF-C22 | Perf tooling only in dev | `hits["perf-log-not-dev"]`, `<Profiler>` in production tree, timing logs. | P2 | Gate with `__DEV__` or a debug flag; remove from release. |
| PERF-C23 | Timers/listeners cleaned up | `setInterval`, `AppState`/`Keyboard`/`NetInfo`/`Dimensions` listeners, subscriptions without cleanup in effects. | P1 if repeated visits leak (memory grows) | Return cleanup from `useEffect`; `subscription.remove()`. |
| PERF-C24 | Heavy screens split | A single screen in `largestComponents` rendering many independent sections with shared state causing full re-render on any change. | P2 (P1 if measured) | Split into subroutes or isolated memoized sections with local state; lazy sections below the fold. |
| PERF-C25 | Typing/search inputs | Filtering large lists on every keystroke synchronously. | P2 (P1 with jank) | `useDeferredValue` / debounce; precomputed index; PERF-C14. |

## Proven patterns

**Compiler off — stable props to memoized rows**
```tsx
const Row = memo(function Row({ item, onPress }: { item: Note; onPress: (id: string) => void }) {
  return <Pressable onPress={() => onPress(item.id)} style={styles.row}>…</Pressable>;
});
const onPress = useCallback((id: string) => router.push(`/notes/${id}`), [router]);
const renderItem = useCallback(({ item }: { item: Note }) => <Row item={item} onPress={onPress} />, [onPress]);
<FlatList data={notes} keyExtractor={keyById} renderItem={renderItem} getItemLayout={ROW_LAYOUT} />;
// Don't: <Row style={{ margin: 8 }} onPress={() => …} />  — new object/fn each render breaks memo.
```

**Worklets plugin last**
```js
module.exports = { presets: ['babel-preset-expo'], plugins: ['module-resolver', 'react-native-worklets/plugin'] };
```

**Overdraw: flatten known-background translucency**
```ts
// card bg is #FFFFFF; "primary at 12%" over white:
const CHIP_BG = '#E6F0FF';           // precomputed opaque
// keep rgba/withAlpha only over images/gradients/blur
```

**Single sheet host**
```tsx
const SHEETS = { filters: FiltersSheet, share: ShareSheet } as const;
export function SheetHost() {
  const open = useSheetStore((s) => s.open);           // 'filters' | 'share' | null
  if (!open) return null;
  const Sheet = SHEETS[open];
  return <BottomSheet onClose={closeSheet}><Sheet /></BottomSheet>;
}
```

**Skeleton bypass**
```tsx
function Loadable({ loaded, children }: Props) {
  if (loaded) return children;           // no wrapper cost once data is there
  return <Skeleton>{children}</Skeleton>;
}
```

**Lazy ref and O(1) lookups**
```ts
const parser = useRef<Parser | null>(null);
if (parser.current === null) parser.current = createParser();

const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
const rows = useMemo(() => {
  const { start, end } = rangeFor(filter);          // hoisted: once, not per record
  return records.filter((r) => r.at >= start && r.at < end).map((r) => ({ ...r, user: byId.get(r.userId) }));
}, [records, filter, byId]);
```

**Images**
```tsx
<Image
  source={{ uri: thumbUrl(item.path, { width: 256 }) }}   // resized preview, never the original
  cachePolicy="memory-disk"
  recyclingKey={item.id}
  placeholder={{ blurhash: item.blurhash }}
  transition={150}
  style={styles.thumb}
/>
```

**Nested stack**
```tsx
<Stack screenOptions={{ freezeOnBlur: true, contentStyle: { backgroundColor: colors.background } }} />
```

**Transition-safe charts/animations**
```tsx
const [ready, setReady] = useState(false);
useEffect(() => navigation.addListener('transitionEnd', () => setReady(true)), [navigation]);
<Chart data={data} animated={ready} />   // animated={false} while the push transition runs
```

## Not a problem when

- `inline-style` / `inline-handler` hits on non-memoized leaf components, or anywhere with React Compiler on.
- `scrollview-map` over a bounded, small array (settings rows, ≤ ~30 static items, form sections).
- FlatList without `getItemLayout` for variable-height rows (it's optional; don't fake heights).
- Missing FlashList: FlatList is fine when measured smooth. On dense mixed-content screens, FlashList and `removeClippedSubviews` have caused regressions — never recommend a swap without measurement.
- `large-component` / `largestComponents`: file length is not a perf problem; only report concrete render-cost issues inside.
- `with-alpha` over images, gradients, blur views, or in non-repeated chrome.
- `rn-image-import` for local static assets (`require('./icon.png')`) — still prefer expo-image but P2 at most.
- `memo` counts high with compiler off — that's discipline, not noise.
- `perf-log-not-dev` where the file itself is dev-only (a debug screen behind `__DEV__` routing).

## Score anchors

| Band | `perf` looks like |
|---|---|
| 0–2 | Main feeds unvirtualized with remote originals via RN Image; whole-tree re-render on every keystroke; animations drive layout on JS thread; visible jank everywhere. |
| 3–4 | One or two of the above on primary screens; memo absent with compiler off; all sheets mounted; thumbnails decode originals (GPU memory spikes). |
| 5–6 | Lists virtualized but rows unstable; images cached but not resized or recycled; overdraw and transition contention unaddressed; some O(n²) work on input. |
| 7–8 | Hot paths correct (virtualized, stable rows, resized cached images, transform/opacity animations, single sheet host); only P2 hygiene left; no measurement yet → max 8. |
| 9–10 | All of 7–8 plus measured on min-spec (p95 documented, no sustained >16.7 ms frames), overdraw flattened, transitions clean, reduced motion respected, perf tooling dev-only. |
