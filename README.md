<div align="center">

# 🛡️ expo-es-kit

**Build and audit production-ready Expo & React Native apps with Claude Code.**

Scored multi-agent audits · verified fixes · per-folder agent rules · backend & auth security · store privacy forms · SDK upgrades · HeroUI Native

[![Version](https://img.shields.io/badge/version-0.2.0-blue?style=flat-square)](CHANGELOG.md)
[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-plugin-D97757?style=flat-square&logo=anthropic&logoColor=white)](https://code.claude.com/docs/en/plugins)
[![Expo](https://img.shields.io/badge/Expo-SDK_54%2B-000020?style=flat-square&logo=expo&logoColor=white)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React_Native-0.81%2B-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactnative.dev)
[![Supabase](https://img.shields.io/badge/Supabase-ready-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](#-contributing)
[![GitHub stars](https://img.shields.io/github/stars/eusebiu-soica/expo-es-kit?style=flat-square&logo=github)](https://github.com/eusebiu-soica/expo-es-kit/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/eusebiu-soica/expo-es-kit?style=flat-square)](https://github.com/eusebiu-soica/expo-es-kit/commits)

[Quick start](#-quick-start) · [Commands](#-commands) · [Audit](#-audit) · [Fix](#-fix) · [Setup](#-setup) · [Backend](#-backend) · [Foundation](#-foundation) · [HeroUI](#-heroui) · [Privacy](#-privacy) · [Upgrade](#-upgrade) · [History](#-history) · [FAQ](#-faq--troubleshooting)

</div>

---

## Table of contents

- [Why expo-es-kit](#-why-expo-es-kit)
- [Quick start](#-quick-start)
- [Requirements](#-requirements)
- [Commands](#-commands)
- [Audit](#-audit)
- [Fix](#-fix)
- [Setup (agent instructions)](#-setup)
- [Backend & auth](#-backend)
- [Foundation](#-foundation)
- [HeroUI Native](#-heroui)
- [Store privacy forms](#-privacy)
- [SDK upgrade](#-upgrade)
- [Audit history & badge](#-history)
- [Guard hook](#-guard-hook)
- [Recommended workflows](#-recommended-workflows)
- [Reports & files](#-reports--files)
- [Safety & privacy](#-safety--privacy)
- [Configuration](#-configuration)
- [FAQ & troubleshooting](#-faq--troubleshooting)
- [How it works](#-how-it-works)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Why expo-es-kit

Coding agents write a lot of code fast, and they forget the rules that make a mobile app fast and safe. Typical slips:

- a token ends up in AsyncStorage
- a list renders 2,000 rows inside a `ScrollView`
- a full-size photo becomes a 60 px thumbnail
- sign-out leaves the previous user's data in the cache

**expo-es-kit gives Claude Code those rules, and checks that they are followed.**

| | |
|---|---|
| 📊 **Scored audits** | 13 categories (14 with HeroUI Native), each scored **0–10**, with evidence (`file:line`) for every finding, a **GO / NO-GO** verdict, and a trend vs your last audit. |
| 🤖 **Deep multi-agent mode** | 8 specialist auditors run in parallel. An **adversarial verifier** then tries to disprove every serious finding, so you get fewer false positives. |
| 🔁 **Fixes that prove themselves** | `fix` applies findings by priority and **always ends with a full verification**: gates, an independent re-check of each finding, a regression scan, a re-audit, and a before/after table. |
| 🧭 **Agent rules where they're needed** | Generates short per-folder `CLAUDE.md` files (components, lib, storage, data layer, routes, migrations…). It detects **stale** rules you already have. |
| 🔐 **Backend & sessions included** | Supabase direct-DB (RLS, policies, definer functions) **or** your own API (Next.js on Vercel, Supabase Edge Functions, Expo API Routes). Auth and sessions are checked end to end. |
| 🧱 **Proven foundation** | Encrypted MMKV, a SecureStore session adapter, API client with single-flight refresh, query cache, full sign-out wipe, env validation… adapted to your app. |
| 🚨 **Real-time guard** | A warn-only hook that flags dangerous code as soon as an agent writes it. |
| 🎨 **HeroUI Native** | Import strategy, sheet mounting, skeleton cost, overdraw, design-token adoption %, animations, accessibility. |
| 🏪 **Store privacy forms** | Evidence-based answers for **App Store App Privacy** and **Google Play Data safety**, plus a privacy manifest check, from your SDKs, permissions, code and DB schema. |
| ⬆️ **Safe SDK upgrades** | One major at a time, with gates and a device smoke test after each step. Patch and library compatibility checks, OTA safety. |
| 📈 **Audit history** | An offline HTML dashboard of your scores over time, plus a score badge for your README. |

How it compares:

| | Official [`expo/skills`](https://github.com/expo/skills) | Typical RN review skills | **expo-es-kit** |
|---|:---:|:---:|:---:|
| How to use Expo APIs | ✅ | ➖ | ➖ (complements it) |
| Scored audit + verdict | ❌ | ⚠️ checklist | ✅ |
| Verification pass against false positives | ❌ | ❌ | ✅ |
| Trend across audits | ❌ | ❌ | ✅ |
| MMKV / secure storage / sessions | ❌ | ⚠️ | ✅ |
| Backend: RLS **and** API security | ❌ | ❌ | ✅ |
| Applies fixes **and** re-verifies | ❌ | ❌ | ✅ |
| Generates per-folder agent rules | ❌ | ❌ | ✅ |
| Store privacy forms from code evidence | ❌ | ❌ | ✅ |
| SDK upgrade with gates per step | ✅ (`expo-upgrade`) | ❌ | ✅ (uses it when installed) |
| Score history + badge | ❌ | ❌ | ✅ |

> The patterns come from a real production Expo app. They were measured on min-spec Android devices, not copied from blog posts.

---

## 🚀 Quick start

**1. Install** (inside Claude Code):

```text
/plugin marketplace add eusebiu-soica/expo-es-kit
/plugin install expo-es-kit@expo-es-kit
```

Restart Claude Code if the commands don't appear. Check with `/plugin`; you should see `expo-es-kit` with 9 skills and 9 agents.

**2. Run your first audit** from your app's folder:

```text
/expo-es-kit:audit --quick
```

**3. Read the table, then fix the blockers:**

```text
/expo-es-kit:fix --only=P0
```

That's it. You can also just ask in plain words: *"audit my app before release"*, *"is my API secure?"*, *"set up CLAUDE.md files for my app"*.

---

## 📋 Requirements

| | |
|---|---|
| **Claude Code** | A recent version with plugin support |
| **Node.js** | **18+**, for the local scanner and the guard hook |
| **Project** | An Expo app (`expo` in `package.json`). Tested on **SDK 54**; works on any recent SDK. Bare React Native works partially (Expo-specific checks become n/a). |
| **Optional** | `git` (detects committed secrets), network access for the CLI checks (`expo-doctor`, `npm audit`) |
| **Optional** | The [Supabase plugin/MCP](https://supabase.com/docs/guides/getting-started/mcp), for live advisors during backend audits |

---

## 🧰 Commands

| Command | Purpose | Writes code? |
|---|---|:---:|
| [`/expo-es-kit:audit`](#-audit) | Scored production-readiness audit | ❌ (report only) |
| [`/expo-es-kit:fix`](#-fix) | Apply findings + full verification | ✅ after confirmation |
| [`/expo-es-kit:setup`](#-setup) | Per-folder `CLAUDE.md` agent rules | ✅ after confirmation |
| [`/expo-es-kit:backend`](#-backend) | Design / audit / implement the backend securely | `implement` only |
| [`/expo-es-kit:foundation`](#-foundation) | Scaffold the core production modules | ✅ after confirmation |
| [`/expo-es-kit:heroui`](#-heroui) | HeroUI Native audit + setup | `setup` only |
| [`/expo-es-kit:privacy`](#-privacy) | App Store App Privacy + Play Data safety answers, privacy manifest | `docs/store/` (after confirmation) |
| [`/expo-es-kit:upgrade`](#-upgrade) | Expo SDK upgrade, one verified major at a time | ✅ after confirmation |
| [`/expo-es-kit:history`](#-history) | Score dashboard (HTML) + README badge | `docs/audits/` only |

Every command that writes **shows a plan and diffs first** and **never overwrites** your files.

---

## 📊 Audit

```text
/expo-es-kit:audit [appPath] [--quick | --deep] [--api=<apiRepoPath>] [--only=<ids>] [--out=<file.md>]
```

| Option | Description |
|---|---|
| `appPath` | Folder containing the Expo `package.json`. Defaults to the current directory. |
| `--quick` | One agent with a static scan and targeted reads. **~5–15 min.** Good for weekly checks. |
| `--deep` | 8 specialist agents in parallel, then a verifier. **Much more thorough; uses many more tokens.** Use it before releases. |
| `--api=../my-api` | Also audit a separate backend repo (e.g. a Next.js project on Vercel). |
| `--only=perf,mmkv` | Audit only some categories. |
| `--out=path.md` | Custom report path. A `.json` file is written next to it. |

With no mode flag, the skill recommends one based on the app's size and asks you.

### Categories

| # | Category | ID | Weight | What it looks at |
|---|---|---|:---:|---|
| 1 | Performance | `perf` | 1.0 | Render cost, memo vs React Compiler, lists, images, animations, overdraw, sheets |
| 2 | Startup speed | `startup` | 1.0 | Splash, fonts, sync storage reads, SDK init order, cached-first rendering |
| 3 | Bundle size | `bundle` | 1.0 | Heavy libraries, barrel/root imports, dev-only code, assets |
| 4 | Caching | `caching` | 1.0 | TanStack Query defaults, persistence strategy, image and signed-URL caches |
| 5 | MMKV | `mmkv` | 1.0 | Encryption, recovery, init time, AsyncStorage on hot paths |
| 6 | Secure storage | `secure-storage` | **1.5** | Where tokens and PII live, keychain options, legacy data |
| 7 | Client security | `client-security` | **1.5** | Secrets in the bundle, `EXPO_PUBLIC_*`, logs, cleartext, WebView, deep links |
| 8 | Auth & sessions | `auth-sessions` | **1.5** | Storage, refresh, PKCE, 401 flow, sign-out wipe, account-switch races, server verification |
| 9 | Backend security | `backend` | **1.5** | RLS and policies, or API authz/IDOR, validation, rate limits, error leaks |
| 10 | Dependencies | `deps` | 1.0 | `expo-doctor`, version alignment, vulnerabilities, patches, CI gates |
| 11 | Updates | `updates` | 1.0 | SDK age, New Architecture, `expo-updates`, `runtimeVersion`, channels |
| 12 | Release readiness | `release` | 1.0 | Crash reporting, error boundaries, store compliance, account deletion, privacy |
| 13 | Agent instructions | `agent-config` | 0.5 | CLAUDE.md coverage, **staleness**, conflicting rules |
| 14 | HeroUI Native | `heroui` | 1.0 | *Only when `heroui-native` is installed* |

### Scoring and verdict

| | |
|---|---|
| **Severity** | **P0**: exploitable hole, data leak, crash on start, or store rejection. **P1**: significant issue. **P2**: hygiene. |
| **Caps** | A confirmed P0 caps its category at **4**. A confirmed P1 caps it at **7**. |
| **Status** | 🟢 8–10 · 🟡 5–7.5 · 🔴 0–4.5 · ⚪ n/a |
| **Overall** | Weighted average; the security categories count 1.5×. |
| **Verdict** | 🟥 **NO-GO** if any P0 is confirmed. 🟧 **GO WITH RISKS** if there is a P1 in a security category or the overall is below 7. 🟩 **GO** otherwise. |

The full rules are in [`shared/contract.md`](shared/contract.md).

### Example output

```text
# Expo audit — my-app
Expo 54 · RN 0.81 · expo-router · New Arch · Backend: hybrid (Supabase + Next.js API)

## Overall: 6.8 / 10 · 🟥 NO-GO · ▲ +0.9 vs 2026-09-01
Blocking: REL-001

| #  | Category           | Score | Trend  | Status | Key finding                                  | Top suggestion                              |
|----|--------------------|-------|--------|--------|----------------------------------------------|---------------------------------------------|
| 1  | Performance        | 7.5   | ▲ +1.0 | 🟡     | Profiler mounted in production screens        | Gate with __DEV__, measure p95 on min-spec  |
| 2  | Startup speed      | 7.0   | —      | 🟡     | Root returns null until fonts load            | Embed fonts via the expo-font config plugin |
| 5  | MMKV               | 8.5   | ▲ +0.5 | 🟢     | UI locale still read from AsyncStorage        | Move UI prefs to MMKV                       |
| 8  | Auth & sessions    | 7.0   | new    | 🟡     | Callback accepts raw tokens from the URL      | Accept only ?code= (PKCE)                   |
| 11 | Updates            | 4.5   | ▼ -1.0 | 🔴     | Expo SDK three majors behind                  | Upgrade one SDK at a time                   |
| 12 | Release readiness  | 3.0   | —      | 🔴     | Account deletion is a placeholder             | Server-side deletion + Settings flow        |
| …  |                    |       |        |        |                                              |                                             |

## Top 10 fixes
| # | ID       | Sev | Category      | Fix                                              | Effort | File                                   |
|---|----------|-----|---------------|--------------------------------------------------|--------|----------------------------------------|
| 1 | REL-001  | P0  | release       | Implement server-side account deletion + wipe    | M      | app/(app)/settings.tsx:510              |
| 2 | AUTH-001 | P1  | auth-sessions | Drop setSession branch; exchangeCodeForSession   | S      | lib/auth/apply-auth-callback-url.ts:31 |
```

The saved report also has a section per category with **strengths**, every finding (evidence, impact, fix and effort), and a **"What was not checked"** section, so you know the limits of each run.

Write the report in your language: ask in Romanian, and the report prose comes out in Romanian, while the code identifiers stay in English.

---

## 🔁 Fix

```text
/expo-es-kit:fix [report.json] [--only=P0 | P0,P1 | AUTH-001,BE-003 | auth-sessions] [--yes]
```

1. **Baseline**: it loads the latest audit JSON, takes a fresh scan, and runs typecheck, lint and tests, so it knows which failures already existed before it touched anything.
2. **Plan**: it groups the findings into batches (P0 first) and shows a table with files, risk, and whether a native rebuild is needed. You confirm.
3. **Apply**: minimal, local diffs. It reuses your existing modules and never weakens a check. It never disables lint rules, adds `@ts-ignore`, loosens RLS or widens CORS.
4. **Final verification (mandatory)**:
   - ✅ The full gates: typecheck, lint, tests, `expo-doctor`, `expo install --check`, and `npm audit` if deps changed.
   - 🔍 An **independent verifier agent** re-checks every fixed finding and returns `fixed`, `partial` or `not-fixed`.
   - 🧪 A **regression scan** diffs the before/after scans for new risky patterns in the changed files.
   - 📊 A **re-audit** of the touched categories produces new scores.
5. **Report**:

```text
| Category        | Before | After | Δ    | Fixed | Partial | Still open |
|-----------------|--------|-------|------|-------|---------|------------|
| Auth & sessions | 7.0    | 9.0   | +2.0 | 2     | 0       | 0          |
| Release         | 3.0    | 7.5   | +4.5 | 2     | 1       | 1          |
Gates: typecheck ✅ · lint ✅ · tests ✅ (142/142) · expo-doctor ✅
Rebuild required: yes (app.json plugins changed)
Verdict now: 🟧 GO WITH RISKS
```

> It never reports "all fixed" unless every finding is verifier-confirmed and every gate is green. Gates it could not run are reported as **"not run: reason"**, never as passed.

Dependency changes are **never installed for you**. It prints the exact `npx expo install …` command for you to run, which avoids OS mismatches such as WSL vs Windows `node_modules`.

---

## 🧭 Setup

```text
/expo-es-kit:setup [appPath] [--mode=direct-db | api | hybrid] [--api=<apiRepoPath>] [--dry-run]
```

Generates **short** `CLAUDE.md` files. Claude Code loads a folder's file automatically when an agent works in that folder. Each file has four sections: **Use**, **Never**, **Patterns** and **Before finishing**.

| Folder | Rules about |
|---|---|
| root | Stack, commands, folder map, the top non-negotiables |
| `app/` | Thin routes, `freezeOnBlur`, transitions, typed routes, deep-link params, error boundaries |
| `components/` | Memo discipline (React Compiler aware), lists, expo-image, animations, overdraw, sheets |
| `hooks/`, `lib/`, `stores/` | Single clients, query keys, server vs client state, safe native imports |
| `lib/storage/` | SecureStore vs encrypted MMKV, key prefixes, sign-out wipe |
| data layer | **direct-db**: RLS is the boundary, typed queries, RPCs. **api**: single client, 401 → refresh → retry once |
| `supabase/migrations` | RLS + policies per operation, `(select auth.uid())`, definer `search_path`, safe migrations |
| API repo (`--api`) | Handler wrapper, server-side JWT verification, IDOR checks, zod, rate limits, webhooks |
| `components/ui` | HeroUI Native rules (when installed) |

**Smart, not destructive:**

- 🧹 **Stale claim detection.** It flags rules contradicted by your code, e.g. *"mocks are the data layer"* when the app makes 200 API calls, quotes both sides, and asks before correcting.
- 🤝 **Respects what you have.** It references your existing `.claude/rules`, `.cursor/rules` and skills instead of duplicating them.
- 🔒 **Safe merge.** Your text stays untouched. The kit only manages its own `<!-- expo-es-kit:start -->` … `<!-- expo-es-kit:end -->` section.
- 👀 `--dry-run` shows every file and diff without writing anything.

---

## 🔐 Backend

```text
/expo-es-kit:backend [design | audit | implement] [appPath] [--api=<apiRepoPath>] [--framework=nextjs | supabase-edge | expo-api-routes]
```

Your app talks to data in one of three ways. The kit detects which one automatically:

| Mode | Meaning | Trust boundary |
|---|---|---|
| **direct-db** | The app queries Supabase/Postgres directly | Row-Level Security policies |
| **api** | The app calls your API hosted elsewhere | Your API's auth + authorization |
| **hybrid** | Reads go direct; writes, secrets and payments go through the API | Both |

Supported API frameworks: **Next.js route handlers (Vercel)**, **Supabase Edge Functions** and **Expo API Routes (EAS Hosting)**.

- **`design`**: recommends a mode and a framework with the decisive reasons, then outputs the trust boundaries, the auth flow, conventions and first steps.
- **`audit`**: a deep audit of backend, auth, client security and secure storage, plus an **OWASP API Top 10** checklist mapped to mobile backends.
  - It reads your shared auth guard and handler wrapper before judging individual routes.
  - It can optionally run probes (BOLA, no token, expired token, oversized body, rate-limit burst), but only against a local or preview environment and test accounts you provide.
- **`implement`**: builds endpoints the secure way:
  - zod validation
  - user id taken from the *verified* token
  - per-resource authorization
  - user-scoped DB client
  - generic errors
  - idempotency keys
  - rate limits

  It also builds the matching app-side client method, query hook and tests (401 / 403 / 400 / happy path).

**Auth & sessions** are covered end to end:

- SecureStore session adapter
- PKCE
- validated deep-link redirects
- AppState-driven token refresh
- single-flight refresh on 401
- session-generation guard against account-switch races
- server-side revoke plus a local wipe of query cache, MMKV, images and secure items
- revocable device sessions with hashed tokens
- account deletion

---

## 🧱 Foundation

```text
/expo-es-kit:foundation [appPath] [--mode=direct-db | api | hybrid] [--only=storage,query,auth,api,env,errors]
```

It runs a gap analysis first, so it only creates what's missing and proposes small *extend* diffs for modules that already exist.

| Module | What you get |
|---|---|
| `app-storage` | MMKV encrypted with a key held in SecureStore. A canary detects an unreadable store and recovers. Bounded init with an ephemeral fallback. |
| `secure-session-storage` | Supabase-compatible SecureStore adapter, with large-session handling |
| `supabase-client` / `api-client` | One client each. PKCE and auto-refresh; auth header injection; timeouts; 401 → single-flight refresh → retry once |
| `query-client` + `query-snapshot-cache` | Sane TanStack Query defaults and `focusManager`/`onlineManager` wiring. Per-family snapshots with TTL and shape guards, instead of whole-cache persistence. |
| `session-generation` + `sign-out` | No late writes after sign-out, and a complete wipe |
| `env` | zod-validated config that refuses secret-looking `EXPO_PUBLIC_*` names |
| `error-boundary`, `safe-native-import`, `signed-url-cache` | Crash reporting hook with PII scrubbing; crash-safe optional native modules; stable signed URLs |

---

## 🎨 HeroUI

```text
/expo-es-kit:heroui [audit | setup] [appPath]
```

This command only runs when `heroui-native` is installed. It scores 5 areas:

| Area | Examples |
|---|---|
| **Performance** | Granular imports, a **single sheet host** (only the active sheet is mounted), skeleton bypass after load, overdraw from translucent colors |
| **Tokens** | Token-adoption percentage for colors, typography, spacing and radius; hard-coded hex values; arbitrary values; dark/light parity |
| **Animations** | Reanimated v4 compatibility, reduced motion, no mount animations during transitions, sheet snap/scroll rules |
| **Accessibility** | Labels on icon-only buttons, target sizes, focus in sheets, font scaling |
| **Consistency** | Raw `Pressable` vs HeroUI primitives, styling policy, duplicated components |

`setup` adds UI-folder agent rules and an import rule. It can optionally add a `SheetHost` and a `LoadingSkeleton` component, typechecked against the real HeroUI Native types.

---

## 🏪 Privacy

```text
/expo-es-kit:privacy [appPath] [--api=<apiRepoPath>] [--out=<dir>]
```

Store privacy forms are where most apps get it wrong. Crash reporters get forgotten, data gets marked "not linked" while a user id is sent, and backend data is skipped because "it's only our server". This command builds the answers **from evidence**:

| Source | What it finds |
|---|---|
| **Installed SDKs** | 35+ known SDKs (Sentry, Firebase, RevenueCat, PostHog, OneSignal, AdMob…) with the data each one collects, checked against *your* config (user identification, replay, ads) |
| **Permissions** | Declared vs actually used: iOS usage strings, Expo config-plugin options, Android permissions |
| **Your database** | Column names in your migrations mapped to data types (email, phone, health/fitness, photos, location, payments…). Data your own backend stores **is** collected. |
| **Signals** | Account creation vs deletion, ATT prompt, advertising IDs, analytics identify calls, privacy policy link, cleartext traffic |

It writes these files to `docs/store/`:

| File | Contents |
|---|---|
| `app-privacy-ios.md` | Answers in App Store Connect order, plus the final label (*Data Used to Track You / Linked to You / Not Linked to You*) |
| `data-safety-android.md` | Collected vs shared, encryption in transit, deletion, and the per-type table |
| `privacy-manifest.md` | Proposed `ios.privacyManifests` (required-reason APIs) and how to verify the merged `PrivacyInfo.xcprivacy` |
| `privacy-findings.md` | Rejection risks (missing usage strings, tracking without ATT, no account deletion…) and the **Confirm** questions only you can answer |

> Every "collected" answer cites evidence (`file:line` or SDK and config). These are draft answers based on your code, not legal advice; you remain responsible for the final declarations.

---

## ⬆️ Upgrade

```text
/expo-es-kit:upgrade [appPath] [--to=<sdk>] [--plan-only]
```

1. **Assess**: current SDK, native dependencies, config plugins, `patch-package` patches, CNG vs committed native folders, `runtimeVersion` policy, and baseline gates.
2. **Plan**: for each major, the breaking changes from the official release notes, grep hits in your code, library compatibility, and the blockers. `--plan-only` stops here.
3. **Execute one major at a time**:
   - a branch per step
   - install commands printed for you to run
   - migrations applied, and patches re-validated
   - OTA safety checked
   - gates run (typecheck, lint, tests, `expo-doctor`, `expo install --check`, `npm audit`)
   - dev-client rebuild and a **device smoke-test checklist** that you confirm
   - a commit
4. **Finish**: a regression scan, a re-audit of deps, updates, performance and startup, and an upgrade report with the before/after scores.

It uses the official Expo upgrade skill when it's installed (`/plugin install expo@claude-plugins-official`). It never skips a major, unless Expo officially recommends the skip; for example, SDK ≤55 goes straight to 57.

---

## 📈 History

```text
/expo-es-kit:history [appPath]
```

It turns every `docs/audits/expo-audit-*.json` into **`docs/audits/history.html`**. This is a self-contained page that works offline, in light and dark mode, and on mobile. It shows:

- the overall score over time
- per-category trend panels with status
- open P0/P1/P2 findings per audit
- a table of all audits

It also writes a **score badge**:

```md
[![Expo audit](docs/audits/badge.svg)](docs/audits/history.html)
```

There is also `badge.json` in shields.io endpoint format, for public repos.

---

## 🚨 Guard hook

Every time an agent uses `Write` or `Edit` in an **Expo project**, a fast local check scans **only the text just written**. When something looks dangerous, the agent gets a warning right away and can correct itself. The hook **never blocks** an edit.

| Catches | Severity |
|---|:---:|
| Token, session or password written to AsyncStorage | P0 |
| `service_role` key referenced in app code | P0 |
| Secret-looking `EXPO_PUBLIC_*` variable | P0 |
| Hard-coded secrets (Stripe, AWS, GitHub, Supabase `sb_secret_`, private keys…) | P0 |
| Tokens in logs or in URL query strings | P1 |
| Cleartext `http://` endpoints | P1 |
| `moment` import | P1 |
| Credentials in key-value storage keys | P1 |
| Whole-cache query persistence, full `lodash`, RN `Image` for remote images, root `heroui-native` import | P2 |

To turn it off for one project, see [Configuration](#-configuration).

---

## 📌 Recommended workflows

**New app**

```text
/expo-es-kit:backend design      → pick direct-db / api / hybrid
/expo-es-kit:foundation          → core modules
/expo-es-kit:setup               → agent rules for every folder
```

**Ongoing development**: the guard hook runs automatically. Once a week, run:

```text
/expo-es-kit:audit --quick
```

**Before a release**

```text
/expo-es-kit:audit --deep --api=../my-api
/expo-es-kit:fix --only=P0,P1
/expo-es-kit:audit --quick         → confirm the trend ▲ and the verdict
/expo-es-kit:privacy               → store privacy answers + manifest check
/expo-es-kit:history               → dashboard + badge
```

**When the SDK falls behind** (the audit flags `updates`):

```text
/expo-es-kit:upgrade --plan-only   → review the plan
/expo-es-kit:upgrade               → execute, one verified major at a time
```

**After a big refactor or library change**

```text
/expo-es-kit:setup                  → refresh the agent rules, catch stale claims
```

---

## 📁 Reports & files

| File | Created by |
|---|---|
| `docs/audits/expo-audit-YYYY-MM-DD.md` + `.json` | `audit` |
| `docs/audits/expo-fix-YYYY-MM-DD.md` + `.json` | `fix` |
| `docs/audits/backend-audit-YYYY-MM-DD.md` + `.json` | `backend audit` |
| `docs/audits/heroui-audit-YYYY-MM-DD.md` + `.json` | `heroui audit` |
| `docs/audits/expo-upgrade-YYYY-MM-DD.md` | `upgrade` |
| `docs/audits/history.html`, `badge.svg`, `badge.json` | `history` |
| `docs/store/*.md`, `privacy-answers.json` | `privacy` |
| `**/CLAUDE.md`, `.claude/rules/*.md` | `setup`, `heroui setup` |

- The **JSON** is what powers the trend column, "recurring finding" detection and the `fix` command.
- Commit the `docs/audits/` folder to keep a history of scores over time.
- If a report for today already exists, the new one gets a `-2`, `-3`, … suffix.

---

## 🔒 Safety & privacy

- **Audits are read-only.** They never edit code and never run `npm install`, `expo prebuild` or `expo export`. Bundle analysis runs only if you explicitly ask for it, because it writes `dist/`.
- **CLI checks are opt-in.** You are asked before `expo-doctor`, `npm audit` and similar commands run.
- **Secrets stay secret.**
  - The scanner reads **only the key names** in `.env` files, never their values.
  - Secret-looking literals are redacted (`sk_live_•••`) in every output.
  - Reports never contain secret values.
- **Local scanning.** `scripts/scan.mjs` has zero dependencies and makes no network calls. Code reaches the model only the way it always does in Claude Code, through the files the agents read.
- **No silent overwrites.** Every write is preceded by a plan, diffs and your confirmation.
- **Remote systems.** The kit never applies migrations, never probes production, and never touches remote databases.

---

## 🔧 Configuration

| Setting | Where | Effect |
|---|---|---|
| `EXPO_ES_KIT_GUARD=off` | Environment variable | Disables the guard hook |
| `{ "guard": false }` | `.expo-es-kit.json` in the app root | Disables the guard hook for that project |
| `--out=<file.md>` | `audit` argument | Custom report location |

---

## ❓ FAQ & troubleshooting

<details>
<summary><b>The commands don't show up after installing.</b></summary>

Restart Claude Code, then run `/plugin` and check that `expo-es-kit` is enabled. To develop locally, use `claude --plugin-dir /path/to/expo-es-kit`.
</details>

<details>
<summary><b>Quick or deep: which should I run?</b></summary>

**Quick** is a single agent. It's cheap, takes about 5–15 minutes, and is good for weekly checks. Its findings are not independently verified.

**Deep** runs 8 parallel specialists plus a verifier. It's thorough, but it uses many more tokens. Run it before releases or after big changes.
</details>

<details>
<summary><b>The scan is slow.</b></summary>

On WSL, projects under `/mnt/c/...` read slowly (cross-filesystem I/O). Expect 10–60 s for large apps. A clone inside the Linux filesystem is much faster.
</details>

<details>
<summary><b>I use Windows + WSL. Will it break my node_modules?</b></summary>

No. The kit never installs packages. When a fix needs a dependency, it prints the command, and you run it from the same OS you normally use for the project. Installing from WSL into a Windows project breaks Metro's `.bin` symlinks.
</details>

<details>
<summary><b>A finding is wrong / my code does it on purpose.</b></summary>

Write the decision down in your repo's docs or `CLAUDE.md`, ideally with the measurement behind it. Auditors respect documented, measured trade-offs. In deep mode, the verifier also rejects findings that are mitigated elsewhere (wrappers, middleware, later migrations).
</details>

<details>
<summary><b>My backend lives in another repo.</b></summary>

Pass it with `--api=../my-api` on `audit`, `setup` or `backend`. If you don't, the kit notices sibling folders that look like an API and asks whether to include them.
</details>

<details>
<summary><b>Does it work without Supabase, HeroUI or MMKV?</b></summary>

Yes. Categories adapt to what's installed and become n/a when they don't apply. For example, the MMKV category scores whether your app *would need* MMKV (AsyncStorage on hot paths, for instance).
</details>

<details>
<summary><b>Monorepo?</b></summary>

Point `appPath` at the Expo app folder (`apps/mobile`) and `--api` at the backend folder (`apps/api`).
</details>

---

## 🧩 How it works

```
expo-es-kit/
├── .claude-plugin/        plugin.json · marketplace.json
├── skills/
│   ├── audit/             SKILL.md · references/ (scoring rubric, report template, measuring, 13 checks files)
│   ├── fix/               SKILL.md
│   ├── setup/             SKILL.md · templates/ (17 CLAUDE.md templates: app, data modes, server)
│   ├── backend/           SKILL.md · references/ (modes, Supabase, Next.js, Edge, Expo API routes, auth, OWASP)
│   ├── foundation/        SKILL.md · templates/code/ (12 TypeScript modules)
│   ├── heroui/            SKILL.md · references/ · templates/
│   ├── privacy/           SKILL.md · references/ (Apple/Google data types, SDK catalog JSON, forms guide, manifest)
│   ├── upgrade/           SKILL.md · references/ (playbook, SDK 52–58 notes, library compatibility)
│   └── history/           SKILL.md
├── agents/                8 read-only specialist auditors + finding-verifier
├── hooks/                 hooks.json · guard.mjs (PostToolUse, warn-only)
├── scripts/               scan.mjs · rules.mjs · privacy-scan.mjs · history.mjs · query-scan.mjs · diff-scans.mjs · detect-mode.mjs · validate-plugin.mjs
└── shared/contract.md     categories · severities · scoring · JSON shapes
```

1. **`scan.mjs`** collects facts quickly and locally:
   - stack and config
   - env key names
   - committed sensitive files
   - folders and existing agent config
   - migrations (RLS)
   - API routes and their shared helpers
   - 120+ rule hits, each with `file:line`

   A `--summary` mode keeps context small; `query-scan.mjs` fetches details on demand.
2. **Agents read the code behind the signals.** A hit is a *signal*, not a finding. Every finding needs code that was actually read.
3. **`finding-verifier`** tries to disprove each serious finding before it reaches your report.
4. **`shared/contract.md`** keeps every skill and agent on the same IDs, severities, caps and JSON, which is what makes trends and `fix` possible.

---

## 🤝 Contributing

Contributions are welcome: new rules, better checks, more frameworks.

- **New detection rule**: add it to `scripts/rules.mjs` with `id`, `category` and `severity`. Add `guard: true` and a `message` if the hook should warn on it. Reference it from the matching `skills/audit/references/checks/*.md`.
- **New check**: every check needs a *how to verify* and a *not a problem when*. False positives erode trust faster than misses.
- **Before opening a PR**:

```bash
node scripts/validate-plugin.mjs        # structure, references, rules
claude plugin validate .                 # official manifest validation
node scripts/scan.mjs /path/to/an/expo-app --summary --pretty | head -50
```

Please describe in the PR how you tested the change on a real Expo app.

---

## 📄 License

[MIT](LICENSE) © eusebiu-soica

<div align="center">
<sub>Built for developers who ship Expo apps and want agents that don't forget the important stuff.</sub>
</div>
