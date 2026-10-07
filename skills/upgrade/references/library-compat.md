# Library compatibility (the usual upgrade blockers)

For each library: how its version is chosen, known pitfalls, and where to check compatibility.

Ground rules:
- **The SDK picks the version when the library is in `bundledNativeModules.json`.** Install it with `npx expo install <pkg>` and keep it aligned with `npx expo install --check`. Don't override it with `npm i <pkg>@latest`. The newest version is often built for a *newer* React Native than the SDK ships.
- **Libraries not bundled by the SDK are chosen manually.** For each one:
  - Read its `peerDependencies`: `npm view <pkg>@<version> peerDependencies`.
  - Read its release notes for the minimum React Native / Expo versions and New Architecture support.
  - Check https://reactnative.directory. `npx expo-doctor` warns about unknown or unmaintained packages; configure that with `expo.doctor.reactNativeDirectoryCheck` in `package.json` (see https://docs.expo.dev/versions/latest/config/package-json/).
  - Search the library's GitHub issues for the target `react-native 0.xx` / `expo 5x`.
- **Every native library change needs a dev-client rebuild.** If it ships a config plugin, it also needs a prebuild (CNG) or manual native edits.
- **On SDK 55 and later, the New Architecture is mandatory.** A library without New Architecture support is a **blocker**: upgrade it, replace it, or stay on SDK 54.

To read the SDK's pinned version without installing anything:
```sh
npm view expo@^57.0.0 version                                    # latest patch of an SDK, e.g. 57.0.27
curl -sL https://unpkg.com/expo@57.0.27/bundledNativeModules.json | grep -E '"(react-native-reanimated|react-native-worklets)"'
```
The same file lives in the repo at https://github.com/expo/expo/blob/main/packages/expo/bundledNativeModules.json (pick the `sdk-NN` branch).

## Bundled versions per SDK (from bundledNativeModules.json, checked 2026-10-07)

| Package | SDK 52 | 53 | 54 | 55 | 56 | 57 |
|---|---|---|---|---|---|---|
| react-native-reanimated | ~3.16.1 | ~3.17.4 | ~4.1.1 | 4.2.1 | 4.3.1 | 4.5.1 |
| react-native-worklets | — | — | 0.5.1 | 0.7.4 | 0.8.3 | 0.10.1 |
| react-native-gesture-handler | ~2.20.2 | ~2.24.0 | ~2.28.0 | ~2.30.0 | ~2.31.1 | ~2.32.0 |
| @shopify/flash-list | 1.7.3 | 1.7.6 | 2.0.2 | 2.0.2 | 2.0.2 | 2.0.2 |
| @shopify/react-native-skia | 1.5.0 | 2.0.0-next.4 | 2.2.12 | 2.4.18 | 2.6.2 | 2.6.2 |
| @sentry/react-native | ~6.10.0 | ~6.14.0 | ~7.2.0 | ~7.11.0 | ~7.11.0 | ~7.11.0 |
| @stripe/stripe-react-native | 0.38.6 | 0.45.0 | 0.50.3 | 0.63.0 | 0.64.0 | 0.64.0 |
| react-native-svg | 15.8.0 | 15.11.2 | 15.12.1 | 15.15.3 | 15.15.4 | 15.15.4 |
| lottie-react-native | 7.1.0 | 7.2.2 | ~7.3.1 | ~7.3.4 | ~7.3.4 | ~7.3.8 |
| react-native-maps | 1.18.0 | 1.20.1 | 1.20.1 | 1.27.2 | 1.27.2 | 1.27.2 |
| react-native-screens | ~4.4.0 | ~4.11.1 | ~4.16.0 | ~4.23.0 | ~4.26.0 | ~4.26.0 |
| react-native-safe-area-context | 4.12.0 | 5.4.0 | ~5.6.0 | ~5.6.2 | ~5.7.0 | ~5.7.0 |
| react-native-webview | 13.12.5 | 13.13.5 | 13.15.0 | 13.16.0 | 13.16.1 | 13.16.1 |
| expo-dev-client | ~5.0.20 | ~5.2.4 | ~6.0.21 | ~55.0.40 | ~56.0.27 | ~57.0.19 |

