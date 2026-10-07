# Report template

The markdown report is rendered from the report JSON (`shared/contract.md`). Never put content in the markdown that is not in the JSON. File: `docs/audits/expo-audit-YYYY-MM-DD.md` (fix run: `expo-fix-YYYY-MM-DD.md`), JSON next to it with the same basename.

## Formatting rules

- Category order is the contract order: perf, startup, bundle, caching, mmkv, secure-storage, client-security, auth-sessions, backend, deps, updates, release, agent-config, heroui.
- Scores always with one decimal (`6.5`, `10.0`). Δ with sign (`+1.5`, `-0.5`).
- Status: 🟢 8–10 · 🟡 5–7.5 · 🔴 0–4.5 · ⚪ n/a.
- Trend: `▲ +1.5` / `▼ -0.5` / `—` (|Δ| < 0.5) / `new` (no previous score for that category).
- Verdict badge: `🟥 NO-GO` · `🟧 GO WITH RISKS` · `🟩 GO`.
- Severity tags: `P0`, `P1`, `P2`. Effort: `S` / `M` / `L`.
- Every finding shows `file:line` as a relative path (`lib/auth/session.ts:42`). If a finding spans files, cite the primary one and add "+N files".
- Evidence snippets: ≤ 3 lines, redacted (never print secret values — use `•••`).
- "Key finding" and "Top suggestion" cells: ≤ 70 characters, no trailing period.
- Never include `rejected` findings in the markdown (JSON only; the appendix shows the count).

## Header

```markdown
# Expo audit — <app name>

**Date:** 2026-10-07 · **Mode:** deep · **Scope:** full (or: partial — N files)
**Stack:** Expo 57.0.x · RN 0.86.x · React 19.2.x · expo-router · Hermes · New Arch · TS strict
**Libraries:** TanStack Query 5 · MMKV 4 · expo-image · Reanimated 4 · HeroUI Native
**Backend:** hybrid (Supabase direct-db + Next.js API at `../my-api`)

## Overall: 7.1 / 10 · 🟧 GO WITH RISKS · ▲ +0.9 vs 2026-09-01 (6.2)
```

- Stack line comes from `stack` + `config` (`jsEngine`, `newArchEnabled`, `tsStrict`). Omit unknown items instead of printing `null`.
- Backend line: `backend.mode` + `apiFramework` + api root if given. `none` → "Backend: none (backend n/a)".
- No previous report → "first audit" instead of the trend.
- Under NO-GO add, right below the overall line: `**Blocking:** AUTH-003, BE-001` (all confirmed P0 ids).

## Summary table

```markdown
| # | Category | Score | Trend | Status | Key finding | Top suggestion |
|---|---|---|---|---|---|---|
| 1 | Performance | 6.5 | ▲ +1.0 | 🟡 | Feed thumbnails load full-size originals | Use transformed preview URLs for thumbnails |
| … |
| 14 | HeroUI Native | n/a | — | ⚪ | Not installed | — |
```

All 14 categories always appear (n/a rows included, so trends stay comparable across runs).

## Top 10 fixes

Order: severity (P0 → P1 → P2), then category weight (1.5 first), then effort (S → L), then confidence. Only `confirmed` or `downgraded` findings; if fewer than 10 remain, fill with `unverified` P1s marked `(unverified)`.

```markdown
| # | ID | Sev | Category | Fix | Effort | File |
|---|---|---|---|---|---|---|
| 1 | AUTH-003 | P0 | auth-sessions | Move session storage to SecureStore adapter | S | lib/auth/session.ts:42 |
```

## Per-category sections

````markdown
## 1. Performance — 6.5 / 10 🟡 (▲ +1.0)

<rationale, ≤ 2 sentences>

**Strengths**
- expo-image with `cachePolicy="memory-disk"` on all remote images
- Single bottom-sheet host; only the active sheet is mounted

**Findings**

### PERF-001 · P1 · Feed thumbnails decode full-size originals
`components/feed/PostCard.tsx:88` · confidence high · confirmed · effort M
```tsx
<Image source={{ uri: post.imageUrl }} style={styles.thumb} />
```
**Impact:** each 4000×3000 original decodes to ~48 MB of texture; scrolling the feed grows GPU memory into hundreds of MB.
**Fix:** request a resized preview (storage transform / `?width=`); keep originals for the full-screen viewer only.
````

Order findings by severity, then file. When a category has more than 5 P2s, group them in one compact table (`| ID | Title | File | Effort |`) after the P0/P1 blocks.

## What was not checked

Mandatory, even if short. Each item: what, why, impact on scoring.

```markdown
## What was not checked
- On-device measurements (no device session) — perf/startup scores are static estimates, capped at 8.
- API repository not provided — backend scored on Supabase migrations only.
- `npm audit` not run (offline) — deps score excludes vulnerability state.
```

## Appendix (file only)

