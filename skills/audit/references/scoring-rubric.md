# Scoring rubric

Applies to every category in `shared/contract.md`. Scores are 0–10 in **0.5 steps**. Score what the code *does*, not what it intends. Every score must be explainable in ≤2 sentences (`rationale`) and traceable to findings or strengths.

## 1. General anchors

| Band | Meaning | Typical shape |
|---|---|---|
| **0–2** | Broken or dangerous | Multiple confirmed P0s, or the category's core mechanism is absent where it is clearly needed (e.g. tokens in plain storage everywhere, no virtualization on every feed, no crash reporting + no error boundary + no EAS config). |
| **3–4** | Serious gaps | One confirmed P0, or several confirmed P1s. Basics partly present but wrong in the hot paths. |
| **5–6** | Works, with real weaknesses | No P0. One–three P1s, or the right tools installed but misconfigured / inconsistently applied. Users notice problems on min-spec devices. |
| **7–8** | Solid | No P0, at most one minor P1 (7) or none (7.5–8). Correct patterns in hot paths; remaining issues are P2 hygiene. |
| **9–10** | Exemplary | No P0/P1, few P2s, proven patterns applied consistently, measured or guarded (CI gate, lint rule, test). 10 is rare: requires evidence of measurement or enforcement, not just absence of problems. |

## 2. Hard caps (from the contract — never override)

- Any **confirmed P0** in the category → score **≤ 4**.
- Any **confirmed P1** in the category → score **≤ 7**.
- Caps are ceilings, not targets: a category with one P0 and nothing else wrong scores 4; with a P0 and several P1s it scores lower.
- Stacking guidance (rubric, not contract): 2 independent confirmed P1s → ≤ 6.5; 3+ → ≤ 6; 5+ or a P1 that affects every screen → ≤ 5.
- Only findings with `verified: "confirmed"` trigger caps. `downgraded` findings count at their new severity. `unverified` P0/P1 do not cap but must be listed and pull the score down by judgment (≤ 1 point). `rejected` findings have zero effect.
- Quick mode (no separate verifier): the auditor confirms a P0/P1 by reading the cited line plus its call sites. `confidence: high` after that read = `confirmed`. Never confirm from a scan hit alone.

## 3. Evidence vs heuristics

1. **Scan hits are signals, not findings.** `hits["<id>"].count` tells you where to look. Open the samples, read the surrounding code, then decide.
2. **Weight by blast radius.** A problem in a root layout, a list item rendered 500×, or the auth client weighs more than the same problem in a settings screen.
3. **Counts are context.** 40 `inline-style` hits in a memo-free app with React Compiler on are irrelevant; 3 `inline-handler` hits on memoized list rows with compiler off are a real P2/P1.
4. **Absence of evidence is not a 10.** If a check could not be performed (no access to API repo, native folders not generated, no device), do not award above **8** for that category and list it under "What was not checked".
5. **Positive evidence raises the score.** CI gates, lint rules, tests, perf marks, documented measurements, or a template applied everywhere justify 9+. Note them as `strengths`.
6. **Measurements beat reading.** A documented on-device measurement (see `measuring.md`) overrides a static heuristic in either direction. Reports must say which claims were measured vs inferred.
7. **Confidence maps to wording.** `high` → state as fact. `medium` → "likely; verify X". `low` → keep as P2 or drop; never cap on low confidence.

## 4. n/a rules

| Category | n/a when | Otherwise |
|---|---|---|
| `mmkv` | App genuinely has no local persistence needs (no AsyncStorage/SQLite/MMKV/SecureStore usage, no cached data, no prefs). | If MMKV is not installed, score how well the app *would* need it: AsyncStorage on hot paths or startup reads → ≤ 6; light prefs-only AsyncStorage off the hot path → 7–8. |
| `backend` | `backend.mode === "none"` and no `api` root and no remote data. | Score RLS (direct-db) or API routes (api) or both (hybrid). |
| `heroui` | `heroui-native` not in `stack.libs`. | Score per heroui checks. |
| all others | Never n/a. An app with no lists still has `perf`; no OTA still has `updates` (score whether that is a deliberate, documented choice). |

`n/a` categories show ⚪, are excluded from the overall score, and are listed with a one-line reason.