**Not bundled** (chosen manually): `@gorhom/bottom-sheet`, `react-native-mmkv` (+ `react-native-nitro-modules`), `react-native-purchases`, `nativewind`, `uniwind`, `tailwindcss`, `heroui-native`, `@react-native-firebase/*`.

---

## react-native-reanimated + react-native-worklets

- **Version**: bundled. Always install the pair together: `npx expo install react-native-reanimated react-native-worklets`.
- **Since Reanimated 4** (SDK 54+), worklets is a separate package. Each Reanimated minor accepts only specific worklets minors and RN versions. Examples from the npm `peerDependencies`:
  - 4.3.1 needs RN `0.81 - 0.85` and worklets `0.8.x`.
  - 4.5.1 needs RN `0.83 - 0.86` and worklets `0.10.x`.
  - 4.7.1 (latest) needs RN `0.86 - 0.88` and worklets `0.13.x`.
- **Pitfalls**:
  - Reanimated 4 is **New Architecture only**. Reanimated 3 is the only option on the Legacy Architecture, which means SDK ≤ 54.
  - Babel: `babel-preset-expo` adds the worklets plugin automatically on SDK 54+. A manual `react-native-reanimated/plugin` in `babel.config.js` duplicates it or is in the wrong position. Remove it, or keep exactly one plugin, placed last.
  - A JS/native version mismatch error means the dev client is stale, so rebuild it.
  - **Hermes V1 memory regression** with worklets/Reanimated hits SDK 55 (when Hermes V1 is opted in), SDK 56, and SDK 57 before 57.0.9. Fix it by upgrading to `expo >= 57.0.9`. Don't use Worklets Bundle Mode as a workaround.
  - Reanimated 3 → 4 API changes: follow the official migration guide, but skip its babel step on Expo.
- **Check**: the compatibility table at https://docs.swmansion.com/react-native-reanimated/docs/guides/compatibility/ and `npm view react-native-reanimated@<v> peerDependencies`.

## react-native-gesture-handler

- **Version**: bundled (2.x on every SDK up to 57).
- **Pitfall**: npm `latest` is **3.x** (3.3.0), a new major. Don't install it manually on SDK ≤ 57. Wait until an SDK bundles it, or read the RNGH 3 migration guide first. Many libraries (bottom-sheet, heroui-native) declare `^2.x` peers.
- **Pitfall**: the root must be wrapped in `GestureHandlerRootView`.
- **Check**: https://docs.swmansion.com/react-native-gesture-handler/ and the release notes.

## @gorhom/bottom-sheet

- **Version**: manual. Latest is 5.2.x. Its peers are `react-native-reanimated >=3.16.0 || >=4.0.0-` and `react-native-gesture-handler >=2.16.1`.
- **Pitfalls**:
  - Use v5 on Reanimated 3 or 4. Older v4 doesn't work with Reanimated 3.16+/4 **(verify)**.
  - The sheet breaks when Reanimated or gesture-handler are mismatched (they are its real constraint), when the `BottomSheetModalProvider` placement is wrong, or after an edge-to-edge or keyboard-handling change on Android.
  - Retest every sheet on device after a Reanimated minor bump.
- **Check**: https://github.com/gorhom/react-native-bottom-sheet/releases and its issues filtered by the Reanimated version.

## @shopify/flash-list

- **Version**: bundled. 1.7.x on SDK 52–53, **2.0.x on SDK 54+**.
- **Pitfalls**:
  - FlashList v2 is **New Architecture only**.
  - It no longer needs `estimatedItemSize`. The old size props are deprecated or ignored.
  - Layout behaviour changed, so re-check `getItemType`, `overrideItemLayout`, masonry and the scroll-to-index code.
  - The v1 → v2 move happens at the SDK 53 → 54 step.
- **Check**: https://shopify.github.io/flash-list/ (the v2 migration guide).

## @shopify/react-native-skia

- **Version**: bundled. SDK 53 shipped a `2.0.0-next` prerelease; 54+ ships stable 2.x.
- **Pitfalls**:
  - Skia 2.x needs React 19 and RN 0.78+.
  - Recent 2.x versions also peer on `react-native-reanimated >=4.0.0` and `react-native-worklets >=0.7.0`.
  - npm latest (2.14) is newer than any SDK pin, so stay on `npx expo install`.
  - It is a large binary, so expect longer pod/Gradle builds.
