# iOS privacy manifest (PrivacyInfo.xcprivacy) in Expo apps

Sources (verified 2026-10-07):
- Expo guide: https://docs.expo.dev/guides/apple-privacy/
- Expo config plugin source (merge logic): https://github.com/expo/expo/blob/main/packages/@expo/config-plugins/src/ios/PrivacyInfo.ts
- React Native pod aggregation: https://github.com/facebook/react-native/blob/main/packages/react-native/scripts/cocoapods/privacy_manifest_utils.rb
- Apple privacy manifest files: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- Apple required reason API: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- Apple collected data keys: https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests
- Apple SDKs requiring a manifest + signature: https://developer.apple.com/support/third-party-SDK-requirements/

## 1. What the manifest contains

A property list named exactly `PrivacyInfo.xcprivacy` in the app bundle (and in each SDK bundle). Top-level keys:

| Key | Type | Meaning |
|---|---|---|
| `NSPrivacyTracking` | Boolean | The app/SDK uses data for tracking as defined by ATT. If `true`, `NSPrivacyTrackingDomains` must be provided. |
| `NSPrivacyTrackingDomains` | [String] | Domains that engage in tracking. **iOS blocks requests to them until the user grants ATT.** Non-empty requires `NSPrivacyTracking: true` (else ITMS-91064). |
| `NSPrivacyCollectedDataTypes` | [Dict] | Each dict: `NSPrivacyCollectedDataType` (e.g. `NSPrivacyCollectedDataTypeEmailAddress`), `NSPrivacyCollectedDataTypeLinked` (Bool), `NSPrivacyCollectedDataTypeTracking` (Bool), `NSPrivacyCollectedDataTypePurposes` ([String], e.g. `NSPrivacyCollectedDataTypePurposeAppFunctionality`). Constants are listed in `data-types.md`. Use only Apple's constants, or Xcode's privacy report breaks. |
| `NSPrivacyAccessedAPITypes` | [Dict] | Each dict: `NSPrivacyAccessedAPIType` (category) + `NSPrivacyAccessedAPITypeReasons` ([reason codes]). |

Collected data types in the manifest feed Xcode's **privacy report** (Product → Archive → Organizer → right-click the archive → *Generate Privacy Report*). They do **not** fill App Store Connect for you, and App Store Connect remains the legal declaration. Required-reason declarations, however, are enforced at upload.

## 2. Expo config: `expo.ios.privacyManifests`

All four keys are accepted (typed in `@expo/config-plugins` `PrivacyInfo`). Example for a typical Expo app with an account and Sentry:

```json
{
  "expo": {
    "ios": {
      "privacyManifests": {
        "NSPrivacyTracking": false,
        "NSPrivacyTrackingDomains": [],
        "NSPrivacyAccessedAPITypes": [
          { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"] },
          { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp", "NSPrivacyAccessedAPITypeReasons": ["C617.1", "0A2A.1", "3B52.1"] },
          { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime", "NSPrivacyAccessedAPITypeReasons": ["35F9.1"] },
          { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryDiskSpace", "NSPrivacyAccessedAPITypeReasons": ["E174.1", "85F4.1"] }
        ],
        "NSPrivacyCollectedDataTypes": [
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeEmailAddress",
            "NSPrivacyCollectedDataTypeLinked": true,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
          },
          {
            "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeCrashData",
            "NSPrivacyCollectedDataTypeLinked": false,
            "NSPrivacyCollectedDataTypeTracking": false,
            "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
          }
        ]
      }
    }
  }
}
```

Only declare `0A2A.1` / `3B52.1` / `E174.1` / `85F4.1` if a dependency in the app actually needs them (here: `expo-file-system`). Copy reasons from the dependency's own manifest; don't invent them.

## 3. How the final file is produced (CNG / prebuild / EAS)

