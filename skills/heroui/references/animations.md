# HeroUI Native — animations, gestures, bottom sheets

HeroUI Native animates with Reanimated v4 (+ `react-native-worklets`), gestures with
`react-native-gesture-handler`, and sheets with `@gorhom/bottom-sheet` v5. Peer ranges for 1.0.x:
reanimated `^4.1.1`, worklets `>=0.5.1`, gesture-handler `^2.28.0`, gorhom `^5.2.x`, react-native `>=0.81`.

Scan hits: `reanimated-usage`, `animated-layout-prop`, `run-on-js`, `old-animated`,
`use-native-driver-false`, `reduced-motion`, `heroui-bottom-sheet`, `interaction-manager`.

## 1. Toolchain

- Reanimated v4 moved worklets into `react-native-worklets`. The Babel plugin is
  `react-native-worklets/plugin` and must be the **last** plugin. Expo's `babel-preset-expo` adds it
  automatically on recent SDKs — only add it by hand if you have a custom `babel.config.js`, and never
  list both the old `react-native-reanimated/plugin` and the worklets plugin.
- Reanimated v4 requires the New Architecture.
- **React Compiler caveat**: production apps have hit conflicts between React Compiler and Reanimated v4
  worklets (shared values read during render, worklet closures memoized incorrectly). If you see it,
  disable the compiler (`experiments.reactCompiler: false`) and memoize manually (see performance.md §5).
  If it is enabled and working, read `.value` / `.get()` only inside worklets and animated styles, never during render.
- Use `sv.get()` / `sv.set()` (v4 style) consistently; avoid mixing with `.value` in the same file.
- Prefer `scheduleOnRN` (worklets) over `runOnJS` in new v4 code; both work. Keep JS callbacks rare
  inside gesture `onUpdate`.

## 2. What to animate

- Animate **transform** (`translateX/Y`, `scale`, `rotate`) and **opacity** only. They run on the UI
  thread without layout.
- Animating `width`, `height`, `top`, `left`, `margin`, `padding` triggers layout on every frame
  (scan: `animated-layout-prop`). Replace with `scaleY` + `transformOrigin`, a measured `translateY`, or a
  layout transition used once.
- Layout animations (`entering`, `exiting`, `LinearTransition`) are cheap individually but costly in lists:
  every row mounting with `FadeIn` during scroll or initial render stalls the UI thread. Never put entering
  animations on list rows; use them on a handful of elements.
- No mount animations on screens during the navigation transition: the stack push already animates;
  stacking `entering` on 20 children makes the push stutter. Delay with the navigation `transitionEnd`
  event or skip.
- Old `Animated` API: only with `useNativeDriver: true`, and prefer Reanimated for anything new.

## 3. Reduced motion

HeroUI handles this globally:
- `HeroUINativeProvider` reads Reanimated's `useReducedMotion()`. When the OS "Reduce Motion" setting is
  on, **all HeroUI animations are disabled** automatically.
- Force-disable everything: `config={{ animation: "disable-all" }}` on the provider (useful for E2E tests
  and screenshots).
- Per component: `animation={false}` / `"disabled"` (this part only) or `"disable-all"` on root parts
  (cascades to children). Object form keeps a custom config but toggles with `state`.
- `isAnimatedStyleActive={false}` on parts such as `BottomSheet.Overlay`, `Skeleton`, `Accordion.Indicator`
  turns off the internal animated style so your `className` / `style` wins.

Your own animations are not covered by the provider:
- Pass `reduceMotion: ReduceMotion.System` in `withTiming` / `withSpring` configs and
  `.reduceMotion(ReduceMotion.System)` on layout animation builders (verify the default in your Reanimated
  version), or branch on `useReducedMotion()`.
- Reduced motion means no large movement/parallax/auto-playing loops; short opacity fades are fine.

## 4. Haptics

- Light impact on sheet open and on confirm of destructive actions; selection feedback on pickers/segmented
  controls. Don't haptic on every tap.
- Fire after the state change, on the next frame (`requestAnimationFrame(() => Haptics.impactAsync(...))`),
  so the native haptic call doesn't compete with the first animation frame.
- Centralize in the sheet host / a `haptics` helper so it's consistent and easy to disable.

## 5. Gestures

- `GestureHandlerRootView style={{ flex: 1 }}` must be the outermost wrapper (HeroUI docs).
- Use the `Gesture` API (`Gesture.Pan()`, `Gesture.Tap()`) with `GestureDetector`; keep state in shared values.
- Inside sheets, use Gorhom's scrollables (`BottomSheetScrollView`, `BottomSheetFlatList`,
  `BottomSheetSectionList`) — a plain `ScrollView` / `FlatList` fights the sheet's pan gesture.
- Horizontal carousels inside a sheet: set `activeOffsetX` / `failOffsetY` so vertical drags reach the sheet.