- **Check**: https://shopify.github.io/react-native-skia/ and the GitHub releases.

## react-native-mmkv

- **Version**: manual. Latest is 4.x, which is a **Nitro module**: it peers on `react-native-nitro-modules`, and both must be installed. v3 also requires the New Architecture.
- **Pitfalls**:
  - On SDK 55+, v2 (legacy bridge) is not an option.
  - v3 → v4 changes the API surface **(verify)** (for example, creating instances and `delete` vs `remove`). Read the upgrade notes.
  - Keep the `react-native-nitro-modules` version within the range that MMKV supports.
  - It needs a dev build and doesn't work in Expo Go.
- **Check**: https://github.com/mrousavy/react-native-mmkv (README + releases). The plugin's `audit/references/checks/mmkv.md` has the storage hygiene checks.

## react-native-purchases (RevenueCat)

- **Version**: manual. Latest is 10.x. Its peers are loose (`react-native >= 0.73`), so they don't prove compatibility.
- **Pitfalls**:
  - `react-native-purchases-ui` must be **the exact same version** as `react-native-purchases`.
  - The native SDKs raise iOS/Android minimums over time, so compare them with the SDK's iOS minimum (16.4 from SDK 56).
  - It needs a dev build; Expo Go only runs a preview/mock mode.
  - Always run a sandbox purchase and a restore during the device smoke test.
- **Check**: https://www.revenuecat.com/docs/getting-started/installation/expo and https://github.com/RevenueCat/react-native-purchases/releases.

## @sentry/react-native

- **Version**: bundled. ~6.x on SDK 52–53, ~7.x on SDK 54–57. npm latest is **8.x**, a major the SDKs up to 57 don't pin.
- **Pitfalls**:
  - Use the Expo config plugin `@sentry/react-native/expo` in `plugins`, and `getSentryExpoConfig` from `@sentry/react-native/metro` in `metro.config.js`.
  - Old setups that use `sentry-expo` (deprecated) must be migrated.
  - Going to Sentry 8 manually: read https://docs.sentry.io/platforms/react-native/migration/ first. It is a separate change, not part of the SDK step.
  - Source-map upload runs in EAS Build. Check that `SENTRY_AUTH_TOKEN` is still set in the EAS env.
- **Check**: https://docs.sentry.io/platforms/react-native/manual-setup/expo/.

## @stripe/stripe-react-native

- **Version**: bundled. 0.64.0 on SDK 56–57; npm latest is 0.81.
- **Pitfalls**:
  - Configure it through the config plugin (`merchantIdentifier`, `enableGooglePay`).
  - The native Stripe SDKs raise iOS minimums, which is why the SDK pin matters. Don't jump ahead of it.
  - Test Apple Pay / Google Pay and 3DS on a device.
- **Check**: https://docs.expo.dev/versions/latest/sdk/stripe/ and https://github.com/stripe/stripe-react-native/releases.

## react-native-svg

- **Version**: bundled (15.x on every SDK).
- **Pitfalls**:
  - With `react-native-svg-transformer`, keep its Metro config (`babelTransformerPath`, `assetExts`/`sourceExts`) when you edit or remove `metro.config.js`.
  - heroui-native peers on `^15.12.1`, which is SDK 54+.
- **Check**: https://github.com/software-mansion/react-native-svg/releases.

## lottie-react-native

- **Version**: bundled (~7.3.x on SDK 54–57).
- **Pitfall**: npm latest 7.5.0 declares `react-native >= 0.84` and `react >= 19.2`, so it is incompatible with SDK 55 (RN 0.83). Stay on `npx expo install`. 8.0 is an RC.
- **Check**: https://github.com/lottie-react-native/lottie-react-native/releases.

## NativeWind / Uniwind / Tailwind

None of these are bundled, so they are chosen manually. They affect `babel.config.js`, `metro.config.js` and `global.css`.

- **NativeWind v4** (npm latest 4.2.x):
  - Pairs with **Tailwind CSS 3.x** (peer `tailwindcss >3.3.0`).
  - Setup: `jsxImportSource: "nativewind"` in `babel-preset-expo` plus the `nativewind/babel` preset, and `withNativeWind(config, { input: './global.css' })` in Metro.
  - When you edit babel or Metro during an upgrade, keep these entries.