1. **Config plugin (`withPrivacyInfo`)** runs during `npx expo prebuild` (and in EAS Build for CNG projects). It writes `ios/<ProjectName>/PrivacyInfo.xcprivacy`, **merging** into any existing file: API types are merged per category (reasons unioned), collected data types per type (purposes unioned), tracking domains unioned, and `NSPrivacyTracking` is taken from config when set. It adds the file to the app target's resources.
2. **CocoaPods aggregation** (`pod install`, which prebuild and EAS run): React Native's `privacy_manifest_utils.rb` reads the `PrivacyInfo.xcprivacy` from every pod **resource bundle**. It also adds RN core's own reasons (`FileTimestamp C617.1`, `UserDefaults CA92.1`, `SystemBootTime 35F9.1`) and appends all `NSPrivacyAccessedAPITypes` into the app's manifest. Expo templates enable it through `Podfile.properties.json` → `apple.privacyManifestAggregationEnabled` (default `true`; set with `expo-build-properties` → `ios.privacyManifestAggregationEnabled`).
   - Aggregation copies **only required-reason APIs**, not collected data types or tracking domains.
   - Pods that don't ship a manifest, or ship it outside a resource bundle, are not aggregated. Expo's guide warns that Apple does not correctly parse all manifests from static CocoaPods dependencies, so copy their reasons into `ios.privacyManifests`.
3. **Non-CNG projects** (committed `ios/`): `ios.privacyManifests` is ignored unless you run prebuild. Edit `ios/<ProjectName>/PrivacyInfo.xcprivacy` in Xcode.

## 4. Verifying the merged manifest

```sh
npx expo prebuild --platform ios --clean      # runs config plugins + pod install
plutil -p ios/*/PrivacyInfo.xcprivacy         # macOS: pretty-print
# or, cross-platform:
cat ios/<ProjectName>/PrivacyInfo.xcprivacy
grep -A3 NSPrivacyAccessedAPIType ios/<ProjectName>/PrivacyInfo.xcprivacy
```

Check that:
- every category from your dependencies' manifests (`find node_modules -name PrivacyInfo.xcprivacy -path '*ios*'`) is present with its reasons
- `NSPrivacyTracking` matches your ATT usage
- the file is listed under the app target → Build Phases → Copy Bundle Resources

**EAS Build:** the same steps run on the build worker. To inspect, run `npx expo prebuild` locally with the same profile env, or download the build artifact (`.ipa`), unzip it, and read `Payload/<App>.app/PrivacyInfo.xcprivacy` (plus `Payload/<App>.app/*.bundle/PrivacyInfo.xcprivacy` and `Frameworks/*.framework/PrivacyInfo.xcprivacy` for SDKs). The Xcode privacy report on an archive shows the aggregated view. The definitive test is an upload to App Store Connect/TestFlight: Apple emails missing reasons within minutes.

## 5. Required-reason APIs: categories and approved reasons

| Category (`NSPrivacyAccessedAPIType`) | Code | Use it when… |
|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | Read/write info accessible only to the app itself (most apps, RN core, AsyncStorage-like usage) |
| | `1C8F.1` | Shared within the same App Group (widgets, extensions) |
| | `C56D.1` | Third-party SDK wrapper around UserDefaults (SDKs only) |
| | `AC6B.1` | MDM managed config (`com.apple.configuration.managed` / `com.apple.feedback.managed`) |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `DDA9.1` | Display file timestamps to the user (not sent off device) |
| | `C617.1` | Timestamps/size/metadata of files inside the app container, app group or CloudKit container |
| | `3B52.1` | Metadata of files the user explicitly granted (document picker) |
| | `0A2A.1` | Third-party SDK wrapper (SDKs only) |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | Measure elapsed time between in-app events / timers (elapsed time may be sent off device) |
| | `8FFB.1` | Compute absolute timestamps for in-app events (UIKit/AVFAudio) |
| | `3D61.1` | Include boot time in an optional, user-submitted bug report |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `85F4.1` | Display disk space to the user |
| | `E174.1` | Check there is enough space to write files, or clean up when low (observable behavior) |
| | `7D9E.1` | Include disk space in an optional, user-submitted bug report |
| | `B728.1` | Health research app warning participants about low disk space |
| `NSPrivacyAccessedAPICategoryActiveKeyboards` | `3EC4.1` | The app is a custom keyboard |
| | `54BD.1` | Customize UI based on active keyboards (app has text fields, observable behavior) |

