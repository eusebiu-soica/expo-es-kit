# SDK notes (52 → 57, plus 58 beta status)

**Always re-read the live release post before a step.** These notes were verified on 2026-10-07 and may lag behind it. Items marked **(verify)** were not confirmed from an official source.

Sources:
- Release posts:
  - https://expo.dev/changelog/2024/11-12-sdk-52
  - https://expo.dev/changelog/sdk-53
  - https://expo.dev/changelog/sdk-54
  - https://expo.dev/changelog/sdk-55
  - https://expo.dev/changelog/sdk-56
  - https://expo.dev/changelog/sdk-57
  - https://expo.dev/changelog/sdk-58-beta
- Version tables: https://docs.expo.dev/versions/latest/ (SDK 54–57) and https://docs.expo.dev/versions/v54.0.0/ (SDK 52–53)
- Bundled versions: `bundledNativeModules.json` of the latest patch of each SDK (`https://unpkg.com/expo@<version>/bundledNativeModules.json`), checked on `expo@52.0.49`, `53.0.27`, `54.0.37`, `55.0.31`, `56.0.23` and `57.0.27`
- React Native blog: https://reactnative.dev/blog
- Official Expo upgrade skill: https://github.com/expo/skills/tree/main/plugins/expo/skills/expo-upgrade

## Overview

| SDK | Released | React Native | React | Node min | iOS min | Xcode min | Android min / compile / target | New Architecture |
|---|---|---|---|---|---|---|---|---|
| 52 | 2024-11-12 | 0.76 | 18.3.1 | 20.18 | 15.1 | 16.0 | 7+ (minSdk 24) / 35 / 34 | Default for **new** projects; existing ones opt in |
| 53 | 2025-04-30 | 0.79 | 19.0.0 | 20.18 | 15.1 | 16.0 | 7+ / 35 / 35 | Default **on in all projects**; opt-out possible |
| 54 | 2025-09-10 | 0.81 | 19.1.0 | 20.19.4 | 15.1 | 16.1 (Xcode 26 recommended) | 7+ / 36 / 36 | **Last SDK with Legacy Architecture opt-out** |
| 55 | 2026-02-25 | 0.83 | 19.2.0 | 20.19.4 | 15.1 | 26.0 (26.2 in the docs table) | 7+ / 36 / 36 | **Mandatory**; `newArchEnabled` removed |
| 56 | 2026-05-21 | 0.85 | 19.2.3 | 20.19.4 | **16.4** | 26.4 | 7+ / 36 / 36 | Mandatory; **Hermes V1 default** |
| 57 | 2026-06-30 | 0.86 | 19.2.3 | **22.13** | 16.4 | 26.4 | 7+ / 36 / 36 | Mandatory |
| 58 | **beta** since 2026-09-15 | 0.88 (RC) | (verify) | 22.13 / 24.3 / 26+ | (verify) | iOS 27 SDK | AGP 9 compatible | Mandatory |

Latest stable on npm at 2026-10-07: `expo@57.0.27`. The dist-tag `next` is `58.0.6`, which is the SDK 58 beta. **Don't target SDK 58 until its stable post exists.**

Key bundled native versions (from `npx expo install`):

| Package | 52 | 53 | 54 | 55 | 56 | 57 |
|---|---|---|---|---|---|---|
| expo-router | ~4.0 | ~5.1 | ~6.0 | ~55.0 | ~56.2 | ~57.0 |
| react-native-reanimated | ~3.16 | ~3.17 | ~4.1 | 4.2 | 4.3 | 4.5 |
| react-native-worklets | — | — | 0.5 | 0.7 | 0.8 | 0.10 |
| react-native-gesture-handler | ~2.20 | ~2.24 | ~2.28 | ~2.30 | ~2.31 | ~2.32 |
| react-native-screens | ~4.4 | ~4.11 | ~4.16 | ~4.23 | ~4.26 | ~4.26 |
| @shopify/flash-list | 1.7 | 1.7 | 2.0 | 2.0 | 2.0 | 2.0 |
| expo-av | ~15.0 | ~15.1 | ~16.0 | **not bundled** | — | — |

From SDK 55 on, every Expo SDK package uses the SDK major as its own major. For example, `expo-camera@^55.0.0` belongs to SDK 55, and `expo-router` is `~55.x`.

---

## SDK 52 (2024-11-12): RN 0.76, React 18.3.1

- **New Architecture**: on by default for **new** projects only. Expo Go 52+ supports only the New Architecture.
- **Removed**:
  - `expo-camera/legacy`: migrate to the current `expo-camera` API.
  - `expo-sqlite/legacy`: migrate to the modern API.
  - `expo-barcode-scanner`: use `expo-camera` barcode scanning.
  - CRSQLite support in expo-sqlite.
  - Full-screen splash images on Android (`expo-splash-screen`).
