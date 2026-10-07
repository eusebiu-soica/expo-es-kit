# HeroUI Native — performance

Scope: apps that use `heroui-native` (v1.x, Uniwind / Tailwind CSS v4, Reanimated v4, `@gorhom/bottom-sheet` v5).
Verified against the `heroui-native@1.0.x` package source and heroui.com/docs/native. Where a claim
depends on a version you cannot see, re-check it in the installed `node_modules/heroui-native/src`.

Scan hits that feed this file: `heroui-root-import`, `heroui-import`, `heroui-bottom-sheet`,
`heroui-skeleton`, `with-alpha`, `inline-style`, plus the shared perf hits (`memo`, `use-callback`,
`list-item-not-memo`, `context-value-inline`, `scrollview-map`).

## 1. Import strategy

The package ships one entry point per component in `package.json#exports`:
`heroui-native/button`, `/card`, `/bottom-sheet`, `/skeleton`, `/skeleton-group`, `/pressable-feedback`,
`/dialog`, `/spinner`, `/toast`, `/text-field`, … plus utility entries:

| Entry | Contains |
|---|---|
| `heroui-native/provider` | `HeroUINativeProvider` (animation settings, text config, `ToastProvider`, `PortalHost`) |
| `heroui-native/provider-raw` | Lightweight provider without Toast / PortalHost |
| `heroui-native/hooks` | `useThemeColor`, `useBottomSheetAwareHandlers`, `useIsOnSurface` |
| `heroui-native/utils` | `cn`, `colorKit` |
| `heroui-native/portal`, `/contexts`, `/styles` (CSS) | Infrastructure |

Rules:
- Import granularly everywhere. The official docs state that a single root import
  (`from "heroui-native"`) defeats the optimization for the whole bundle, because the root `index`
  re-exports every component (and their animation / SVG / gradient code).
- The provider can be imported from `heroui-native/provider`. A root import of `HeroUINativeProvider`
  in the app root layout is tolerated (the `heroui-root-import` rule exempts it) but `/provider` is better.
- One import style per file. When touching a mixed file, normalize the whole file to granular.
- Docs and component `.md` files inside the package still show `import { X } from 'heroui-native'`.
  Do not copy those imports verbatim.

Audit: count `heroui-root-import` hits. 0 = good; any hit outside the root layout = P2 (bundle + module init).

## 2. Bottom sheets: mount only the active one

What goes wrong: a screen that declares 5–7 `<BottomSheet>` trees (each with `Portal` / `Overlay` /
`Content` and a body) pays for all of them on every render and on mount, even though at most one is
visible. In production this was the single largest render cost on detail/profile screens.

Fix (proven): **one sheet host + registry + `useSheets().open(key, props)`**.
- Sheet bodies are plain components (`*SheetContent`) that receive props plus `onRequestClose`.
- A registry maps `key → { Content, config }` (snap points, dynamic sizing, keyboard behavior).
- One `<SheetHost />` per navigator group renders a single `BottomSheet` whose body is the active entry.
  When closed, no body is mounted.
- Split the context into **actions** (stable `open/update/close`) and **state** (`activeKey`, `props`).
  Screens only consume actions, so opening a sheet does not re-render every screen that can open one.
- Template: `skills/heroui/templates/sheet-host.tsx`.

Audit signals: `heroui-bottom-sheet` hits spread across many screen files (≥ 3 files or ≥ 3 roots in one
file) and no host/registry module = P1 on sheet-heavy screens, P2 otherwise.
Verification: React DevTools — closed sheet bodies must be absent from the tree.

Related rules:
- Body content > ~50 rows: use `BottomSheetFlatList` (or `BottomSheetFlashList` if installed) from
  `@gorhom/bottom-sheet` with fixed snap points. `.map()` inside `BottomSheetScrollView` is acceptable
  only for short, bounded lists. Interim mitigation: memoized rows + `useDeferredValue` on the filter input.
- Registry modules that statically import 40+ sheet bodies cost module-evaluation time at startup.
  If startup matters, register lazily (`get Content() { return require("./x").XSheetContent; }`) — measure first.

## 3. Skeleton bypass after loading

`Skeleton` from `heroui-native/skeleton` is not free when `isLoading` is false: it still runs its hooks
(`useWindowDimensions`, a shared value, the root animation hook, two memos) and wraps children in an
`Animated.View` with `entering` / `exiting` layout animations. Multiplied by every field of every card on a
data-dense screen, that is hundreds of extra hooks and views after the data has arrived.

Fix: a tiny wrapper that renders `Skeleton` only while loading and returns `children` directly afterwards
(`skills/heroui/templates/skeleton-bypass.tsx`). Measured on a production profile screen:
UI-thread p95 65 ms → 42 ms, slow frames 442 → 68.