## 5. Overall score, status, verdict

```
overall = round1( Σ(score_i × weight_i) / Σ(weight_i) )   over non-n/a categories
weights: secure-storage, client-security, auth-sessions, backend = 1.5; agent-config = 0.5; all others = 1.0
```

Status: 🟢 8–10 · 🟡 5–7.5 · 🔴 0–4.5 · ⚪ n/a.

Verdict (first match wins):
1. **NO-GO** — any confirmed P0 in any category.
2. **GO WITH RISKS** — a confirmed P1 in `secure-storage`, `client-security`, `auth-sessions` or `backend`, **or** overall < 7.
3. **GO** — otherwise.

Trend: load the most recent previous report JSON of the same `type` from the report directory (`docs/audits/expo-audit-*.json`, newest date, highest `-N` suffix). Per category Δ = current − previous (one decimal). Show `▲ +1.5`, `▼ -0.5`, `—` (|Δ| < 0.5 or equal), `new` (category absent or n/a before). Overall trend uses the same rule against `previous.overall`.

## 6. Calibration rules

- Score each category independently; do not let a bad security score drag `perf` down.
- Two auditors seeing the same evidence must land within ±0.5. If torn between two values, pick the lower one and say what would raise it.
- Do not reward volume of code; reward correctness of hot paths.
- Re-audit after a fix run: a category only goes up if the fix is verified in code (and on device for perf claims, when measurable).

## 7. Per-category anchors (3 / 6 / 9)

### `perf`
| 3 | 6 | 9 |
|---|---|---|
| Unbounded feeds in `ScrollView` + `.map()`; remote images via RN `Image` without cache; list rows unmemoized with compiler off; layout props animated on JS thread. | Lists virtualized but rows re-render (inline props on memoized children, unstable `extraData`); expo-image without `recyclingKey` in lists; thumbnails load originals; all bottom sheets mounted. | Virtualized lists with stable keys/props; resized thumbnails + `memory-disk` cache; compiler-or-memo discipline consistent; transform/opacity-only animations; overdraw flattened; measured p95 frame time on min-spec documented. |

### `startup`
| 3 | 6 | 9 |
|---|---|---|
| Splash hides before content (white flash) or never hides on error; `useFonts` gate + several awaited SDK inits + whole query cache restore in root layout; cold start > 4 s on min-spec. | Splash handled; fonts still gated at runtime; analytics/purchases init eagerly; storage init unbounded; cached data shown but multiple duplicate refreshes. | Embedded fonts via config plugin; non-critical SDKs deferred after first frame; bounded storage init with fallback; cached content on first frame + ≤1 deduped refresh; cold start to content < 2 s measured on min-spec. |

### `bundle`
| 3 | 6 | 9 |
|---|---|---|
| moment + full lodash + aws-sdk v2 / firebase compat; dev-only libs (faker, reactotron) imported from prod code; huge PNG assets. | One or two heavy libs or barrel imports remain; unused deps present; console not stripped. | No heavy legacy libs; granular imports; console stripped in prod; assets compressed (webp); bundle analyzed (Atlas) and size tracked across releases. |

### `caching`
| 3 | 6 | 9 |
|---|---|---|
| No query layer (fetch in `useEffect` everywhere) or `staleTime: 0` defaults causing refetch storms; `invalidateQueries()` with no args after every mutation; signed URLs regenerated each render (image cache never hits). | TanStack Query with sane defaults but no `focusManager`/`onlineManager` wiring; whole-cache persister; some N+1 requests; TTL math unchecked. | Key factories; family-scoped invalidation; per-family snapshots with TTL + shape guard; signed-URL cache with in-flight dedupe and stable URLs; batch signing; offline behaviour defined; caches wiped on sign-out. |

### `mmkv`
| 3 | 6 | 9 |
|---|---|---|
| AsyncStorage read synchronously-awaited at startup and on hot paths; sensitive bulk data unencrypted; MMKV (if present) has no encryption and crashes on undecryptable store. | MMKV in use but single unencrypted instance mixing cache and prefs; no per-user key prefix; init unbounded; leftover AsyncStorage data. | Encrypted MMKV with key in SecureStore; canary + `clearAll()` recovery; bounded init with ephemeral fallback (no personal data persisted while ephemeral); per-concern instances; per-user prefix wiped on sign-out. |