- **expo-router v4** (React Navigation v7):
  - Generics were removed from `Href` and the navigation APIs (`Href<T>` → `Href`, `router.push<T>()` → `router.push()`).
  - The behaviour of `navigate` changed: it now acts like `push`. Use `dismissTo` for the old "go back to an existing route" behaviour. See https://reactnavigation.org/docs/upgrading-from-6.x/#changes-to-the-navigate-action
  - Typed routes no longer generate types for partial group hrefs.
- **New Architecture caveat**: state setters no longer run synchronously.
- **Deprecated**:
  - The `expo-av` Video API: use `expo-video`, which became stable in this SDK.
  - Push notifications in Expo Go: removed in SDK 53.
- **New**: `expo-audio` beta, `expo-file-system/next` beta, expo-image v2 (`useImage`). React Compiler is experimental (`experiments.reactCompiler`).
- **Grep hints**:
  - Legacy imports: `rg "expo-camera/legacy|expo-sqlite/legacy|expo-barcode-scanner"`
  - Router generics: `rg "Href<|push<|navigate<"`
  - Navigation semantics: `rg "router\.navigate\(|\bnavigate\("`

## SDK 53 (2025-04-30): RN 0.79, React 19.0

- **New Architecture is on by default in all projects**, including upgraded ones. `newArchEnabled: false` still works. Expo Go supports only the New Architecture.
- **React 19**:
  - Follow https://react.dev/blog/2024/04/25/react-19-upgrade-guide (some items are web-only).
  - Many libraries still declare React 18 peers. Prevent duplicate React copies with `overrides` (npm) or `resolutions` (yarn/pnpm).
- **Metro honours `package.json` `exports` by default.**
  - Expect dual-package hazards (ESM and CJS copies both loaded).
  - Known issues at release: `@supabase/supabase-js` and `@firebase/*`.
  - Opt out with `resolver.unstable_enablePackageExports = false`.
  - Remove old `metro`/`metro-resolver` overrides from `package.json`.
- **Deep imports**: `require('react-native/x/y')` deep imports may break.
- **AppDelegate is Swift**: config plugins that modify the Objective-C AppDelegate must be updated.
- **Edge-to-edge** on Android:
  - Default in new projects and Expo Go.
  - Disabled by default in existing projects (opt in). It became mandatory in SDK 54.
- **Linking**: the Android package name is no longer added automatically as a linking scheme in prebuild. Declare `scheme` explicitly.
- **Removed**: the `setImmediate` polyfill, React DevTools in Expo CLI (use React Native DevTools, key `j`), and push notifications in Expo Go on Android.
- **Deprecated**:
  - `expo-av`: `expo-audio` is now stable. No new expo-av versions are published after SDK 54.
  - `expo-background-fetch`: use `expo-background-task`.
  - `jsEngine` (JSC was removed from RN core in 0.79; use `@react-native-community/javascriptcore` if needed).
- **expo-router v5**: redirects and rewrites, guarded groups (`Stack.Protected`), prefetching. Breaking changes: check the router changelog **(verify)**.
- **Housekeeping**: `autoprefixer` is no longer needed. Prefer `postcss.config.mjs`.
- **Grep hints**:
  - `rg "from 'expo-av'|from \"expo-av\""`
  - `rg "expo-background-fetch|jsEngine|setImmediate|unstable_enablePackageExports|react-native/Libraries/"`
  - `rg -g '*.{js,ts}' "withAppDelegate" plugins/`

## SDK 54 (2025-09-10): RN 0.81, React 19.1

- **Last SDK that can run the Legacy Architecture.** RN 0.82+ cannot opt out. If `newArchEnabled: false`, switching it on is a **prerequisite step before 55**. Test on SDK 54 first.
- **Reanimated 4**:
  - Requires `react-native-worklets` and the New Architecture.
  - Follow the Reanimated 3 → 4 migration guide, but skip the `babel.config.js` change, because `babel-preset-expo` handles it.
  - Reanimated 3 can still be used on SDK 54 if the app needs the Legacy Architecture.
- **Edge-to-edge** is enabled in all Android apps and **can't be disabled** (target API 36). `react-native-edge-to-edge` is no longer a default dependency. Predictive back is off by default (`android.predictiveBackGestureEnabled`).
- **expo-file-system**:
  - The default export is now the new object-oriented API (`File`, `Directory`, `Paths`).
  - The old API moved to `expo-file-system/legacy`. The quick migration is to change the import to `/legacy`.
  - `expo-file-system/legacy` is still exported in SDK 55, 56 and 57 (checked in the package `exports`), but treat it as deprecated.
- **Removed**:
  - Deprecated `expo-notifications` function exports.
  - First-party JSC support in RN.
  - Internal `metro/src/...` imports (use `metro/private/...`).
  - `EXPO_USE_FAST_RESOLVER`.
