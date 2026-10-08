---
name: setup
description: "Generate or update per-folder CLAUDE.md agent rules in an Expo / React Native app (routes, components, hooks, lib, storage, state, data layer, assets, native modules, tests) and its API repo, with \"Use / Never / Patterns / Before finishing\" sections adapted to the backend mode (Supabase RLS or API). Flags stale claims. Use to set up agent instructions, create CLAUDE.md files, \"teach agents my app\", or after an audit flags agent-config."
argument-hint: "[appPath] [--mode=direct-db|api|hybrid] [--api=<apiRepoPath>] [--dry-run]"
---

# expo-es-kit · setup

You write short, specific, per-folder agent instructions. The best CLAUDE.md files are **short and true**. Every line must be something an agent would otherwise get wrong in *this* app.

## 0. Setup

- `PLUGIN_ROOT` is two levels above this SKILL.md. If unknown, run `find ~/.claude/plugins ~/.codex ~/.cursor/plugins ~/.agents -type f -path '*expo-es-kit*/scripts/scan.mjs' | head -1` and strip `/scripts/scan.mjs`.
- Templates live in `PLUGIN_ROOT/skills/setup/templates/`. Read its `README.md` first for the placeholder and conditional syntax.
- `--dry-run` means: print the plan, the full contents of new files and the diffs for existing files, then write nothing.

## 1. Understand the app

1. Run `node "$PLUGIN_ROOT/scripts/scan.mjs" <app> [--api=<api>] --summary > "$TMP/scan.json"` and read it (compact; full samples via `scripts/query-scan.mjs` on a non-summary scan if needed). Use these parts:
   - `stack` and `config`
   - `folders` (each with `sourceFiles` and `hasClaudeMd`)
   - `claudeConfig`
   - `backend`
   - the hits
2. Determine the **backend mode**:
   - Take `--mode` if given. Otherwise use `backend.mode`.
   - If the mode is `none`, or the signals are weak, ask the user with AskUserQuestion. The options are:
     - **direct-db**: the app queries the database itself, and RLS is the trust boundary.
     - **api**: the app only calls your API, hosted elsewhere.
     - **hybrid**: reads go direct, writes and secret-bearing work go through the API.
   - Explain each option in one line and recommend one based on the signals.
3. Find the real helper modules and use their actual paths as template values. Use Grep and Glob, and read each candidate briefly. Look for:
   - the storage wrapper (MMKV), the SecureStore wrapper
   - the Supabase client, the API client
   - the QueryClient and query keys
   - the sign-out module, the theme/tokens file, the sheet host
4. Read the existing agent config: root and nested `CLAUDE.md`, `.claude/rules/*`, `.claude/skills/*`, `.cursor/rules/*`, `AGENTS.md`. Then:
   - **Detect stale claims.** Compare each factual claim with `package.json` and the scan. Examples: "no Supabase client" while `@supabase/supabase-js` is used, "no CI" while `.github/workflows` exists, "mocks are the data layer" while there are 200 API calls. Quote the claim and the contradicting evidence.
   - **Detect conflicts.** Look for rules that contradict each other, or contradict the proven practices in the templates.
   - **Keep what is good.** Existing project-specific rules win over the generic template text. Reference them instead of duplicating them, e.g. "Import rules: see `.claude/rules/heroui-imports.md`".

## 2. Map folders to templates

| Folder pattern (first match wins) | Template |
|---|---|
| app root | `root.md` (always) |
| `app/`, `src/app/` (expo-router) | `app-routes.md` |
| `components/ui`, `components/primitives` (if HeroUI is installed) | `PLUGIN_ROOT/skills/heroui/templates/components-ui-claude.md` |
| `components/`, `src/components/`, `features/*/components` | `components.md` |
| `hooks/` | `hooks.md` |
| `lib/storage`, `storage/`, `lib/cache` | `storage.md` |
| `lib/`, `utils/`, `services/`, `src/lib` | `lib.md` |
| `store/`, `stores/`, `state/` | `state.md` |
| `lib/api`, `api/` (client side), `services/api` | `data/api-client.md` (mode api/hybrid) |
| `lib/supabase`, `db/`, `lib/db`, `data/` | `data/direct-db.md` (mode direct-db/hybrid) |
| `supabase/migrations`, `db/migrations` | `server/db-migrations.md` |
| `supabase/functions` | `server/supabase-edge.md` |
| any folder with `+api.ts` files | `server/expo-api-routes.md` |
| `assets/` | `assets.md` |
| `modules/`, `plugins/` (config plugins), `patches/` | `native-modules.md` |
| `__tests__/`, `e2e/`, `tests/` | `tests.md` |

For each feature folder that is large (20 or more source files) and not otherwise covered, don't create a file by default. Ask whether the user wants a short feature-level CLAUDE.md.

**API repo** (`--api` given, mode api/hybrid):

- Write `CLAUDE.md` files there too, using `server/nextjs-api.md` for the `app/api` or `src/app/api` folder.
- Use `server/db-migrations.md` for its migrations.
- Give it a root section based on `root.md`, trimmed for a server project.

## 3. Fill the templates

- Replace the `{{PLACEHOLDERS}}` with the real values found in step 1.
- Keep or drop the conditional blocks according to the stack and mode (see the templates README).
- Remove every rule that doesn't apply. For example, drop the MMKV rules when MMKV isn't used, *unless* the audit recommends adopting it. In that case, add the rule as "Target: ...".
- Add up to 5 **app-specific** bullets per file. Base them on what you saw in the code: real module names, real conventions, documented decisions in `docs/`. Never invent conventions.
- Size limits:
  - root: 60–120 lines
  - folder files: 80 lines or fewer

  Link instead of repeating.
- English, imperative, no fluff.

## 4. Write safely

For each target file:

- **New file**: write it.
- **Existing file without our marker**: leave the user's content untouched. Append a section wrapped in `<!-- expo-es-kit:start -->` … `<!-- expo-es-kit:end -->` that holds only the rules that are missing (no duplicates). Show the diff.
- **Existing file with our marker**: replace only the content between the markers. Show the diff.
- **Stale claims** found in step 1: never silently rewrite the user's text. List them, propose the corrected lines, and apply them only after the user confirms (one AskUserQuestion covering all of them, multiSelect).

Before writing anything, show the plan as a table: `| File | Action (create/append/update) | Template | Lines |`. Then ask one confirmation question. With `--dry-run`, stop after showing the plan and the contents.

Optionally offer (as a separate question) to add path-scoped rules in `.claude/rules/` for the strongest invariants, for example granular UI-library imports or "no AsyncStorage for credentials". The HeroUI rule template is at `PLUGIN_ROOT/skills/heroui/templates/heroui-imports-rule.md`.

## 5. Finish

Print:

- the files created and updated
- the stale claims you fixed and the ones you left as-is
- this tip: "Agents load a folder's CLAUDE.md when they work in it. Keep these files short and update them when conventions change. `/expo-es-kit:audit` scores them under *Agent instructions*."

Never touch any of these:

- `node_modules`, build output
- `docs/` content, except `docs/audits`, and only for audit reports
- any file outside the app and API roots
