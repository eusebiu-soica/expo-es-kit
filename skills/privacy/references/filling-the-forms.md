# Filling the store forms

How to turn the privacy inventory (one row per data type: Apple id, Google id, collected, linked, tracking, shared, ephemeral, optional, purposes, evidence) into the App Store Connect and Play Console answers. Ids are defined in `data-types.md`.

Sources:
- App Store Connect, manage app privacy: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
- Apple App Privacy Details: https://developer.apple.com/app-store/app-privacy-details/
- Apple User Privacy and Data Use (ATT): https://developer.apple.com/app-store/user-privacy-and-data-use/
- Apple account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Google Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Google account deletion: https://support.google.com/googleplay/android-developer/answer/13327111

## 1. App Store Connect: App Privacy

**Who:** Account Holder, Admin or App Manager answer the questions. Marketing can also edit the privacy policy URL.
**Where:** Apps → *your app* → sidebar **App Privacy** → **Get Started** (or **Edit** next to *Data Types*).
**Timing:** answers can change at any time without an app update. The privacy policy URL ships with the next version.

### Q1. "Do you or your third-party partners collect data from your app?"

- **No** only when every inventory row is "not collected". That means data stays on device, is processed in real time and not retained, or meets *all four* optional-disclosure criteria.
- Any crash reporter, analytics SDK, push token stored on a server, or account system means **Yes**.
- "Third-party partners" includes every SDK whose code is in the binary. Ask "is it initialized in production?", not "do we look at its dashboard?".

### Q2. Select data types

Tick every Apple id with `collected: true` across all platforms the app ships on. Apple asks you to answer "in the most comprehensive and inclusive way" if collection differs by platform, user type, region or opt-in.

### Q3. Per data type (click each one)

1. **"How is [type] used?"** Tick the Apple purposes from the inventory (`third_party_advertising`, `developer_advertising`, `analytics`, `product_personalization`, `app_functionality`, `other_purposes`). Union across all collectors: if your backend stores the email for login (App Functionality) and you also pass it to Customer.io for newsletters, tick **Developer's Advertising or Marketing** as well.
2. **"Is [type] linked to the user's identity?"** Yes if any collector links it. That means stored with a user id/account or email, sent to an SDK after `identify()`/`setUser()`/`logIn()`, or tied to a stable device id that you can join to an account. "Not linked" needs de-identification *before* collection and no re-linking afterwards.
3. **"Do you or your third-party partners use [type] for tracking purposes?"** Yes if it is combined with third-party data for targeted ads or ad measurement, or shared with a data broker. This includes an SDK that does so on its own (ad networks, attribution SDKs, Facebook SDK with advertiser tracking on).

### Q4. Privacy Policy URL (required), User Privacy Choices URL (optional)

The Choices URL is a good place for a data-access and deletion page.

### Q5. Preview and Publish

Check **Product Page Preview → See Details**. The page groups types into **Data Used to Track You**, **Data Linked to You** and **Data Not Linked to You**. Compare that with the report's 3-group summary, then click **Publish**.

## 2. Play Console: Data safety

