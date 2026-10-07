# expo-es-kit shared contract

Every skill and agent in this plugin uses these IDs, severities and JSON shapes. Do not invent new ones.

## Categories

| id | Name | Weight | Covered by (deep mode agent) |
|---|---|---|---|
| `perf` | Performance (render, lists, images, animations) | 1.0 | `perf-auditor` |
| `startup` | Startup speed (cold start, TTI, splash) | 1.0 | `perf-auditor` |
| `bundle` | Bundle size | 1.0 | `bundle-deps-auditor` |
| `caching` | Caching (query, image, network) | 1.0 | `storage-cache-auditor` |
| `mmkv` | MMKV storage | 1.0 | `storage-cache-auditor` |
| `secure-storage` | Secure storage | 1.5 | `storage-cache-auditor` |
| `client-security` | Client security | 1.5 | `client-security-auditor` |
| `auth-sessions` | Auth & sessions | 1.5 | `auth-session-auditor` |
| `backend` | Backend security (RLS or API) | 1.5 | `backend-auditor` |
| `deps` | Dependencies | 1.0 | `bundle-deps-auditor` |
| `updates` | Updates (SDK, OTA, runtimeVersion) | 1.0 | `bundle-deps-auditor` |
| `release` | Release readiness | 1.0 | `release-auditor` |
| `agent-config` | Agent instructions (CLAUDE.md) | 0.5 | `release-auditor` |
| `heroui` | UI library: HeroUI Native (only if installed) | 1.0 | `heroui-auditor` |

`mmkv` when MMKV is not installed: score how well the app *would* need it (AsyncStorage on hot paths, sync reads at startup). If the app genuinely has no local persistence needs, mark `n/a` and exclude from the overall score.
`backend` when the app has no backend at all: `n/a`.

**Overall score** = Σ(score × weight) / Σ(weight) over non-`n/a` categories, one decimal.

## Severity

| Severity | Meaning | Examples |
|---|---|---|
| **P0** | Exploitable security hole, data leak, data loss, crash on start, store rejection | `service_role` key in the app, table without RLS readable by anon, token in AsyncStorage, JWT decoded but not verified on server, no account deletion with account creation (iOS) |
| **P1** | Significant user-visible perf problem or a realistic security weakness | Unvirtualized unbounded list, remote images without cache policy, no sign-out cache wipe, no rate limit on auth endpoints, SDK two versions behind |
| **P2** | Hygiene / maintainability / small wins | Barrel imports, stray `console.log`, missing `keyExtractor`, outdated minor deps |

Effort: **S** (<1h), **M** (half day), **L** (>1 day).
Confidence: **high** (seen in code, unambiguous), **medium** (strong signal, context could excuse it), **low** (heuristic).

## Status icons and score anchors

🟢 8–10 · 🟡 5–7.5 · 🔴 0–4.5 · ⚪ n/a

Scores use 0.5 steps. A category with any confirmed **P0** cannot score above **4**. A category with a confirmed **P1** cannot score above **7**.

## Verdict

- **NO-GO**: any confirmed P0.
- **GO WITH RISKS**: no P0, but a confirmed P1 in `secure-storage`, `client-security`, `auth-sessions` or `backend`, or overall < 7.
- **GO**: otherwise.

## Finding JSON

```json
{
  "id": "AUTH-003",
  "category": "auth-sessions",
  "severity": "P0",
  "title": "Refresh token stored in AsyncStorage",
  "file": "lib/auth/session.ts",
  "line": 42,
  "evidence": "AsyncStorage.setItem('session', JSON.stringify(session))",
  "impact": "Any process with backup access reads the refresh token in plain text.",
  "fix": "Use the Supabase storage adapter backed by expo-secure-store (see foundation/templates/code/secure-session-storage.ts).",
  "effort": "S",
  "confidence": "high",
  "verified": "confirmed",
  "status": "open"
}
```

ID prefixes: `PERF`, `START`, `BUN`, `CACHE`, `MMKV`, `SEC`(secure-storage), `CSEC`(client-security), `AUTH`, `BE`, `DEP`, `UPD`, `REL`, `AGT`, `HUI`.
`verified`: `confirmed` | `downgraded` | `unverified` (P2 findings are not verified) | `rejected` (dropped from the report, kept only in JSON under `rejected`).
`status`: `open` | `fixed` | `partial` | `wontfix`.

## Agent output (deep mode)

Each auditor agent returns exactly one fenced JSON block:

```json
{
  "agent": "auth-session-auditor",
  "categories": [
    {
      "id": "auth-sessions",
      "score": 6.5,
      "rationale": "Two sentences max on why this score.",
      "keyFinding": "Short, one line",
      "topSuggestion": "Short, one line",
      "strengths": ["What is done well, one line each"],
      "findings": [ /* Finding JSON objects, verified = "unverified" */ ]
    }
  ],
  "notes": "Anything the orchestrator must know (skipped checks, missing access)."
}
```

## Report JSON (saved next to the markdown report)

```json
{
  "tool": "expo-es-kit",
  "version": "0.1.0",
  "type": "audit",
  "date": "2026-10-07",
  "appRoot": ".",
  "apiRoot": "../my-api or null",
  "mode": "quick | deep",
  "stack": { "expo": "54.0.x", "reactNative": "0.81.x", "router": "expo-router", "backendMode": "direct-db | api | hybrid | none", "apiFramework": "nextjs | supabase-edge | expo-api-routes | other | null", "ui": ["heroui-native"] },
  "overall": 7.1,
  "verdict": "GO WITH RISKS",
  "categories": [ /* category objects as above, with findings[].verified set */ ],
  "topFixes": ["AUTH-003", "BE-001"],
  "rejected": [ /* findings the verifier rejected */ ],
  "previous": { "file": "docs/audits/expo-audit-2026-09-01.json", "overall": 6.2 }
}
```

A fix run writes the same shape with `"type": "fix"` plus `"before": { "<categoryId>": score }`.

## Report location

Default directory: `docs/audits/` in the app root (override with `--out=<file.md>`; the JSON goes next to it with the same basename).
File names: `expo-audit-YYYY-MM-DD.md/.json`, `expo-fix-YYYY-MM-DD.md/.json`. If a file for today exists, append `-2`, `-3`, ….