### `secure-storage`
| 3 | 6 | 9 |
|---|---|---|
| Session/refresh token in AsyncStorage or unencrypted MMKV (P0 → ≤4). | Tokens in SecureStore but bulk sensitive data unencrypted elsewhere, or no keychain accessibility choice, or chunked giant JSON in SecureStore. | Tokens in SecureStore with explicit accessibility; bulk data encrypted with SecureStore-held key; nothing sensitive in logs, URLs or backups. |

### `client-security`
| 3 | 6 | 9 |
|---|---|---|
| Secret/service-role key in bundle or `EXPO_PUBLIC_*SECRET*`; `.env` with secrets tracked in git. | No secrets, but cleartext endpoints, risky WebView props, unvalidated deep links, sensitive logging. | No secrets client-side; https only; WebViews locked to origins; deep-link params validated; logs scrubbed; `__DEV__`-only tooling. |

### `auth-sessions`
| 3 | 6 | 9 |
|---|---|---|
| Token in plain storage; JWT decoded but never verified server-side; tokens in URLs. | Correct storage but no auto-refresh lifecycle (AppState), sign-out leaves query/image/MMKV caches populated. | PKCE/OAuth via auth-session; refresh tied to AppState; full wipe on sign-out (query cache, images, MMKV prefix); 401 → single refresh attempt then sign-out. |

### `backend`
| 3 | 6 | 9 |
|---|---|---|
| Tables without RLS readable by anon, `using (true)` on private data, routes without auth. | RLS on all tables but some policies too broad; `security definer` without `search_path`; API routes lack validation or rate limits. | RLS + scoped policies with `(select auth.uid())`; routes authenticated, validated (zod), rate-limited, errors not leaked; policies tested. |

### `deps`
| 3 | 6 | 9 |
|---|---|---|
| `expo install --check` shows many misaligned natives; high/critical prod vulns; no lockfile or mixed lockfiles. | Aligned with SDK but outdated minors, untracked patches, no CI audit gate, duplicate packages. | `expo-doctor` clean; CI runs `npm ci`, typecheck, lint `--max-warnings=0`, `npm audit --omit=dev --audit-level=high`; patches documented and re-validated; optional native modules safely imported. |

### `updates`
| 3 | 6 | 9 |
|---|---|---|
| SDK ≥ 2 majors behind; `expo-updates` present without `runtimeVersion` policy or channels (OTA can ship JS to incompatible binaries). | One SDK behind; OTA configured but channels not per profile, versions managed manually, no rollback plan. | Latest or latest−1 SDK; New Architecture; `fingerprint` or `appVersion` policy with discipline; channels per profile; `appVersionSource: remote` + `autoIncrement`; documented upgrade path. |

### `release`
| 3 | 6 | 9 |
|---|---|---|
| No crash reporting, no error boundary; account creation without in-app deletion (P0); missing usage-description strings for requested permissions. | Crash reporting without source maps; privacy manifest incomplete; `allowBackup` default with sensitive data; no CI checks. | Crash reporting + source maps; route-level error boundaries; privacy manifest, permissions minimal, deletion flow, deep links verified; EAS profiles + env per profile; CI typecheck/lint/tests; launch checklist. |

### `agent-config`
| 3 | 6 | 9 |
|---|---|---|
| No CLAUDE.md, or a stale one that contradicts the code (claims no backend while supabase-js is installed). | Root CLAUDE.md present but long (>300 lines) or generic; no per-folder files for large source folders; minor staleness. | Short accurate root CLAUDE.md (stack, commands, pointers); per-folder CLAUDE.md for big folders; no conflicting rules across tools; audit history in `docs/audits/`. |

### `heroui`
| 3 | 6 | 9 |
|---|---|---|
| Root imports everywhere; raw Pressables and hard-coded hex bypass the theme; all bottom sheets mounted. | Library used consistently but with some root imports, arbitrary values, missing a11y labels on icon-only buttons. | Granular imports; theme tokens only; single sheet host; a11y labels; variants via `tv()`; skeleton wrapper bypassed once loaded. |
