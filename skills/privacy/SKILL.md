---
name: privacy
description: "Generate the App Store \"App Privacy\" (privacy nutrition label) answers and the Google Play \"Data safety\" answers for an Expo / React Native app, from evidence — installed SDKs, permissions, code, the app's own database schema and backend — and check the iOS privacy manifest (required-reason APIs, tracking, usage strings, ATT, account deletion). Outputs copy-ready answers per data type with the evidence behind each one, plus inconsistencies that cause store rejections. Use when the user prepares a store submission, asks about privacy labels, data safety form, privacy manifest, ITMS-91053, ATT, or \"what data does my app collect\"."
argument-hint: "[appPath] [--api=<apiRepoPath>] [--out=<dir>]"
---

# expo-es-kit · privacy

You produce **evidence-backed** answers for two store forms and a privacy-manifest check. These answers go into legal declarations. So:

- Every "collected" answer cites evidence.
- Every uncertain item is marked **"Confirm"** with the exact question the developer must answer.
- When in doubt, declare. Under-declaring is the costly mistake.

## 0. Setup

- `PLUGIN_ROOT` is two levels above this SKILL.md. If unknown, run `find ~/.claude/plugins -type f -path '*expo-es-kit*/scripts/scan.mjs' | head -1` and strip `/scripts/scan.mjs`.
- Read these references in `PLUGIN_ROOT/skills/privacy/references/`:

| File | What it gives you |
|---|---|
| `data-types.md` | The official Apple/Google data types, purposes and definitions, and the id mapping |
| `filling-the-forms.md` | The forms question by question, and common mistakes |
| `privacy-manifest.md` | Expo `ios.privacyManifests` and required-reason APIs |

- Run `node "$PLUGIN_ROOT/scripts/privacy-scan.mjs" <app> [--api=<api>] > "$TMP/privacy.json"` and read it. It reports:
  - matched SDKs, with their catalog data
  - declared vs used permissions
  - data types inferred from DB columns (schema keywords)
  - signals: account creation/deletion, ATT, advertising IDs, analytics identify, privacy policy link
  - the current manifest
- If the backend lives in another repo and `--api` is missing, ask for it. The backend's tables are where most "collected" data is stored.

## 1. Build the data inventory

Use 4 sources. For each one, **read the code** to confirm what the scan suggests:

1. **The app's own backend.** Look at the sign-up and profile forms, the tables the scan found in `schemaData`, and uploads (photos, files, audio).
   - Everything the user enters and you store counts as **collected**. That includes email, name, phone, photos, messages and health/fitness data.
   - Note whether each item is **linked to the user's identity**. It almost always is when it sits in a row with a `user_id`.
2. **Third-party SDKs** (`sdks`). Start from each catalog entry, then check the actual configuration:
   - Is the SDK initialized?
   - Is the user identified (`analyticsIdentify` signal; `setUser` / `identify` / `logIn` calls)?
   - Are session replay, IP collection or ads features enabled?
   - The catalog's `condition` field tells you what to check.
   - Ignore dev-only packages that aren't imported in app code.
3. **Permissions** (`permissions`). For each permission, follow the data to where it goes:
   - Data used only on the device and never sent anywhere is **not collected**. Examples: a photo cropped locally and never uploaded, biometrics.
   - Data that is sent anywhere **is collected**.
4. **Device and diagnostics.** Crash reports, performance traces, push tokens, device IDs, IP addresses (in logs or rate limiting), and purchase history (RevenueCat/StoreKit).

For each data type, record the following:

- Apple id and Google id (from `data-types.md`)
- collected? linked? used for tracking?
- purposes (Apple ids; Google ids where they differ)
- Google **shared?** (sent to a third party that is not acting as your service provider)
- optional or required
- evidence (`file:line` or the SDK and its config)
- a confidence note

## 2. Cross-checks: rejection risks

Report every problem you find as `Severity | Issue | Evidence | Fix`. Check for:

- A permission used in code without an iOS usage description (rejection), or an empty or generic description.
- Usage strings or Android permissions declared for features the app doesn't use. Remove them, or block them via `android.blockedPermissions`.
- A tracking SDK, IDFA access, or `NSPrivacyTracking: true` without an ATT prompt (`expo-tracking-transparency`). The reverse is also a problem: an ATT prompt with nothing that tracks.
- Account creation without in-app account deletion (App Store 5.1.1(v)). On Google Play, a missing deletion URL or mechanism.
- No privacy policy link in the app or in the store listing.
- Required-reason API categories that the app or its SDKs likely use but that are missing from `ios.privacyManifests`, or that use a reason code which doesn't fit. Use `manifest.requiredReasonCandidates` and verify against `privacy-manifest.md`.
- Data sent over cleartext (`signals.httpsOnly` is false). Google asks whether data is encrypted in transit.
- Declared "not linked" while the SDK is given a user id.

## 3. Write the outputs

Ask once before writing. The default directory is `docs/store/` in the app.

1. **`app-privacy-ios.md`** follows the App Store Connect flow.
   - Q1: "Do you or your third-party partners collect data from this app?"
   - Then one table per data type: `Data type | Collected | Linked to user | Used for tracking | Purposes | Evidence`.
   - Then the summary label exactly as Apple shows it: *Data Used to Track You*, *Data Linked to You*, *Data Not Linked to You*.
2. **`data-safety-android.md`** follows the Play Console flow.
   - Data collection and security questions: collected or shared, encrypted in transit, deletion requests, account-deletion URL.
   - Then one table per data type: `Data type | Collected | Shared | Ephemeral | Required/Optional | Purposes | Evidence`.
3. **`privacy-manifest.md`**:
   - the current vs proposed `ios.privacyManifests` block for `app.json`, as a diff
   - which SDKs ship their own manifests
   - how to verify the merged `PrivacyInfo.xcprivacy` after `npx expo prebuild` or in an EAS build
4. **`privacy-findings.md`** holds the cross-check table from step 2, plus a **"Confirm"** list: the open questions only the developer can answer. Examples: "Is Sentry session replay enabled in production?" and "Do you share emails with your email-marketing provider?".

Also save `privacy-answers.json` with the inventory, so the answers can be diffed when the app changes.

**Terminal summary:**

- the iOS label summary, as 3 groups
- the Android collected/shared counts
- the top rejection risks
- the Confirm questions
- the paths of the written files

## Rules

- Never fill the forms from the catalog alone. A catalog entry is a starting point, and the app's configuration decides.
- The developer's own server storing data **is** collection, on both stores.
- Don't give legal advice. Say: "These answers reflect what the code shows. You are responsible for the final declarations. Review them with whoever owns privacy and legal for the app."
- Offer to apply the `app.json` changes (usage strings, `blockedPermissions`, `privacyManifests`) as a separate, confirmed step. Never touch native folders.