- **Deprecated**:
  - RN `<SafeAreaView>`: use `react-native-safe-area-context`.
  - `notification` in the app config: use the `expo-notifications` config plugin.
  - `expo-build-properties` `enableProguardInReleaseBuilds`: use `enableMinifyInReleaseBuilds`.
- **expo-av**: its last SDK. It is removed in SDK 55. Migrate to `expo-audio`/`expo-video` **before** leaving SDK 54.
- **Other changes**:
  - `locales` now supports both platforms; move the iOS-only translations under `locales.ios`.
  - `@expo/vector-icons` families were updated, which may cause type errors.
  - React Compiler is enabled in the default template (RC at the time).
  - Precompiled RN XCFrameworks for iOS, except with `use_frameworks!`, where RN builds from source.
- **expo-router v6**: link previews, native tabs (beta, `expo-router/unstable-native-tabs`), experimental middleware. No explicit router breaking changes are listed in the post **(verify the router changelog)**.
- **Xcode 26** is recommended. It is needed for iOS 26 features such as Liquid Glass and `.icon` files.
- **Grep hints**:
  - `rg "from 'expo-file-system'"` (decide between the new API and `/legacy`)
  - `rg "expo-av|SafeAreaView.*from 'react-native'|react-native-edge-to-edge|metro/src/|enableProguardInReleaseBuilds|newArchEnabled"`

## SDK 55 (2026-02-25): RN 0.83, React 19.2

- **The New Architecture is mandatory.** `newArchEnabled` was removed from the app config. Every native library must support it (see `library-compat.md`).
- **expo-av** was removed from the SDK and Expo Go, and gets no more patches. It is not in `bundledNativeModules`; the last npm version is 16.0.8 (SDK 54). Migrate:
  - `Audio.Sound` → `useAudioPlayer`
  - `Audio.Recording` → `useAudioRecorder`
  - `Video` → `VideoView` + `useVideoPlayer`
  - See the official skill references `expo-av-to-audio.md` and `expo-av-to-video.md`.
- **Removed from the config**:
  - `notification`: use the `expo-notifications` plugin.
  - `edgeToEdgeEnabled`: edge-to-edge is mandatory.
  - The fast resolver.
  - `experiments.reactCanary`.
- **Config and tooling changes**:
  - The `app.config.ts` file is transpiled with the project's local TypeScript.
  - `eas update` requires `--environment`.
  - `autolinkingModuleResolution` is on by default in monorepos.
- **API breaks**:
  - expo-video: `allowsFullscreen` → `fullscreenOptions.enable`.
  - expo-clipboard: the listener `content` was removed; use `getStringAsync()`.
  - expo-cellular: carrier constants were removed.
  - expo-blur: `experimentalBlurMethod` → `blurMethod`.
  - expo-router: the `ExpoRequest`/`ExpoResponse` types were removed (use `Request`/`Response`), and headless tabs `reset` → `resetOnFocus`.
  - Expo UI SwiftUI renames: `DateTimePicker` → `DatePicker`, `Switch` → `Toggle`.
