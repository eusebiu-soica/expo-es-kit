# Agent instructions checks (category `agent-config`)
Scope: how well the repo instructs coding agents — root and per-folder CLAUDE.md, rules files across tools, accuracy (staleness) against the actual code, and audit history.

Check ids (`AGT-Cnn`) are stable references for this file; findings get report ids `AGT-001…`. Weight 0.5. Fix path for most findings: `/expo-es-kit:setup` (generates/refreshes CLAUDE.md files from the scan).

Severity guidance: this category rarely has P0. A **stale or contradictory instruction that would make an agent introduce a security or data bug** (e.g. "store the session in AsyncStorage", "service role key is fine in the app") is P1. Everything else is P2.

## Signals to start from

| Scan path | Meaning |
|---|---|
| `claudeConfig.rootClaudeMd`, `claudeConfig.rootClaudeMdLines` | Root file exists; length (> ~150 lines = too long for always-on context; > 300 = P2). |
| `claudeConfig.nestedClaudeMd` | Per-folder files present. |
| `folders[]` (`dir`, `sourceFiles`, `hasClaudeMd`) | Folders with many source files (≥ ~15) and `hasClaudeMd: false` → missing local guidance. |
| `claudeConfig.rules`, `claudeConfig.skills`, `claudeConfig.agents` | `.claude/rules`, skills, agents. |
| `claudeConfig.cursorRules`, `claudeConfig.agentsMd` | Other tools' instruction files — conflict surface. |
| `stack`, `stack.libs`, `config`, `backend.mode`, `config.scripts` | Ground truth to compare claims against. |
| `.github/workflows/` (list it), `eas.json`, `supabase/` | Ground truth for CI/build/backend claims. |
| `docs/audits/` | Audit history present (previous reports). |

Read: root `CLAUDE.md`, every nested `CLAUDE.md`, `.claude/rules/*`, `.cursor/rules/*`, `AGENTS.md`. They are short; read fully.

## Staleness detection (core of this category)

Extract every factual claim from the instruction files and check it against the scan / repo:

| Claim type (examples) | Check against |
|---|---|
| "No backend yet" / "mocks are the data layer" / "no Supabase client" | `stack.libs["@supabase/supabase-js"]`, `backend.mode`, `hits["supabase-create-client"]`, `hits["supabase-table-access"]`, `supabase/` folder. |
| "No CI" / "we don't run tests" | `.github/workflows/*`, `config.scripts.test`, test files. |
| "Use AsyncStorage for X" | `stack.libs["react-native-mmkv"]`, `hits["mmkv-instance"]` (app moved on). |
| Versions ("Expo SDK 52", "React Query v4", "Reanimated 3") | `stack.expo`, `stack.libs`. |
| Commands (`npm run typecheck`, `yarn test`) | `config.scripts`, lockfile type. |
| Paths ("components live in src/ui") | `folders[]`. |
| Library choices ("use FlashList for all lists", "use NativeWind") | `stack.libs`, hits for the alternative. |
| Architecture ("all data goes through lib/api") | `hits["supabase-table-access"]` / `hits["api-fetch"]` locations outside that folder. |

Each contradiction = one finding with both sides as evidence: `CLAUDE.md:12 "No Supabase client yet"` vs `package.json: @supabase/supabase-js ^2.x, lib/supabase.ts:8 createClient(...)`.

## Checks