Data accessed under these reasons may not be used for tracking or fingerprinting. Most reasons forbid sending the value off device.

## 6. What typical Expo / RN apps need

The values come from the packages' own manifests on `main` (check `node_modules/<pkg>/ios/PrivacyInfo.xcprivacy` for the installed version):

| Source | Category: reasons |
|---|---|
| React Native core (added by aggregation) | UserDefaults `CA92.1`, FileTimestamp `C617.1`, SystemBootTime `35F9.1` |
| `expo-constants`, `expo-notifications`, `expo-localization`, `expo-eas-client` (via `expo-updates`) | UserDefaults `CA92.1` |
| `expo-application` | FileTimestamp `C617.1` |
| `expo-device` | SystemBootTime `35F9.1` |
| `expo-file-system` | FileTimestamp `0A2A.1`, `3B52.1`; DiskSpace `E174.1`, `85F4.1` |
| `@react-native-async-storage/async-storage` | FileTimestamp `C617.1` |
| `react-native-device-info` | SystemBootTime `35F9.1`, UserDefaults `CA92.1`, FileTimestamp `C617.1`, DiskSpace `85F4.1` |
| `react-native-mmkv` | No manifest in the RN package. The MMKV core pod's manifest is unverified. If Apple flags it, add UserDefaults/FileTimestamp reasons per Apple's email |
| App Groups / widgets (`expo-apple-targets`, shared `UserDefaults(suiteName:)`) | UserDefaults `1C8F.1` |
| Third-party SDKs (Sentry, Firebase, RevenueCat, OneSignal, Branch, Adjust, AppsFlyer…) | Ship their own manifests in current versions. Upgrade first, then copy any reasons Apple still reports |

A safe baseline for most Expo apps is UserDefaults `CA92.1`, FileTimestamp `C617.1`, SystemBootTime `35F9.1`, plus `expo-file-system`'s reasons when it is installed (it is a dependency of many Expo packages).

## 7. App Store Connect upload errors

| Code | Message (abridged) | Fix |
|---|---|---|
| ITMS-91053 | "Missing API declaration – Your app's code in the file … references one or more APIs that require reasons, including NSPrivacyAccessedAPICategory…" | Add the category + a fitting reason to `ios.privacyManifests` (or upgrade the SDK named in the path), then prebuild and rebuild. Since May 1, 2024 such uploads are rejected, not just warned. |
| ITMS-91054 | Invalid API category declaration | Typo or unknown `NSPrivacyAccessedAPIType` value. Use the exact strings from §5. |
| ITMS-91055 | Invalid API reason declaration | Reason code doesn't belong to that category (e.g. `CA92.1` under FileTimestamp). |
| ITMS-91056 | Invalid privacy manifest | Malformed plist or wrong key types (e.g. reasons not an array, Boolean as string). |
| ITMS-91061 | Missing privacy manifest – a "commonly used third-party SDK" (e.g. `hermes`, `FirebaseCore`, `FBSDKCoreKit`, `OneSignal`, `SDWebImage`, `Lottie`, `GoogleSignIn`) has no manifest | Upgrade Expo SDK / RN / the SDK to a version that ships one. App-level config can't fix a missing SDK manifest. Applies to new apps and updates that add the SDK. |
| ITMS-91064 | Invalid tracking information | `NSPrivacyTrackingDomains` non-empty while `NSPrivacyTracking` is false (or invalid domains). |
| ITMS-91065 | Missing signature (for binary SDKs on Apple's list) | Use a signed XCFramework release from the vendor. *Code name per Apple emails; not in Apple's docs.* |

Also check the related rejections that aren't manifest errors: Guideline 5.1.1 (missing or vague `NS…UsageDescription`) and 5.1.2 (tracking without ATT, or ATT prompt content).