Trade-off: you lose the skeleton → content fade. If you want it, keep it at the section level
(one `Skeleton` or `SkeletonGroup` per card), never per text node.

Audit: `heroui-skeleton` hit count high (> ~30) with no wrapper/bypass = P2; on list rows or screens with
measured jank = P1.

## 4. Overdraw: translucent colors

Alpha itself is cheap in JS (`withAlpha` is a string op); the cost is GPU **overdraw** — every translucent
pixel blends with every layer below it, worst on Android during scroll.

- Over a **known solid background** (screen background, card surface, sheet background): pre-flatten
  `fg @ alpha over bg` to an opaque color (src-over compositing) and store it as a token or a module-level
  constant. Pixel-identical, zero blending.
- **Keep alpha** only where the backdrop varies: gradient stops, scrims over images / video / blur, floating
  bars over scrolling content, the sheet/dialog backdrop, `alpha === 0`.
- Nested translucency: flatten the parent first, then flatten the child over the parent's opaque result.
- Never write raw `rgba(...)` literals in components. Use a helper (`withAlpha` when kept, a flatten helper when
  flattened) so the decision is explicit and greppable.
- Tailwind opacity modifiers (`bg-white/5`, `border-black/10`) are also translucent. They are fine for
  small hairlines; avoid them on large fills inside scrolling lists.

Audit: `with-alpha` hit count (includes `rgba(` and `/NN` modifiers). Verify with Android
"Debug GPU overdraw" — large red regions in lists = P1, otherwise P2.

## 5. Memoization (React Compiler caveat)

React Compiler has conflicted with Reanimated v4 worklets in real apps; if the project has it disabled
(`app.json` `experiments.reactCompiler: false`, no `babel-plugin-react-compiler`), memoization is manual:
- `memo()` every list row and every component rendered under an animated parent.
- Props passed to heavy HeroUI primitives (`BottomSheet.Content` snap points, `style` objects,
  `animation` configs, `contentContainerProps`) must be stable: hoist constants to module scope,
  `useMemo` derived objects, `useCallback` handlers. A new `snapPoints` array each render forces Gorhom to
  recompute positions.
- Style objects built from tokens: hoist to a module-level `const … as const`, never inline in `.map()`.
- If the compiler *is* enabled, verify worklet-heavy files still work (gestures, `useAnimatedStyle`) and
  do not add redundant manual memo noise.

## 6. Provider placement and theme

- Order: `GestureHandlerRootView` (outermost, `flex: 1`) → `HeroUINativeProvider` → navigation / app.
  `BottomSheetModalProvider` (if you use Gorhom modals directly) and your `SheetsProvider` sit inside.
- One `HeroUINativeProvider` per app. Pass a **stable** `config` object (module-level const or `useMemo`):
  an inline `config={{ … }}` re-creates the toast/text contexts each render of the root layout.
- The provider already injects a `PortalHost` and Toast; do not mount a second one. Disable toast with
  `config.toast = false` (or use `provider-raw`) if you don't use it.
- Theme switching goes through Uniwind (`Uniwind.setTheme("dark" | "light" | custom)`, `useUniwind()`).
  Class-based styles resolve from CSS variables, so components styled with `className` update without your
  own context. Values read in JS (`useThemeColor`, `useUniwind().theme`) re-render their consumers —
  keep those reads in leaf components, not in screen roots or list parents.
- Do not mirror the theme into your own React context and pass colors down as props; that turns a theme
  switch into a full-tree re-render. Prefer `className` tokens; use `useThemeColor` only for props that
  cannot take a class (SVG `fill`, `RefreshControl tintColor`, chart libs). Batch reads:
  `useThemeColor(["accent", "muted"])`.

## 7. Re-render storms from context

- Any context whose value is an inline object re-renders all consumers (scan: `context-value-inline`).
- Sheets/toasts/theme state belong in separate contexts from actions.
- Avoid putting "is any sheet open" or scroll position into a context read by list rows.

## 8. Measuring

- React DevTools Profiler: commit time of the screen, number of rendered `Skeleton` / sheet nodes.
- Release-like build on a mid/low-end Android device: `adb shell dumpsys gfxinfo <pkg>` (janky frames %,
  p95/p99), GPU overdraw overlay, Perf Monitor UI/JS FPS.
- Record before/after for every change; keep a change only if a metric improves without visual regression.

## Severity guide (category `heroui`)

| Situation | Severity |
|---|---|
| Multiple eagerly mounted sheet trees on a frequently visited, data-heavy screen | P1 |
| Per-text-node `Skeleton` on list rows / measured jank | P1 |
| Large translucent fills in scrolling lists, overdraw confirmed | P1 |
| Root `heroui-native` import outside the provider | P2 |
| Inline provider `config`, unstable `snapPoints` | P2 |
| Raw `rgba()` literals instead of a helper | P2 |