| Check-ID | What | How to verify | Severity if failing | Fix |
|---|---|---|---|---|
| AGT-C01 | Root CLAUDE.md exists | `claudeConfig.rootClaudeMd` (or `AGENTS.md` imported by CLAUDE.md). | P2 (scores ≤ 3 when absent) | `/expo-es-kit:setup`. |
| AGT-C02 | Root file short and structured | `rootClaudeMdLines` ≤ ~150; has: stack line, key commands, folder map with pointers, non-obvious rules; no pasted docs/changelogs. | P2 | Move details into per-folder CLAUDE.md / `.claude/rules`; keep root as an index. |
| AGT-C03 | Claims match the code | Staleness table above. | P1 if the stale claim leads agents to unsafe or data-losing changes; P2 otherwise | Rewrite the stale section; `/expo-es-kit:setup` refresh. |
| AGT-C04 | Commands correct | Every command in CLAUDE.md exists in `config.scripts` or is a valid CLI for the installed tooling; package manager matches the lockfile. | P2 | Fix commands; list typecheck/lint/test/start/build. |
| AGT-C05 | Per-folder guidance for big folders | `folders[]` with ≥ ~15 source files and no CLAUDE.md, especially `app/`, `components/`, `lib/`, `hooks/`, `db/`/`supabase/`, `features/*`. | P2 | Short (20–60 lines) CLAUDE.md per folder: purpose, conventions, patterns to copy, pitfalls. |
| AGT-C06 | No conflicting rules across tools | Same topic stated differently in CLAUDE.md, `.claude/rules`, `.cursor/rules`, `AGENTS.md` (e.g. "use memo everywhere" vs "React Compiler on, no manual memo"). | P2 (P1 if conflict is on security/storage) | Single source of truth; others import or reference it. |
| AGT-C07 | Rules don't contradict proven practice | Instructions that push known anti-patterns: "always use FlashList", "wrap everything in useMemo" with compiler on, "use rgba for all overlays", "persist the whole query cache", "store session in AsyncStorage", "invalidateQueries() after mutations". | P1 for security/storage anti-patterns; P2 for perf | Replace with the patterns from `checks/*.md`; note "measure before swapping list libraries". |
| AGT-C08 | Security rules present | Instruction files state the non-negotiables: no secrets in `EXPO_PUBLIC_*`, tokens only in SecureStore, RLS on every table / auth on every route, wipe caches on sign-out. | P2 | Add a short "Security rules" section (root or `lib/CLAUDE.md`). |
| AGT-C09 | Performance rules present | Compiler/memo policy, list/image rules, animation rules, "measure on release build". | P2 | Add a short "Performance rules" section matching the app's compiler setting. |
| AGT-C10 | Backend boundary documented | `backend.mode` (direct-db / api / hybrid) and where server code lives (`api` root, Edge Functions) are stated, including which side enforces auth. | P2 (P1 in hybrid mode with stale/no description) | Add a "Data flow" paragraph. |
| AGT-C11 | Native rebuild + environment notes | Dev client requirement, "native dep → rebuild", OS/shell to run installs and Metro from (e.g. WSL vs Windows). | P2 | Add to commands section. |
| AGT-C12 | Rules files scoped | `.claude/rules/*` with path globs/frontmatter where supported, not one giant always-on file. | P2 | Split by area; scope by path. |
| AGT-C13 | Skills/agents referenced exist | Paths/skills/agents mentioned in CLAUDE.md exist in `.claude/skills`, `.claude/agents`, or installed plugins. | P2 | Remove dead references. |
| AGT-C14 | Audit history exists | `docs/audits/` with previous `expo-audit-*.md/.json`; CLAUDE.md points to it. | P2 (blocks 9+) | Save reports there (default); link from CLAUDE.md. |
| AGT-C15 | No secrets or personal data in instruction files | Keys, tokens, internal URLs with credentials, customer data in CLAUDE.md/rules. | P0 if a live secret (score in `client-security` too); P1 otherwise | Remove + rotate. |
| AGT-C16 | Generated vs hand-written separated | Generated sections (by setup tools) marked; hand-written decisions preserved on refresh. | P2 | Use markers for generated blocks so `/expo-es-kit:setup` can refresh without clobbering. |

## Proven patterns

**Root CLAUDE.md skeleton (≤ 150 lines)**
```md
# <App>
Stack: Expo SDK 57 · RN 0.86 · expo-router · TanStack Query 5 · MMKV 4 · Supabase (hybrid: direct-db + Next.js API in ../api)

## Commands
npm start · npm run typecheck · npm run lint · npm test · eas build --profile development
Native dependency added → rebuild the dev client (Metro reload is not enough). Run installs and Metro from the same OS (WSL).

## Map
app/ → routes (see app/CLAUDE.md) · components/ → UI (components/CLAUDE.md) · lib/ → data, storage, auth (lib/CLAUDE.md) · supabase/ → migrations + RLS (supabase/CLAUDE.md)

## Non-negotiables
- Tokens only in expo-secure-store; bulk data in encrypted MMKV. Never EXPO_PUBLIC_ secrets.
- Every table has RLS; every API route authenticates + validates (zod).
- Sign-out wipes query cache, user MMKV prefix, private image cache.
- React Compiler is OFF: memo list rows, stable callbacks, no inline objects on memoized children.
- Measure perf on a release build on a min-spec Android before/after any perf change.

## Audits
History in docs/audits/. Run /expo-es-kit:audit before releases.
```

**Per-folder file (`lib/CLAUDE.md`)**
```md
# lib/
Data access, storage, auth. Screens never call Supabase directly — use lib/queries/*.
- Query keys: lib/queries/keys.ts factories only.
- Storage: lib/storage/index.ts (encrypted cache instance, prefs instance). Prefix user keys with userPrefix().
- Signed URLs: lib/media/signedUrl.ts (cached, deduped) — never call createSignedUrl in components.
```

## Not a problem when

- Root CLAUDE.md slightly over 150 lines but dense and accurate — P2 suggestion at most.
- No `.cursor/rules` / `AGENTS.md` (single-tool team).
- Small folders (< ~15 files) without CLAUDE.md.
- Claims about planned work clearly marked as plans ("Planned: move to MMKV in Q4").
- No `docs/audits/` on the first audit (this run creates it) — note, don't penalize beyond blocking 9+.

## Score anchors

| Band | `agent-config` looks like |
|---|---|
| 0–2 | No instructions at all, or instructions that actively push unsafe patterns (tokens in AsyncStorage, secrets in public env). |
| 3–4 | Root file exists but is stale on core facts (backend, storage, CI) or conflicts with other rule files; wrong commands. |
| 5–6 | Accurate but long/generic root file; no per-folder guidance for large folders; security/perf rules missing. |
| 7–8 | Short accurate root file, per-folder files for big folders, security + perf non-negotiables, no conflicts. |
| 9–10 | All of 7–8 plus audit history linked, generated/hand-written sections separated, rules scoped by path, verified fresh against the current scan. |
