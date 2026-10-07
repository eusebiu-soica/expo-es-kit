# Measuring performance on device

Static review finds suspects; only measurement confirms them. Use this file when a perf/startup finding needs confirmation, when a fix must be proven, or when the user asks "is it actually faster". Report every number with device, build type, and run count.

## 1. Build and devices

**Never measure in Expo Go or a dev-mode bundle.** Dev mode adds prop-type checks, dev warnings, unminified JS and the dev menu; numbers are 2–5× off and regressions/improvements can invert.

Release-like options (pick one, note it in the report):
```sh
# Local release builds (native toolchains required)
npx expo run:android --variant release
npx expo run:ios --configuration Release

# Dev client but production JS (fast iteration; close to release for JS cost)
npx expo start --no-dev --minify

# EAS internal build (preview/production profile)
eas build --profile preview --platform android
```

Device matrix (minimum):
| Device | Why |
|---|---|
| Min-spec Android (e.g. 4 GB RAM, mid/low-tier SoC, 60 Hz, 2–4 years old) | Gates are defined here. Most jank only shows here. |
| Recent flagship Android (90/120 Hz) | Catches high-refresh frame budget (8.3 ms at 120 Hz) issues. |
| iPhone (oldest supported model if possible) | Different image decoder, keychain and memory behaviour. |

Emulators/simulators are fine for functional checks, never for frame times or memory numbers.

Before each run: same app version, same account/data volume, battery > 50 %, not charging-throttled, airplane mode off but stable network (or a fixed network profile), force-stop the app, close other apps. Do 5+ runs per scenario; report median and spread.

## 2. Android

```sh
PKG=com.example.app

# Frame timing for one scenario
adb shell dumpsys gfxinfo $PKG reset
#   … perform the scenario (scroll feed 10 s, open/close sheet 5×, navigate A→B→A) …
adb shell dumpsys gfxinfo $PKG            # Janky frames %, 50th/90th/95th/99th percentile
adb shell dumpsys gfxinfo $PKG framestats # per-frame timestamps (ns) for custom analysis

# Memory
adb shell dumpsys meminfo $PKG            # TOTAL PSS, Native Heap, Graphics, Views, Activities

# Overdraw + GPU bars (toggle back off afterwards)
adb shell setprop debug.hwui.overdraw show
adb shell setprop debug.hwui.profile visual_bars
adb shell setprop debug.hwui.overdraw false
adb shell setprop debug.hwui.profile false

# Cold start
adb shell am force-stop $PKG
adb shell am start -W -n $PKG/.MainActivity   # TotalTime / WaitTime (ms) = to first native frame, NOT to content
```

- Overdraw colours: none/blue (1×) fine, green (2×) acceptable, pink/red (3–4×) on large areas = translucent layers over opaque backgrounds → flatten colours.
- `am start -W` stops at the first native frame (splash). Time to first real content needs a JS mark (section 5).
- Developer options alternative: "Profile HWUI rendering → On screen as bars", "Debug GPU overdraw".
- Android Studio Profiler (CPU/memory) and Perfetto (`adb shell perfetto …` or ui.perfetto.dev) for deep traces; system traces show JS thread vs UI thread vs RenderThread.

## 3. iOS

Xcode → Product → Profile (Release build) → Instruments:
| Template | Use for |
|---|---|
| Time Profiler | Main thread and JS thread hot spots during the scenario. |
| Allocations / VM Tracker | Memory growth across repeated visits (generation marks between visits). |
| Animation Hitches (or Core Animation FPS on older Xcode) | Hitch rate and dropped frames during scroll/transition. |
| App Launch | Cold start phases up to first frame. |

Xcode Debug Navigator memory gauge is enough for a quick "grows monotonically?" check.

## 4. React layer

- **React Native DevTools** (press `j` in the Metro terminal): React Profiler tab — record the scenario, inspect commit count, slowest commits, "why did this render". Profiler numbers come from a dev build: use them for *relative* comparison and render counts, not absolute ms.
- **React DevTools "Highlight updates"**: fast way to spot whole-screen re-renders on a keystroke or a timer tick.
- **Custom `<Profiler>` / `performance.now()` marks**: allowed, but only under `__DEV__` or a debug flag (`hits["perf-log-not-dev"]`). Remove or gate before shipping.
- Count renders, not just durations: a list row rendering 3× per scroll frame is the bug even when each render is fast.