- **NativeWind v5** is a prerelease (`5.0.0-rc.0`). It moves to Tailwind 4 and `react-native-css` (peer `@expo/metro-config >=54`, RN ≥ 0.81). It is a separate migration; don't combine it with an SDK step.
- **Uniwind** (1.x):
  - Needs Tailwind **4**, React ≥ 19 and RN ≥ 0.81, so SDK 54 or later.
  - Configured via `withUniwindConfig` in `metro.config.js` **(verify the current helper name in the Uniwind docs)**.
- **Pitfalls**:
  - Don't upgrade `tailwindcss` from 3 to 4 with NativeWind v4.
  - After an SDK step, run `npx expo start --clear`, because CSS transform caches go stale.
  - `autoprefixer` is unnecessary on SDK 53+.
- **Check**: https://www.nativewind.dev/ and https://docs.uniwind.dev/quickstart.

## heroui-native

- **Version**: manual (1.0.x).
- **Peers**:
  - `react >=19`, `react-native >=0.81`
  - `react-native-reanimated ^4.1.1`, `react-native-worklets >=0.5.1`
  - `react-native-gesture-handler ^2.28.0`
  - `@gorhom/bottom-sheet ^5.2.9`
  - `react-native-svg ^15.12.1`
  - `react-native-safe-area-context ^5.6.0`
  - `expo-blur`, `react-native-screens >=4`
  - `tailwind-variants ^3.2.2`, `tailwind-merge ^3.4.0`
- **This means SDK 54 or later.** A Reanimated 3 app (SDK ≤ 53) must upgrade first.
- **Pitfalls**:
  - It is styled through Uniwind/Tailwind 4, so the Uniwind rules above apply.
  - A gesture-handler 3.x upgrade would conflict with the `^2.28.0` peer.
- **Check**: `npm view heroui-native peerDependencies` and https://github.com/heroui-inc/heroui-native/releases. See also this plugin's `heroui` skill.

## react-native-maps

- **Version**: bundled (1.27.2 on SDK 55–57).
- **Pitfalls**:
  - Google Maps needs an API key via the app config (`android.config.googleMaps.apiKey`, plus iOS if you use Google provider) or the library's config plugin **(verify the current plugin form)**.
  - Google Maps was removed from Expo Go on Android in SDK 53, so test in a dev build.
  - Alternative: `expo-maps` (alpha at SDK 53; it needed iOS 17).
- **Check**: https://docs.expo.dev/versions/latest/sdk/map-view/ and https://github.com/react-native-maps/react-native-maps/releases.

## @react-native-firebase/*

- **Version**: manual (latest v26). All `@react-native-firebase/*` packages **must share the exact same version** as `@react-native-firebase/app`.
- **Pitfalls**:
  - iOS needs `expo-build-properties` → `ios.useFrameworks: "static"`.
  - With `use_frameworks!`, RN can't use the precompiled iOS XCFrameworks (SDK 54+), so builds are slower.
  - Add the config plugins `@react-native-firebase/app` (and `/crashlytics`, `/auth`, … when needed). `google-services.json` and `GoogleService-Info.plist` are referenced in the app config.
  - Metro `exports` issues were seen with the `@firebase/*` JS SDK on SDK 53, which is a different package.
  - Newer RNFB majors deprecate the namespaced API in favour of the modular API **(verify for the target version)**.
- **Check**: https://rnfirebase.io/#expo and https://github.com/invertase/react-native-firebase/releases.

## expo-dev-client

- **Version**: bundled, and it always moves with the SDK (`~57.0.x` on SDK 57).
- **Pitfalls**:
  - **Every SDK step needs a new dev-client build.** The old one fails with "native module not found" or version-mismatch errors.
  - With EAS, build the `development` profile again. Don't reuse the previous one.
  - SDK 57's dev launcher can auto-launch the recent project.
- **Check**: `npx expo install --check`, and confirm the dev-client build date is later than the SDK commit.

---

## Quick per-library triage (copy into the plan)

| Library | Bundled? | Target version | Peers OK? | New Arch OK? | Patch present? | Needs rebuild | Status |
|---|---|---|---|---|---|---|---|
| … | yes/no | from `bundledNativeModules` or release notes | `npm view … peerDependencies` | directory / README | `patches/…` | yes/no | ok / blocker / decision |