**Where:** Play Console → *your app* → **Policy and programs → App content** → **Data safety** → **Start**/**Manage**. Steps: Overview → Data collection and security → Data types → Data usage and handling → Store listing preview → Submit. **Export to CSV / Import from CSV** is at the top right. Importing overwrites everything already entered.

### Data collection and security

| Question | How to answer from the inventory |
|---|---|
| "Does your app collect or share any of the required user data types?" | Yes if any row has Google `collected` or `shared` true. Ephemeral-only data still counts as collected for this question if it is a listed type. |
| "Is all of the user data collected by your app encrypted in transit?" | Yes only if every endpoint (your API, Supabase, every SDK) is HTTPS/TLS. The scan's `signals.httpsOnly: false`, `usesCleartextTraffic`, or `http://` endpoints mean No, or fix them first. |
| "Which methods of account creation does your app support?" (username/password, OAuth, other, or "my app does not allow users to create an account"; labels may vary) | From the auth signals: Supabase/Clerk/Auth0/Firebase Auth, Sign in with Apple/Google, magic links/OTP. |
| "Delete account URL" | Required when the app lets users create an account. A public page naming the app/developer, with prominent account-deletion steps or a request form. Not the privacy policy front page. |
| "Do you provide a way for users to request that their data is deleted?" | Yes if there is a mechanism (in-app, email, form) or automatic deletion/anonymization within 90 days. |

### Data types

Tick every Google id that is collected **or** shared.

### Data usage and handling (per type)

| Question | Rule |
|---|---|
| "Is this data collected, shared, or both?" | **Collected** = it leaves the device (to you or an SDK). **Shared** = transferred to a third party that is *not* your service provider (ad networks, attribution partners using data for their own purposes, data brokers, a partner you sell or give data to). Data sent to a processor that only works for you (Sentry, Supabase, RevenueCat, most analytics vendors under a DPA) is collected, not shared. |
| "Is this data processed ephemerally?" | Yes only if it is held in memory and never stored beyond servicing the request (e.g. a photo sent to an API for one-off processing and discarded). Logs, databases and SDK dashboards mean No. |
| "Is this data required for your app, or can users choose whether it's collected?" | Optional only if all users can use the app without it, opt in or out, or provide it manually. Crash/analytics SDKs that run by default are **required** unless there is an opt-out. |
| "Why is this user data collected?" / "Why is this user data shared?" | Google purposes. Answer separately for collected and for shared. |

## 3. Deriving answers from the report

1. Start with `schemaData` (the developer's own tables). Each column match is **collected, linked** (if the row has a user FK), purpose usually `app_functionality` (+ Google `account_management` for profile/auth fields). Not shared, unless the backend forwards it.
2. Add each SDK's catalog `data[]` rows whose `condition` holds:
   - `always`: include.
   - `if-enabled`: check the init config (session replay, IP capture, `sendDefaultPii`, ads, location tracking).
   - `if-user-identified`: include when `identify`/`setUser`/`logIn` is called. This also flips `linked` to true.
3. Add permission rows only when the data leaves the device (upload, API call, analytics property).
4. Merge rows with the same id: OR the flags, union the purposes. For Google, track shared per recipient.
5. Mark anything resting on an assumption as **Confirm** with a concrete question.

## 4. Common mistakes (each one has caused rejections or policy strikes)

- **Forgetting diagnostics from crash SDKs.** Sentry, Bugsnag, Crashlytics, Datadog and LogRocket all mean `crash_data` (+ `performance_data` with tracing) on Apple, `crash_logs` (+ `diagnostics`) on Google. Sentry's `setUser({ id })` makes it **linked**.
- **"Not linked" while sending a user id.** Any SDK that receives `identify(userId)`, `setUserId`, `Purchases.logIn` or an email has linked data. The same goes for a device id that your backend maps to an account.
- **"It's only our backend, so it's not collected."** Wrong on both stores. Your own server storing data is collection. Only *sharing* is about third parties.
- **Misusing the ephemeral exemption.** It applies only to data never stored in readable form beyond the request. Request logs that keep the IP address, analytics events and queued jobs are not ephemeral. Apple has the same rule: an auth token or IP sent and not retained is not collected.
- **Treating every SDK as "shared" on Google, or none.** A vendor acting only on your instructions (processor/service provider) means **collected, not shared**. An SDK that uses the data for its own purposes (ad networks, Facebook, attribution networks feeding ad partners) means **shared**.
- **Missing the account-deletion requirements.** Apple Guideline 5.1.1(v) requires in-app deletion of the account (not just deactivation) when the app supports account creation. Google requires an in-app path **and** a web URL in the Data safety form.
- **Payment info.** Apple exempts payment info only when it is "entered outside your app" and you never have access, e.g. an Apple Pay sheet or an external web checkout. Card fields rendered inside the app by an SDK (Stripe PaymentSheet/CardField) are collected by a third-party partner: declare `payment_info` (Stripe's own manifest does). On Google it is `user_payment_info`, collected and not shared, because Stripe processes it for you. The Stripe customer id and charge history in your DB *are* `purchase_history` (and possibly `user_id`).
- **IAP purchases** (RevenueCat, StoreKit receipts stored server-side) are `purchase_history`, linked once `logIn(appUserId)` is called.
- **Push tokens** stored server-side (Expo push token, FCM/APNs token) are `device_id` / `device_or_other_ids`, linked when stored with the user, purpose `app_functionality` (+ Google `developer_communications` for news pushes).
- **IP addresses** kept in logs or analytics: Apple says declare by use (coarse location, device ID or diagnostics). Google says declare location if used to derive location. Many analytics SDKs geolocate the IP server-side, so declare `coarse_location` / `approximate_location`.
- **Free-text fields.** Declare `other_user_content` / `other_user_generated_content`, not every type a user *might* type. If the field asks for something specific (phone, address), declare that type.
- **Web views** that load your own pages with analytics: that collection counts too.
- **Sign in with Apple / Google:** the email and name you receive and store are collected and linked. The relay email is still an email address.
- **Children / Families:** Google's Families policy and Apple's Kids category forbid most third-party analytics and ads. Flag them, don't just declare them.
- **Inconsistent answers between stores.** Reviewers compare them. Same data, same flags, unless the platforms really differ.
- **Optional disclosure misuse.** Only *infrequent, optional, non-primary*, user-submitted data with the user's name displayed qualifies, and all 4 criteria must hold. Sign-up data never qualifies.

## 5. ATT and "tracking"

- If any Apple row has `tracking: true` or any SDK has `requiresATT: true` / reads the IDFA, the app **must** show the ATT prompt (`expo-tracking-transparency`, `requestTrackingPermissionsAsync`) *before* tracking. It also needs `NSUserTrackingUsageDescription` (config plugin option `userTrackingPermission`).
- Without permission the IDFA is all zeros, and you may not track by other means. Fingerprinting is banned either way.
- You may not gate features on the ATT answer or incentivize acceptance (Guideline 5.1.2(i)).
- The label must still show the tracking data types. ATT does not remove them; the label describes what happens when the user allows tracking.
- Tracking SDKs should send their tracking traffic to domains listed in `NSPrivacyTracking` / `NSPrivacyTrackingDomains`. iOS blocks those domains until ATT is granted (see `privacy-manifest.md`).
- The reverse mistake: an ATT prompt with no tracking at all. Reviewers may ask why, and it adds friction. Remove the prompt if nothing tracks.
- Developers are responsible for SDK behavior: "Placing a third-party SDK in your app that combines user data … with other developers' apps … even if you don't use the SDK for these purposes" is tracking.
- Google has no ATT equivalent, but the advertising ID needs the `com.google.android.gms.permission.AD_ID` permission (Android 13+, apps targeting API 33+). Declare `device_or_other_ids` with `advertising_or_marketing`. Apps not using ads should remove `AD_ID` (e.g. `android.blockedPermissions`).

## 6. Final checklist before publishing

- [ ] Every installed and initialized SDK appears in the inventory or is explicitly marked "collects nothing".
- [ ] Every DB table with user data is mapped.
- [ ] Linked flags match `identify`/`setUser` usage.
- [ ] Tracking answers match the ATT prompt and `NSPrivacyTracking`.
- [ ] The Google "shared" flags were reviewed against each vendor's processor terms.
- [ ] Privacy policy URL is live on both stores and inside the app.
- [ ] Account deletion works in-app, and the Google delete-account URL is set.
- [ ] The answers are saved in `privacy-answers.json` to diff on the next release.