- **Native tabs**: `Icon`, `Label`, `Badge` and `VectorIcon` are no longer separate imports. Use `NativeTabs.Trigger.Icon`, `.Label`, `.Badge` and `.VectorIcon` (from the official skill's `native-tabs.md`).
- **Deprecated**:
  - `removeSubscription()`: use `subscription.remove()`.
  - `expo-video-thumbnails`: use `generateThumbnailsAsync` from expo-video. Removal was planned for SDK 56, but it is still bundled in 56 and 57.
  - expo-video track `bitrate`.
  - The expo-navigation-bar methods (now no-ops) and `androidNavigationBar`.
  - expo-status-bar `backgroundColor`, `translucent` and `networkActivityIndicatorVisible`.
- **Behaviour change**: push notifications in Expo Go on Android now throw.
- **Hermes V1**: an opt-in (`expo-build-properties` `useHermesV1`). **Don't opt in**: it has a memory regression (see the SDK 56 notes).
- **Toolchain**: Xcode 26 (EAS default 26.2). Node `^20.19.4 || ^22.13 || ^24.3 || ^25`.
- **Grep hints**:
  - `rg "expo-av|allowsFullscreen|experimentalBlurMethod|removeSubscription|ExpoRequest|ExpoResponse|expo-video-thumbnails"`
  - `rg "from 'expo-router/unstable-native-tabs'"`, then look for `Icon`/`Label`/`Badge` imports
  - In the app config: `rg "newArchEnabled|edgeToEdgeEnabled|androidNavigationBar|\"notification\""`

## SDK 56 (2026-05-21): RN 0.85, React 19.2

> **The official Expo skill says: from SDK ≤ 55, skip SDK 56 and go straight to SDK 57 (`expo >= 57.0.9`).** SDK 56 has a Hermes V1 memory regression with Reanimated/worklets, and Hermes V1 is now the default. Apply this section's migrations as part of the 55 → 57 step (see `playbook.md` §0).

- **iOS minimum 16.4** (was 15.1), Xcode 26.4, Node 20.19.4+.
- **expo-router no longer depends on React Navigation.** App code must not import `@react-navigation/*`.
  - Run `npx expo-codemod sdk-56-expo-router-react-navigation-replace <src-dir>`.
  - Manual mapping:
    - `@react-navigation/native`, `/core`, `/elements` and `/routers` → `expo-router/react-navigation`
    - `@react-navigation/stack` → `expo-router/js-stack`
    - `@react-navigation/bottom-tabs` → `expo-router/js-tabs`
    - `@react-navigation/material-top-tabs` → `expo-router/js-top-tabs`
    - `@react-navigation/native-stack` has no direct equivalent: use the `Stack` layout.
  - Don't rewrite `import { Stack } from 'expo-router'`.
  - Then remove the unused `@react-navigation/*` dependencies.
- **`expo/fetch` is `globalThis.fetch`** (WinterTC). Opt out with `EXPO_PUBLIC_USE_RN_FETCH=1`.
- **expo-file-system**: `File`/`Directory` `copy()` and `move()` are now **async** and must be awaited.
- **Dependencies dropped from `expo`**:
  - `expo` no longer depends on `@expo/vector-icons`. Add it explicitly if you use it; it will be replaced by `@react-native-vector-icons/*`.
  - DOM components use `@expo/dom-webview`, so `react-native-webview` is no longer needed for them.
- **Deprecated**: the original `expo-calendar`, `expo-contacts` and `expo-media-library` APIs. They are superseded by the redesigned (formerly `/next`) APIs.
- **Expo Go** for SDK 56 was not available in the stores. Use a dev build.
- **Grep hints**:
  - `rg "@react-navigation/"`
  - `rg "\.(copy|move)\("` near expo-file-system `File`/`Directory`
  - `rg "@expo/vector-icons"` (check that it is in `package.json`)
  - `rg "expo-calendar|expo-contacts|expo-media-library"`

## SDK 57 (2026-06-30): RN 0.86, React 19.2 (current stable)

- **Upgrade notes**:
  - RN 0.86 is intended to have **no breaking changes from 0.85**. The post calls it a straightforward upgrade from SDK 56.
  - **Node minimum 22.13** (docs table). Node 20 is no longer supported.
  - **Use `expo >= 57.0.9`**, which fixes the Hermes V1 memory regression. Use `>= 57.0.17` for the dev startup-time regression too. A plain `npx expo install expo@^57.0.0` resolves to the latest patch (57.0.27 as of 2026-10-07). Check the lockfile.
- **Bumps**: Reanimated 4.5, worklets 0.10, gesture-handler 2.32.
- **`npx expo prebuild` now clears and regenerates `android/` and `ios/` by default.** This is dangerous for projects with committed native edits.
- **Xcode 27 / iOS 27 SDK** requires the UIKit scene lifecycle. `expo@57.0.23+` adds the opt-in `ios.enableSceneSupport`. Check config plugins and libraries that hook `AppDelegate` lifecycle methods.
- **Release cadence**: the post explores optional, non-breaking SDK releases between majors. SDK lifetime stays about one year.
- **Grep hints**:
  - `rg "AppDelegate|application\(_:didFinishLaunching|applicationDidBecomeActive" plugins/ ios/`
  - Check `engines.node`, `.nvmrc` and the `eas.json` `node` pin against 22.13.

## SDK 58 (beta only, 2026-09-15): not a target yet

- **Status**: there is no stable post yet. Stable is due shortly after RN 0.88 ships. Use it for planning only.
- **Announced breaking changes**:
  - The iOS 27 SDK requires the UIScene lifecycle; prebuild generates `SceneDelegate.swift`.
  - RN strict TypeScript: `react-native/Libraries/*` deep imports become type errors, and refs use instance types such as `ViewInstance`.
  - `NODE_ENV` is set before config/`.env` loading.
  - R8 minification is on by default for Android release builds.
  - The expo-router navigation core has removed React Navigation API exports.
  - `File.write()` is async (use `writeSync()`).
  - LibSQL was removed from expo-sqlite.
  - RN removed `InteractionManager`, `Touchable`, `NativeMethods` and `Modal.animated`.
- **Deprecated**: `File.md5` → `File.digest()`, and `NativeArrayBuffer`.
- **Prepare now (on 57)**: remove `react-native/Libraries/` deep imports, `InteractionManager` and `Touchable*` usage. Test release builds with minification.