## 5. Startup

1. Native: `am start -W` (Android), App Launch template (iOS).
2. To first real content: record a timestamp when the root module evaluates and when the first meaningful screen (with data, not a skeleton) is laid out:
   ```ts
   // index / root layout module scope
   const T0 = global.performance?.now?.() ?? Date.now();
   // first content screen
   onLayout={() => { if (__DEV__ || DEBUG_PERF) console.log('[perf] TTI', (performance.now() - T0).toFixed(0), 'ms'); }}
   ```
   Or use `react-native-performance` / `@shopify/react-native-performance` / EAS-based insights if already installed (`stack.libs`).
3. Measure cold (force-stop + no process), warm (backgrounded), and first launch after install separately; first launch includes storage creation and migrations.

## 6. What to record

| Metric | Source | Report as |
|---|---|---|
| Frame time p50 / p95 / p99 | gfxinfo, Instruments hitches | ms, per scenario |
| Janky frames % | gfxinfo | % of total frames |
| TOTAL PSS, Native Heap, Graphics | meminfo | MB, after scenario and after 3 repeats |
| Texture / GPU memory | meminfo "Graphics", gfxinfo GPU memory section, Instruments VM Tracker (IOSurface/IOKit) | MB |
| Cold start to first frame | `am start -W`, App Launch | ms |
| Cold start to first content (TTI) | custom mark | ms |
| Network requests on cached return | proxy (Charles/Proxyman) or request log | count per screen visit |
| Render count per interaction | React Profiler | commits / interaction |

Template line for the report:
`Feed scroll 10 s · Pixel 4a · release · 5 runs: p50 9.8 ms, p95 42 ms (was 65), p99 88 ms, janky 4.1 % (was 11 %), PSS 212 MB stable over 3 visits`

## 7. Gates

| Gate | Threshold (min-spec Android unless noted) |
|---|---|
| Sustained frames | No sustained run of frames > 16.7 ms during scroll, sheet open, or navigation transition (isolated spikes on mount are acceptable if p95 ≤ ~33 ms). |
| Cold start to content | < 2 s target; > 4 s is a P1 finding. |
| Cached return | Revisiting a cached screen shows data on the first frame and fires **≤ 1 deduped** background refresh per query family. |
| Memory | Not growing monotonically across repeated visits (open → back × 5: PSS returns to a plateau). Monotonic growth = leak (listeners, timers, unbounded caches, retained textures). |
| GPU/texture memory | Thumbnails never decode originals; feed scroll does not push Graphics memory into hundreds of MB. |
| High refresh devices | On 120 Hz, the budget is 8.3 ms; report but do not fail the audit on 120 Hz alone. |

## 8. Method lessons

1. **Verify the cause before fixing.** Reproduce, profile, identify the actual hot component/function. A guessed fix that "should help" often does nothing or regresses.
2. **Change one thing at a time.** Measure baseline → apply one change → re-measure same scenario, same device, same run count.
3. **Keep a change only if the metric AND perceived smoothness improve.** A better p95 with visible stutter (e.g. blank cells from aggressive virtualization) is a regression.
4. **List virtualization is not automatically faster.** On dense, mixed-content screens, swapping to FlashList or enabling `removeClippedSubviews` has caused regressions (blank areas, re-layout cost). Measure both; splitting a giant screen into subroutes is often the real fix.
5. **File length is not a perf problem.** `largestComponents` and `hits["large-component"]` point to files worth reading; the cost is in what renders, how often, and with what data work — not line count.
6. **Dev-build numbers are only relative.** Use them for A/B of the same build type, never as absolute claims.
7. **Report the measurement method with the claim.** "Unmeasured" is a valid label; a number without device/build/run count is not.
8. **Re-measure after unrelated upgrades** (SDK, Reanimated, list library): prior wins can disappear.