- n/a categories with reason.
- Scan facts used (key hit counts, `largestComponents`, config flags).
- Previous report path and per-category Δ.
- `Rejected findings: N (see JSON)`.

## Fix-run variant

Header identical, title `# Expo fix run — <app>`, plus `**Based on:** docs/audits/expo-audit-2026-09-01.md`. Replace the summary table with:

```markdown
| Category | Before | After | Δ | Fixed | Remaining |
|---|---|---|---|---|---|
| Performance | 6.5 | 8.0 | ▲ +1.5 | PERF-001, PERF-004 | PERF-007 (P2) |
| Auth & sessions | 4.0 | 7.5 | ▲ +3.5 | AUTH-003 | AUTH-006 (P1, needs product decision) |
```

Then: overall before → after and new verdict; **Changes** (`file` — what changed — finding id); **Verification** (typecheck / lint / tests run and result; on-device checks done or pending; native rebuild required yes/no); **Not fixed** with reason (`wontfix`, needs decision, needs native rebuild, out of scope). An `After` score only moves for categories whose fixes were verified in code; perf claims stay "unmeasured" until checked on device.

## Terminal vs file

| Element | Terminal | File |
|---|---|---|
| Header (app, date, mode, stack, backend, overall, verdict, trend) | yes, compact (3 lines) | yes |
| Summary table | yes | yes |
| Top 10 fixes | yes | yes |
| Per-category sections | no | yes |
| What was not checked | count + "see report" | yes |
| Appendix | no | yes |
| Path to saved md + json | yes, last lines | — |

Terminal ends with:
```
Report: docs/audits/expo-audit-2026-10-07.md (+ .json)
Next: /expo-es-kit:fix AUTH-003 PERF-001
```

## Filled example (abridged)

```markdown
# Expo audit — field-notes

**Date:** 2026-10-07 · **Mode:** quick · **Scope:** full
**Stack:** Expo 56.0.4 · RN 0.85.2 · React 19.2.3 · expo-router · Hermes · New Arch · TS strict
**Libraries:** TanStack Query 5 · expo-image · Reanimated 4
**Backend:** direct-db (Supabase)

## Overall: 6.4 / 10 · 🟥 NO-GO · ▲ +0.8 vs 2026-08-20 (5.6)
**Blocking:** SEC-001

| # | Category | Score | Trend | Status | Key finding | Top suggestion |
|---|---|---|---|---|---|---|
| 1 | Performance | 6.5 | ▲ +1.0 | 🟡 | Notes list rendered via ScrollView .map | FlatList with stable keyExtractor |
| 2 | Startup speed | 7.0 | — | 🟡 | Analytics SDK init blocks first frame | Defer init until first content |
| 3 | Bundle size | 8.0 | ▲ +0.5 | 🟢 | Icon barrel import in 12 files | Import per icon set |
| 4 | Caching | 6.0 | new | 🟡 | invalidateQueries() after every mutation | Invalidate only the mutated family |
| 5 | MMKV storage | 5.0 | — | 🟡 | AsyncStorage read 6× during startup | Move prefs + cache to MMKV |
| 6 | Secure storage | 3.5 | ▼ -0.5 | 🔴 | Refresh token in AsyncStorage | SecureStore adapter for auth |
| 7 | Client security | 8.5 | — | 🟢 | Stray console.log in 9 files | Strip console in production |
| 8 | Auth & sessions | 6.5 | ▲ +1.5 | 🟡 | Sign-out leaves query cache populated | queryClient.clear() + image cache clear |
| 9 | Backend security | 7.0 | ▲ +2.0 | 🟡 | Policies call auth.uid() unwrapped | Wrap in (select auth.uid()) |
| 10 | Dependencies | 7.5 | — | 🟡 | 4 packages misaligned with SDK | npx expo install --fix |
| 11 | Updates | 6.0 | ▼ -1.0 | 🟡 | One SDK behind, no runtimeVersion policy | Set policy + channels per profile |
| 12 | Release readiness | 6.0 | ▲ +1.0 | 🟡 | Crash reporting without source maps | Upload source maps in EAS build |
| 13 | Agent instructions | 4.0 | new | 🔴 | CLAUDE.md says "no backend yet" | Regenerate with /expo-es-kit:setup |
| 14 | HeroUI Native | n/a | — | ⚪ | Not installed | — |

| # | ID | Sev | Category | Fix | Effort | File |
|---|---|---|---|---|---|---|
| 1 | SEC-001 | P0 | secure-storage | Supabase auth storage → SecureStore adapter | S | lib/supabase.ts:14 |
| 2 | AUTH-002 | P1 | auth-sessions | Clear query + image caches on sign-out | S | lib/auth/signOut.ts:9 |
| 3 | PERF-001 | P1 | perf | Virtualize notes list | M | app/(tabs)/notes.tsx:120 |
| … |
```