## 6. Bottom sheets: snap points, dynamic height, scroll

HeroUI `BottomSheet.Content` wraps its children in Gorhom's `BottomSheetView` and forwards all Gorhom
props (`snapPoints`, `index`, `enableDynamicSizing`, `maxDynamicContentSize`, `keyboardBehavior`,
`enablePanDownToClose`, …). Control open state with `isOpen` / `onOpenChange` on the root; use
`onOpenChange(false)` for close side effects — Gorhom's `onClose` only fires on swipe-down.

Two sheet modes — pick one per sheet and encode it in the registry:

**A. Fixed snap points + internal scroll** (long forms, lists, filters)
```ts
config: { enableDynamicSizing: false, snapPoints: ["60%", "90%"], keyboardBehavior: "extend" }
```
- Gorhom's content view is absolutely positioned **with no height**. `flex: 1` / `h-full` inside it
  resolves to 0 while the sheet animates open → empty sheet, then content pops in.
- Fix: the host wraps the body in a `View` with a **pixel height** = largest snap point in px − handle
  height. Then `BottomSheetScrollView className="flex-1"` has a bounded parent on the first frame.
- Don't add another `flex: 1` wrapper around the body.
- Set `enableOverDrag={false}` so the top snap is a hard stop.

**B. Dynamic height with a cap** (content-sized sheets that may grow long)
```ts
config: { enableDynamicSizing: true, maxDynamicContentSizePercent: 0.9 }
```
- The host maps the percent to Gorhom's `maxDynamicContentSize` in pixels (`windowHeight × percent`).
- The scrollable must also get `style={{ maxHeight: capPx − handlePx − stickyHeaderPx }}`. Without it,
  the scroll view grows with its content, the sheet clips it, and nothing scrolls. A `maxHeight` alone does
  not stop the sheet growing to full screen — you need both.
- Root body wrapper has no horizontal padding; put padding on inner sections so scrollables reach the edges.

Short static sheets (confirmations, 2–5 actions): dynamic sizing without scroll, no snap points.

Lists in sheets: > ~50 rows → `BottomSheetFlatList` with mode A. Sticky header outside the list.

Keyboard:
- `keyboardBehavior: "extend"` or `"interactive"`, `keyboardBlurBehavior: "restore"`.
- Inputs inside the sheet: `BottomSheetTextInput` (Gorhom) or attach `useBottomSheetAwareHandlers()` from
  `heroui-native/hooks` to HeroUI inputs.
- iOS: `automaticallyAdjustKeyboardInsets` on the sheet's scroll view so a field can scroll above the keyboard.
- Android: test `android_keyboardInputMode` (`"adjustPan"` vs `"adjustResize"`) together with the app-level
  `softwareKeyboardLayoutMode` on a real device; they interact and the wrong pair leaves the sheet behind the IME.
- Focus an input **after** the open animation: use the sheet's `onChange` (index ≥ 0) or a deferred
  task (`InteractionManager.runAfterInteractions` / `requestIdleCallback`; check deprecation status in your
  RN version). `autoFocus` during the open animation causes a double animation and dropped frames.

Overlay:
- The backdrop is the one place where alpha must stay (content behind is visible and varies).
- If the overlay opacity sometimes fails to appear (animated value stalls), `isAnimatedStyleActive={false}`
  plus an explicit translucent background is a known workaround.
- iOS: `BottomSheet.Portal` uses `FullWindowOverlay`, which hides it from the element inspector; use
  `disableFullWindowOverlay` only for debugging (the sheet then won't render above native modals).

## 7. 60 / 120 Hz

- Frame budget: 16.7 ms at 60 Hz, 8.3 ms at 120 Hz. Anything on the JS thread during a gesture or sheet
  animation (setState, data parsing, haptics, logging) drops frames first on 120 Hz devices.
- iOS ProMotion: apps are limited to 60 Hz unless `CADisableMinimumFrameDurationOnPhone` is `true` in
  `Info.plist` (Expo: `ios.infoPlist`). Verify the current Expo/RN defaults before adding it.
- Reanimated animations follow the display refresh; durations are in ms so they look the same.
- Test sheet open/close and list scroll on a low-end 60 Hz Android and a 120 Hz device; profile with the
  release build (`gfxinfo`, Perf Monitor), never in dev mode.

## Severity guide

| Situation | Severity |
|---|---|
| Animated layout props (`height`, `top`) on scrolling / frequently animated elements | P1 |
| Entering animations on list rows | P1 |
| Sheet opens empty / content pops in, or long sheet doesn't scroll | P1 (user-visible) |
| Plain `ScrollView`/`FlatList` inside a sheet | P2 (P1 if it breaks drag) |
| Own animations ignore reduced motion | P2 |
| React Compiler on + worklet bugs observed | P1; compiler on, no evidence → note only |
